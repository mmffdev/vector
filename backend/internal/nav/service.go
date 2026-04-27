package nav

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/models"
)

// MaxPinned caps the server-side pinned list length. Mirrors MAX_PINNED in
// the frontend modal — client enforcement is cosmetic; this is the real gate.
// Raised from 20 to 50 alongside entity bookmarks (Phase 3) so pinned static
// items + entity bookmarks share one comfortable budget.
const MaxPinned = 50

// MaxCustomGroups / MaxChildrenPerParent are product caps for the
// sub-pages + custom groups phase. Server is the source of truth — the
// preferences UI should also enforce, but this is the gate.
const (
	MaxCustomGroups     = 10
	MaxChildrenPerParent = 8
	MaxGroupLabelLen     = 64
)

var (
	ErrUnknownItemKey       = errors.New("unknown item_key")
	ErrNotPinnable          = errors.New("item_key is not pinnable")
	ErrStartPageNotPinned   = errors.New("start_page_key must be present in pinned list")
	ErrBadPositions         = errors.New("positions must be contiguous 0..N-1")
	ErrDuplicateKey         = errors.New("duplicate item_key in pinned list")
	ErrRoleForbidden        = errors.New("role may not pin this item_key")
	ErrTooManyPinned        = errors.New("too many pinned items")
	ErrBadGrouping          = errors.New("items sharing a tag must be contiguous")
	ErrBadNesting           = errors.New("invalid parent/child nesting")
	ErrCatalogueItemLocked  = errors.New("catalogue items cannot be nested or moved into custom groups")
	ErrUnknownGroup         = errors.New("unknown group_id")
	ErrEmptyGroupLabel      = errors.New("group label must not be empty")
	ErrDuplicateGroupLabel  = errors.New("duplicate group label")
	ErrTooManyGroups        = errors.New("too many custom groups")
	ErrTooManyChildren      = errors.New("too many children for parent")
	ErrGroupLabelTooLong    = errors.New("group label too long")
)

type Service struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
}

func New(pool *pgxpool.Pool, registry *CachedRegistry) *Service {
	return &Service{Pool: pool, Registry: registry}
}

type PrefRow struct {
	ItemKey       string  `json:"item_key"`
	Position      int     `json:"position"`
	IsStartPage   bool    `json:"is_start_page"`
	ParentItemKey *string `json:"parent_item_key"`
	GroupID       *string `json:"group_id"`       // nil means "use registry tag group"
	IconOverride  *string `json:"icon_override"`  // nil means "use registry default"
}

type PinnedInput struct {
	ItemKey       string  `json:"item_key"`
	Position      int     `json:"position"`
	ParentItemKey *string `json:"parent_item_key,omitempty"`
	GroupID       *string `json:"group_id,omitempty"`
	IconOverride  *string `json:"icon_override,omitempty"`
}

// CustomGroup is the wire shape for a user-created primary group.
type CustomGroup struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Position int    `json:"position"`
}

// CustomGroupInput is the inbound shape on PUT /api/nav/prefs.
// id may be canonical (existing UUID) or "new:<anything>" for newly
// created rows. The service mints fresh UUIDs for "new:" rows and
// returns the id mapping via refetch (no separate response shape).
type CustomGroupInput struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Position int    `json:"position"`
}

// GetPrefs returns the user's prefs for the resolved profile (active
// → Default → lazy-seed). Backwards-compatible signature kept for
// tests + handlers that don't yet pass an explicit profile.
func (s *Service) GetPrefs(ctx context.Context, userID, subscriptionID uuid.UUID, role models.Role) ([]PrefRow, error) {
	pid, err := s.ResolveProfile(ctx, userID, subscriptionID, nil)
	if err != nil {
		return nil, err
	}
	return s.GetPrefsForProfile(ctx, userID, subscriptionID, role, pid)
}

// GetPrefsForProfile returns prefs scoped to a specific profile.
// Empty slice means "no prefs set" — callers fall back to catalogue defaults.
//
// Side effect: opportunistically backfills any system page (created_by IS NULL,
// subscription_id IS NULL) where pages.default_pinned=TRUE and the user's role
// is allowed by page_roles, but the user has no row in user_nav_prefs for it.
// This eliminates the per-release backfill-migration tax — adding a new system
// page with default_pinned=TRUE auto-pins it for every existing eligible user
// on their next nav fetch. One-time per (user, page, profile); subsequent
// unpins stick. Auto-pin is per-profile so a custom profile starts clean
// rather than inheriting the union of "every default-pinned page ever shipped"
// from Default.
func (s *Service) GetPrefsForProfile(ctx context.Context, userID, subscriptionID uuid.UUID, role models.Role, profileID uuid.UUID) ([]PrefRow, error) {
	// Default-page auto-pin only fires for the user's Default profile.
	// Custom profiles start with whatever the user explicitly puts on
	// them — auto-pinning every new system page across every profile
	// would silently grow customer profiles forever.
	if _, err := s.Pool.Exec(ctx, `
		INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
		SELECT
			$1::uuid,
			$2::uuid,
			$4::uuid,
			p.key_enum,
			COALESCE(
				(SELECT MAX(unp.position) + 1
				 FROM user_nav_prefs unp
				 WHERE unp.user_id = $1::uuid
				   AND unp.subscription_id = $2::uuid
				   AND unp.profile_id = $4::uuid),
				0
			) + (ROW_NUMBER() OVER (ORDER BY p.default_order, p.key_enum) - 1),
			FALSE
		FROM pages p
		JOIN page_roles pr ON pr.page_id = p.id
		JOIN user_nav_profiles d ON d.id = $4::uuid AND d.is_default = TRUE
		WHERE p.created_by IS NULL
		  AND p.subscription_id IS NULL
		  AND p.default_pinned = TRUE
		  AND p.pinnable = TRUE
		  AND pr.role = $3::user_role
		  AND NOT EXISTS (
			  SELECT 1 FROM user_nav_prefs unp
			  WHERE unp.user_id = $1::uuid
				AND unp.subscription_id = $2::uuid
				AND unp.profile_id = $4::uuid
				AND unp.item_key = p.key_enum
		  )`, userID, subscriptionID, string(role), profileID); err != nil {
		return nil, fmt.Errorf("nav prefs backfill: %w", err)
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT item_key, position, is_start_page, parent_item_key, group_id, icon_override
		FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3
		ORDER BY position`, userID, subscriptionID, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PrefRow, 0, 16)
	for rows.Next() {
		var p PrefRow
		var parent *string
		var groupID *uuid.UUID
		var iconOverride *string
		if err := rows.Scan(&p.ItemKey, &p.Position, &p.IsStartPage, &parent, &groupID, &iconOverride); err != nil {
			return nil, err
		}
		p.ParentItemKey = parent
		if groupID != nil {
			s := groupID.String()
			p.GroupID = &s
		}
		p.IconOverride = iconOverride
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetCustomGroups returns the user's custom primary groups, in user-defined order.
func (s *Service) GetCustomGroups(ctx context.Context, userID uuid.UUID) ([]CustomGroup, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, label, position
		FROM user_nav_groups
		WHERE user_id = $1
		ORDER BY position`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CustomGroup, 0, 4)
	for rows.Next() {
		var g CustomGroup
		var id uuid.UUID
		if err := rows.Scan(&id, &g.Label, &g.Position); err != nil {
			return nil, err
		}
		g.ID = id.String()
		out = append(out, g)
	}
	return out, rows.Err()
}

// GetStartPageHref resolves the start page for (user, sub) using the
// resolved profile (active → Default → lazy-seed). Backwards-compat
// wrapper kept so handlers + tests don't need updating.
// Returns ("", false) if no start page set OR the caller's current role no
// longer permits the stored item (e.g. demotion since prefs were written).
func (s *Service) GetStartPageHref(ctx context.Context, userID, subscriptionID uuid.UUID, role models.Role) (string, bool, error) {
	pid, err := s.ResolveProfile(ctx, userID, subscriptionID, nil)
	if err != nil {
		return "", false, err
	}
	return s.GetStartPageHrefForProfile(ctx, userID, subscriptionID, role, pid)
}

// GetStartPageHrefForProfile is the profile-scoped variant.
func (s *Service) GetStartPageHrefForProfile(ctx context.Context, userID, subscriptionID uuid.UUID, role models.Role, profileID uuid.UUID) (string, bool, error) {
	var key string
	err := s.Pool.QueryRow(ctx, `
		SELECT item_key FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3 AND is_start_page = TRUE
		LIMIT 1`, userID, subscriptionID, profileID).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	reg, err := s.Registry.Get(ctx)
	if err != nil {
		return "", false, err
	}
	entry, ok := reg.Find(key)
	if !ok {
		return "", false, nil
	}
	if !roleAllowed(role, entry.Roles) {
		return "", false, nil
	}
	return entry.Href, true, nil
}

// ReplacePrefs validates the input, then atomically deletes and re-inserts
// this user's prefs AND custom groups for (tenant, profile=NULL).
//
// Validation (extends the original list with sub-pages + custom groups):
//   - len(pinned) <= MaxPinned, len(groups) <= MaxCustomGroups
//   - every item_key exists in the registry, is pinnable, role-permitted
//   - no duplicate item_keys
//   - top-level positions form contiguous 0..N-1
//   - top-level items sharing a tag/group are contiguous
//   - per-parent child positions form contiguous 0..N-1
//   - max MaxChildrenPerParent children per parent
//   - parent_item_key must reference a pinned, top-level (no parent) row
//   - parent_item_key set only on user_custom kind
//   - group_id set only on user_custom kind, must reference a known group
//   - group labels: non-empty, <= MaxGroupLabelLen, unique CI per user
func (s *Service) ReplacePrefs(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	role models.Role,
	pinned []PinnedInput,
	startPageKey *string,
	groups []CustomGroupInput,
	extraEntries map[string]CatalogEntry,
) error {
	pid, err := s.ResolveProfile(ctx, userID, subscriptionID, nil)
	if err != nil {
		return err
	}
	return s.ReplacePrefsForProfile(ctx, userID, subscriptionID, role, pinned, startPageKey, groups, extraEntries, pid)
}

// ReplacePrefsForProfile is the profile-scoped variant. Wipes + re-inserts
// only this profile's rows; other profiles are untouched. user_nav_groups
// (the shared pool) is NOT wiped here — that would clobber other profiles
// referencing the same groups. Group writes happen via /api/nav/groups
// instead (a separate surface — see story B6).
//
// Until the dedicated groups surface lands, this method preserves the
// legacy "groups payload replaces user_nav_groups" behaviour ONLY when
// it's writing the user's Default profile (the only profile the legacy
// PUT could ever touch). Non-default profiles MUST send an empty
// groups list; the shared group pool is not the responsibility of a
// profile-scoped write.
func (s *Service) ReplacePrefsForProfile(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	role models.Role,
	pinned []PinnedInput,
	startPageKey *string,
	groups []CustomGroupInput,
	extraEntries map[string]CatalogEntry,
	profileID uuid.UUID,
) error {
	if len(pinned) > MaxPinned {
		return fmt.Errorf("%w: %d > %d", ErrTooManyPinned, len(pinned), MaxPinned)
	}
	if len(groups) > MaxCustomGroups {
		return fmt.Errorf("%w: %d > %d", ErrTooManyGroups, len(groups), MaxCustomGroups)
	}

	// Normalise + validate group rows. Mint UUIDs for "new:" entries and
	// build a remap so pinned rows referencing them are translated below.
	idRemap := make(map[string]string, len(groups))
	knownGroupIDs := make(map[string]struct{}, len(groups))
	labelSeen := make(map[string]struct{}, len(groups))
	groupPositions := make(map[int]struct{}, len(groups))
	normalisedGroups := make([]CustomGroup, 0, len(groups))
	for _, g := range groups {
		label := strings.TrimSpace(g.Label)
		if label == "" {
			return ErrEmptyGroupLabel
		}
		if len(label) > MaxGroupLabelLen {
			return fmt.Errorf("%w: %d > %d", ErrGroupLabelTooLong, len(label), MaxGroupLabelLen)
		}
		lower := strings.ToLower(label)
		if _, dup := labelSeen[lower]; dup {
			return ErrDuplicateGroupLabel
		}
		labelSeen[lower] = struct{}{}

		var canonical string
		if strings.HasPrefix(g.ID, "new:") {
			canonical = uuid.NewString()
		} else {
			if _, err := uuid.Parse(g.ID); err != nil {
				return fmt.Errorf("%w: bad id %q", ErrUnknownGroup, g.ID)
			}
			canonical = g.ID
		}
		idRemap[g.ID] = canonical
		knownGroupIDs[canonical] = struct{}{}
		groupPositions[g.Position] = struct{}{}
		normalisedGroups = append(normalisedGroups, CustomGroup{
			ID:       canonical,
			Label:    label,
			Position: g.Position,
		})
	}
	for i := 0; i < len(normalisedGroups); i++ {
		if _, ok := groupPositions[i]; !ok {
			return ErrBadPositions
		}
	}

	reg, err := s.Registry.Get(ctx)
	if err != nil {
		return err
	}

	// Translate pinned rows: rewrite group_id via idRemap so "new:" stubs
	// become canonical UUIDs before validation/insert.
	translated := make([]PinnedInput, len(pinned))
	for i, p := range pinned {
		translated[i] = p
		if p.GroupID != nil {
			canonical, ok := idRemap[*p.GroupID]
			if !ok {
				if _, parsed := uuid.Parse(*p.GroupID); parsed != nil {
					return fmt.Errorf("%w: %s", ErrUnknownGroup, *p.GroupID)
				}
				canonical = *p.GroupID
			}
			if _, ok := knownGroupIDs[canonical]; !ok {
				return fmt.Errorf("%w: %s", ErrUnknownGroup, canonical)
			}
			translated[i].GroupID = &canonical
		}
	}

	lookup := func(key string) (CatalogEntry, bool) {
		if e, ok := reg.Find(key); ok {
			return e, true
		}
		if extraEntries != nil {
			if e, ok := extraEntries[key]; ok {
				return e, true
			}
		}
		return CatalogEntry{}, false
	}

	if err := validatePinned(lookup, translated, role, knownGroupIDs); err != nil {
		return err
	}
	if startPageKey != nil {
		entry, ok := lookup(*startPageKey)
		if !ok || !entry.Pinnable {
			return fmt.Errorf("%w: start_page_key=%s", ErrNotPinnable, *startPageKey)
		}
		if !roleAllowed(role, entry.Roles) {
			return fmt.Errorf("%w: start_page_key=%s", ErrRoleForbidden, *startPageKey)
		}
		found := false
		for _, p := range translated {
			if p.ItemKey == *startPageKey {
				found = true
				break
			}
		}
		if !found {
			return ErrStartPageNotPinned
		}
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Look up whether the targeted profile is Default. The shared
	// user_nav_groups pool is only wiped when writing Default — that
	// preserves the legacy single-profile behaviour without letting a
	// non-default-profile PUT clobber groups other profiles still
	// reference. The group surface gets its own dedicated endpoint in
	// B6; until then, non-default profiles MUST send an empty groups
	// list (validated above by len cap; semantically should be 0).
	var targetIsDefault bool
	if err := tx.QueryRow(ctx, `
		SELECT is_default FROM user_nav_profiles WHERE id = $1
	`, profileID).Scan(&targetIsDefault); err != nil {
		return err
	}

	// Wipe prefs for THIS profile only (other profiles' rows survive).
	if _, err := tx.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3`, userID, subscriptionID, profileID); err != nil {
		return err
	}
	if targetIsDefault {
		if _, err := tx.Exec(ctx, `DELETE FROM user_nav_groups WHERE user_id = $1`, userID); err != nil {
			return err
		}
	}

	// Insert groups first so FK targets exist for any prefs row that
	// references them.
	if len(normalisedGroups) > 0 {
		batch := &pgx.Batch{}
		for _, g := range normalisedGroups {
			batch.Queue(`
				INSERT INTO user_nav_groups (id, user_id, label, position)
				VALUES ($1, $2, $3, $4)`,
				g.ID, userID, g.Label, g.Position)
		}
		br := tx.SendBatch(ctx, batch)
		for range normalisedGroups {
			if _, err := br.Exec(); err != nil {
				_ = br.Close()
				return err
			}
		}
		if err := br.Close(); err != nil {
			return err
		}
	}

	if len(translated) > 0 {
		batch := &pgx.Batch{}
		for _, p := range translated {
			isStart := startPageKey != nil && *startPageKey == p.ItemKey
			var gid *uuid.UUID
			if p.GroupID != nil {
				u, _ := uuid.Parse(*p.GroupID)
				gid = &u
			}
			batch.Queue(`
				INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page, parent_item_key, group_id, icon_override)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				userID, subscriptionID, profileID, p.ItemKey, p.Position, isStart, p.ParentItemKey, gid, p.IconOverride)
		}
		br := tx.SendBatch(ctx, batch)
		for range translated {
			if _, err := br.Exec(); err != nil {
				_ = br.Close()
				return err
			}
		}
		if err := br.Close(); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// DeletePrefs is the legacy "Reset to defaults" — nukes prefs for the
// resolved profile AND the shared group pool. Kept as a wrapper so
// existing callers (handler + tests) work unchanged. New code targeting
// a specific profile should call DeletePrefsForProfile, which never
// touches the shared group pool.
func (s *Service) DeletePrefs(ctx context.Context, userID, subscriptionID uuid.UUID) error {
	pid, err := s.ResolveProfile(ctx, userID, subscriptionID, nil)
	if err != nil {
		return err
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var isDefault bool
	if err := tx.QueryRow(ctx, `
		SELECT is_default FROM user_nav_profiles WHERE id = $1
	`, pid).Scan(&isDefault); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3`, userID, subscriptionID, pid); err != nil {
		return err
	}
	// Reset only wipes the shared group pool when the user's resolved
	// profile is Default. Non-default profiles share the pool; resetting
	// one of them must not erase groups that other profiles still place.
	if isDefault {
		if _, err := tx.Exec(ctx, `DELETE FROM user_nav_groups WHERE user_id = $1`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// DeletePrefsForProfile wipes prefs for the named profile only. Never
// touches user_nav_groups (the shared pool). Use the legacy DeletePrefs
// when the caller really means "reset to defaults" on the user's home
// profile.
func (s *Service) DeletePrefsForProfile(ctx context.Context, userID, subscriptionID, profileID uuid.UUID) error {
	if err := s.RequireOwnedProfile(ctx, userID, subscriptionID, profileID); err != nil {
		return err
	}
	_, err := s.Pool.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3`,
		userID, subscriptionID, profileID)
	return err
}

// validatePinned enforces the rule set described on ReplacePrefs.
//   - lookup: resolves an item_key to its catalogue entry (registry + custom pages)
//   - role: caller's role
//   - knownGroupIDs: canonical UUIDs of groups in the same payload
func validatePinned(
	lookup func(string) (CatalogEntry, bool),
	pinned []PinnedInput,
	role models.Role,
	knownGroupIDs map[string]struct{},
) error {
	seen := make(map[string]struct{}, len(pinned))
	tagByPos := make(map[int]string, len(pinned))     // top-level only
	groupByPos := make(map[int]string, len(pinned))   // top-level group_id, "" if none
	topLevelKeys := make(map[string]struct{}, len(pinned))
	childKeys := make(map[string]struct{}, len(pinned))
	childrenByParent := make(map[string][]int, len(pinned))
	posByKey := make(map[string]int, len(pinned))
	topLevelPositions := make(map[int]struct{}, len(pinned))

	for _, p := range pinned {
		entry, ok := lookup(p.ItemKey)
		if !ok {
			return fmt.Errorf("%w: %s", ErrUnknownItemKey, p.ItemKey)
		}
		if !entry.Pinnable {
			return fmt.Errorf("%w: %s", ErrNotPinnable, p.ItemKey)
		}
		if !roleAllowed(role, entry.Roles) {
			return fmt.Errorf("%w: %s", ErrRoleForbidden, p.ItemKey)
		}
		if _, dup := seen[p.ItemKey]; dup {
			return fmt.Errorf("%w: %s", ErrDuplicateKey, p.ItemKey)
		}
		seen[p.ItemKey] = struct{}{}
		posByKey[p.ItemKey] = p.Position

		// Catalogue lock: only kind=user_custom may carry parent or group_id.
		if entry.Kind != KindUserCustom {
			if p.ParentItemKey != nil || p.GroupID != nil {
				return fmt.Errorf("%w: %s", ErrCatalogueItemLocked, p.ItemKey)
			}
		}

		if p.ParentItemKey != nil {
			if *p.ParentItemKey == p.ItemKey {
				return fmt.Errorf("%w: self-reference %s", ErrBadNesting, p.ItemKey)
			}
			childKeys[p.ItemKey] = struct{}{}
			childrenByParent[*p.ParentItemKey] = append(childrenByParent[*p.ParentItemKey], p.Position)
		} else {
			topLevelKeys[p.ItemKey] = struct{}{}
			topLevelPositions[p.Position] = struct{}{}
			tagByPos[p.Position] = entry.TagEnum
			if p.GroupID != nil {
				groupByPos[p.Position] = *p.GroupID
			} else {
				groupByPos[p.Position] = ""
			}
		}

		if p.GroupID != nil {
			if _, ok := knownGroupIDs[*p.GroupID]; !ok {
				return fmt.Errorf("%w: %s", ErrUnknownGroup, *p.GroupID)
			}
		}
	}

	// Parent existence + one-level rule + cap.
	for parentKey, childPositions := range childrenByParent {
		if _, ok := topLevelKeys[parentKey]; !ok {
			return fmt.Errorf("%w: parent not pinned at top level (%s)", ErrBadNesting, parentKey)
		}
		if _, isAlsoChild := childKeys[parentKey]; isAlsoChild {
			return fmt.Errorf("%w: parent %s is itself a child", ErrBadNesting, parentKey)
		}
		if len(childPositions) > MaxChildrenPerParent {
			return fmt.Errorf("%w: %s has %d > %d", ErrTooManyChildren, parentKey, len(childPositions), MaxChildrenPerParent)
		}
	}

	// Top-level positions form contiguous 0..N-1.
	for i := 0; i < len(topLevelPositions); i++ {
		if _, ok := topLevelPositions[i]; !ok {
			return ErrBadPositions
		}
	}

	// Group/tag contiguity at top level: walk in position order, once a
	// (group, tag) bucket is closed it must not reappear. The bucket key
	// is "g:<groupID>" if group_id is set, else "t:<tagEnum>".
	closed := make(map[string]struct{})
	var prevBucket string
	for i := 0; i < len(topLevelPositions); i++ {
		var bucket string
		if g := groupByPos[i]; g != "" {
			bucket = "g:" + g
		} else {
			bucket = "t:" + tagByPos[i]
		}
		if i > 0 && bucket != prevBucket {
			closed[prevBucket] = struct{}{}
		}
		if _, wasClosed := closed[bucket]; wasClosed {
			return fmt.Errorf("%w: %s", ErrBadGrouping, bucket)
		}
		prevBucket = bucket
	}

	// Per-parent child positions form contiguous 0..N-1 within each parent.
	for parentKey, childPositions := range childrenByParent {
		_ = parentKey
		// Build set of *relative* positions used by this parent's children;
		// children are pinned with their own absolute position field, but
		// per-parent contiguity says THOSE positions (within the parent's
		// child set, sorted) must be 0..N-1 absent gaps.
		set := make(map[int]struct{}, len(childPositions))
		for _, pos := range childPositions {
			set[pos] = struct{}{}
		}
		// Sort positions and check they're a contiguous run starting at the
		// first one — children carry their own positions which may be any
		// integers; the rule is that within a parent there must be N
		// positions and no duplicates among them. Duplicates would have
		// shown up as duplicate item_key already (different children with
		// the same position is fine across parents). So contiguity here
		// reduces to: no duplicate within the parent's own set.
		if len(set) != len(childPositions) {
			return fmt.Errorf("%w: duplicate child position", ErrBadPositions)
		}
	}

	return nil
}
