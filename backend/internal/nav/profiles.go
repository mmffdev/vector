package nav

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MaxProfilesPerSubscription caps named navigation profiles per
// (user, subscription). Matches frontend modal limit; this is the gate.
const MaxProfilesPerSubscription = 10

// MaxProfileLabelLen is the hard char cap mirrored in the SQL CHECK.
const MaxProfileLabelLen = 32

var (
	ErrProfileNotFound      = errors.New("profile not found or not owned")
	ErrProfileLabelEmpty    = errors.New("profile label must not be empty")
	ErrProfileLabelTooLong  = errors.New("profile label too long")
	ErrDuplicateProfileLabel = errors.New("duplicate profile label")
	ErrTooManyProfiles      = errors.New("too many profiles")
	ErrCannotDeleteDefault  = errors.New("default profile cannot be deleted")
	ErrProfileWrongSubscription = errors.New("profile does not belong to this subscription")
)

// Profile is the wire shape for /api/nav/profiles. Per-profile group
// placements + per-profile prefs live behind their own endpoints; this
// shape only carries identity, ordering, and the start-page hint.
type Profile struct {
	ID           uuid.UUID `json:"id"`
	Label        string    `json:"label"`
	Position     int       `json:"position"`
	IsDefault    bool      `json:"is_default"`
	StartPageKey *string   `json:"start_page_key"`
}

// validateLabel trims and bounds-checks a profile label. Returns the
// trimmed value or a sentinel. Callers must use the returned value —
// the trimmed form is what we store.
func validateLabel(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", ErrProfileLabelEmpty
	}
	if len([]rune(v)) > MaxProfileLabelLen {
		return "", ErrProfileLabelTooLong
	}
	return v, nil
}

// RequireOwnedProfile is the foundational guard every profile-scoped
// endpoint calls before it touches profile-bound rows. Returns nil when
// the profile exists, belongs to the user, AND lives in the named
// subscription. Returns ErrProfileNotFound otherwise — the same
// sentinel for "doesn't exist" and "not yours" so callers can map to
// 404 without leaking which other users own which IDs.
func (s *Service) RequireOwnedProfile(ctx context.Context, userID, subscriptionID, profileID uuid.UUID) error {
	var one int
	err := s.Pool.QueryRow(ctx, sqlSelectProfileOwnedExists,
		profileID, userID, subscriptionID).Scan(&one)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProfileNotFound
		}
		return err
	}
	return nil
}

// ListProfiles returns the user's profiles for this subscription, in
// display order. Empty slice (not nil) is returned when none exist —
// the caller (lazy-seed helper, story B5) handles seeding.
func (s *Service) ListProfiles(ctx context.Context, userID, subscriptionID uuid.UUID) ([]Profile, error) {
	rows, err := s.Pool.Query(ctx, sqlListUserProfiles, userID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Profile, 0, 4)
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.Label, &p.Position, &p.IsDefault, &p.StartPageKey); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateProfile inserts a non-default profile at the end of the user's
// list. Default profiles are seeded by S3 backfill or B5 lazy-seed —
// never via this endpoint. Cap, label, and uniqueness errors map to
// distinct sentinels so the handler can return precise 400s.
func (s *Service) CreateProfile(ctx context.Context, userID, subscriptionID uuid.UUID, label string) (Profile, error) {
	clean, err := validateLabel(label)
	if err != nil {
		return Profile{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback(ctx)

	var count int
	if err := tx.QueryRow(ctx, sqlCountUserProfiles, userID, subscriptionID).Scan(&count); err != nil {
		return Profile{}, err
	}
	if count >= MaxProfilesPerSubscription {
		return Profile{}, ErrTooManyProfiles
	}

	var p Profile
	err = tx.QueryRow(ctx, sqlInsertUserProfile,
		userID, subscriptionID, clean, count,
	).Scan(&p.ID, &p.Label, &p.Position, &p.IsDefault, &p.StartPageKey)
	if err != nil {
		if isUniqueViolation(err, "uq_user_nav_profiles_label_ci") {
			return Profile{}, ErrDuplicateProfileLabel
		}
		return Profile{}, err
	}

	// Seed the new profile by cloning the user's Default profile state.
	// Without this seed a brand-new profile reads as empty — the editor
	// shows blank admin buckets and admin pages fall back to the
	// 'admin_settings' tag bucket. Copy two things:
	//   1) user_nav_prefs rows (pinned pages, with group_id + parent +
	//      icon_override preserved so admin pages stay inside their
	//      admin groups).
	//   2) user_nav_profile_groups placements (the rail/flyout section
	//      ordering: tag buckets + custom groups).
	// user_nav_groups itself is per-user (shared across profiles) so
	// nothing needs cloning there.
	if _, err := tx.Exec(ctx, sqlSeedNewProfilePrefsFromDefault,
		userID, subscriptionID, p.ID); err != nil {
		return Profile{}, fmt.Errorf("seed new profile prefs from default: %w", err)
	}

	if _, err := tx.Exec(ctx, sqlSeedNewProfileGroupsFromDefault,
		userID, subscriptionID, p.ID); err != nil {
		return Profile{}, fmt.Errorf("seed new profile groups from default: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Profile{}, err
	}
	return p, nil
}

// RenameProfile updates the label on a user-owned profile (Default
// included — users may rename "Default" if they want; uniqueness still
// holds). Ownership check folded into the UPDATE so we never read a row
// belonging to another user.
func (s *Service) RenameProfile(ctx context.Context, userID, subscriptionID, profileID uuid.UUID, label string) error {
	clean, err := validateLabel(label)
	if err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, sqlRenameUserProfile,
		clean, profileID, userID, subscriptionID)
	if err != nil {
		if isUniqueViolation(err, "uq_user_nav_profiles_label_ci") {
			return ErrDuplicateProfileLabel
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrProfileNotFound
	}
	return nil
}

// DeleteProfile removes a non-default profile. Refuses Default
// outright — every (user, subscription) must always have one. Cascade
// drops the profile's prefs rows + group placements; shared groups and
// custom pages survive (they're user-scoped, not profile-scoped).
//
// Side effects handled by FKs:
//   - user_nav_prefs rows for this profile: ON DELETE CASCADE (035)
//   - user_nav_profile_groups for this profile: ON DELETE CASCADE (034)
//   - users.active_nav_profile_id pointing here: ON DELETE SET NULL (035)
//     The next /api/nav/prefs read falls back to that user's Default.
func (s *Service) DeleteProfile(ctx context.Context, userID, subscriptionID, profileID uuid.UUID) error {
	var isDefault bool
	err := s.Pool.QueryRow(ctx, sqlSelectProfileIsDefault,
		profileID, userID, subscriptionID).Scan(&isDefault)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProfileNotFound
		}
		return err
	}
	if isDefault {
		return ErrCannotDeleteDefault
	}

	tag, err := s.Pool.Exec(ctx, sqlDeleteNonDefaultProfile,
		profileID, userID, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrProfileNotFound
	}
	return nil
}

// ReorderProfiles assigns new positions in one transaction. The input
// is the desired order: order[i] must contain the profile id that
// should land at position i. All ids must be owned by (user, sub) and
// the set must exactly match what's stored — no missing, no extras.
//
// The unique (user_id, subscription_id, position) index is DEFERRABLE
// INITIALLY DEFERRED so we can swap positions in any order inside the
// txn without intermediate collisions.
func (s *Service) ReorderProfiles(ctx context.Context, userID, subscriptionID uuid.UUID, order []uuid.UUID) error {
	if len(order) == 0 {
		return ErrBadPositions
	}
	seen := make(map[uuid.UUID]struct{}, len(order))
	for _, id := range order {
		if _, dup := seen[id]; dup {
			return ErrBadPositions
		}
		seen[id] = struct{}{}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, sqlListUserProfileIDs, userID, subscriptionID)
	if err != nil {
		return err
	}
	owned := make(map[uuid.UUID]struct{})
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		owned[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(owned) != len(order) {
		return ErrBadPositions
	}
	for _, id := range order {
		if _, ok := owned[id]; !ok {
			return ErrProfileNotFound
		}
	}

	for pos, id := range order {
		if _, err := tx.Exec(ctx, sqlUpdateProfilePosition, pos, id); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// SetActiveProfile pins users.active_nav_profile_id to the given
// profile after verifying ownership inside the same query. A profile
// from a different subscription is rejected with ErrProfileWrongSubscription
// (rather than the generic NotFound) because the client may already
// know the id exists — they're hot-desking and need a clear signal.
func (s *Service) SetActiveProfile(ctx context.Context, userID, subscriptionID, profileID uuid.UUID) error {
	var ownerID, profileSub uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlSelectProfileOwnerAndSubscription, profileID).
		Scan(&ownerID, &profileSub)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProfileNotFound
		}
		return err
	}
	if ownerID != userID {
		return ErrProfileNotFound
	}
	if profileSub != subscriptionID {
		return ErrProfileWrongSubscription
	}

	_, err = s.Pool.Exec(ctx, sqlUpdateUserActiveProfile, profileID, userID)
	return err
}

// GetActiveProfileID returns users.active_nav_profile_id when it points
// at a profile owned by this user under this subscription. Otherwise
// returns nil — callers treat that as "fall back to Default".
func (s *Service) GetActiveProfileID(ctx context.Context, userID, subscriptionID uuid.UUID) (*uuid.UUID, error) {
	var id *uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlSelectActiveProfileScoped, userID, subscriptionID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return id, nil
}

// EnsureDefaultProfile lazy-seeds a Default profile for this
// (user, subscription) if one doesn't already exist, then returns its
// id. Idempotent: races between two concurrent first-reads are
// resolved by the partial-unique index uq_user_nav_profiles_default_per_user
// — both INSERTs land at the same row, the second one no-ops.
//
// Used by:
//   - prefs reads/writes when no explicit profile_id is given (story B5)
//   - tests that create fresh users without running migration 036
func (s *Service) EnsureDefaultProfile(ctx context.Context, userID, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlSelectDefaultProfileID, userID, subscriptionID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}

	err = s.Pool.QueryRow(ctx, sqlEnsureDefaultProfile, userID, subscriptionID).Scan(&id)
	return id, err
}

// ResolveProfile picks the profile a prefs operation should target.
// Order:
//   1. explicit non-nil profileID → verify ownership, return it. 404 sentinel
//      on miss (callers should NOT lazy-seed when the client named a profile).
//   2. users.active_nav_profile_id, if it belongs to this subscription.
//   3. Default profile for (user, subscription).
//   4. Lazy-seed a Default (B5) and return that.
//
// The (active + Default) lookup runs in one query so we never see a
// partial state between writes.
func (s *Service) ResolveProfile(ctx context.Context, userID, subscriptionID uuid.UUID, explicit *uuid.UUID) (uuid.UUID, error) {
	if explicit != nil {
		if err := s.RequireOwnedProfile(ctx, userID, subscriptionID, *explicit); err != nil {
			return uuid.Nil, err
		}
		return *explicit, nil
	}

	var activeID, defaultID *uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlSelectActiveOrDefaultProfile, userID, subscriptionID).
		Scan(&activeID, &defaultID)
	if err != nil {
		return uuid.Nil, err
	}
	if activeID != nil {
		return *activeID, nil
	}
	if defaultID != nil {
		return *defaultID, nil
	}

	return s.EnsureDefaultProfile(ctx, userID, subscriptionID)
}

// ProfileGroupPlacement is the wire shape for per-profile group
// placement. Each row sets exactly one of GroupID (a custom group) or
// TagEnum (a built-in tag bucket). Position is unique within the
// profile (partial unique indexes + xor check enforce both invariants).
// Callers send a contiguous 0..N-1 sequence.
type ProfileGroupPlacement struct {
	GroupID      *uuid.UUID `json:"group_id"`
	TagEnum      *string    `json:"tag_enum"`
	Position     int        `json:"position"`
	IconOverride *string    `json:"icon_override,omitempty"`
}

// ListProfileGroups returns the placements inside a specific profile,
// in display order. Each row is either a custom-group placement or a
// tag-bucket placement (discriminated by which of GroupID/TagEnum is
// set). The shared group pool itself stays user-scoped.
func (s *Service) ListProfileGroups(ctx context.Context, userID, subscriptionID, profileID uuid.UUID) ([]ProfileGroupPlacement, error) {
	if err := s.RequireOwnedProfile(ctx, userID, subscriptionID, profileID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, sqlListProfileGroupPlacements, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ProfileGroupPlacement, 0, 4)
	for rows.Next() {
		var g ProfileGroupPlacement
		if err := rows.Scan(&g.GroupID, &g.TagEnum, &g.Position, &g.IconOverride); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// SetProfileGroups replaces the placements for one profile atomically.
// Each placement must set exactly one of GroupID (custom group) or
// TagEnum (built-in tag bucket); ErrPlacementKind otherwise. Custom
// group_ids must be owned by the user; tag_enums must exist in
// page_tags. Positions must form a contiguous 0..N-1 sequence;
// duplicates rejected. Uses the DEFERRABLE position-unique constraint
// so the wipe + re-insert can run in any order inside the txn.
//
// SHARED-POOL INVARIANT: this endpoint never inserts/updates/deletes
// rows in user_nav_groups itself. Groups are created/renamed/deleted
// only via the legacy PUT /api/nav/prefs path (Default profile) until
// that surface is split off — so a user's group pool is the union of
// what they author from Default, and per-profile placement just decides
// which of those each profile shows. Likewise, page_tags is read-only
// from this surface — tag enums must already exist.
func (s *Service) SetProfileGroups(ctx context.Context, userID, subscriptionID, profileID uuid.UUID, placements []ProfileGroupPlacement) error {
	if err := s.RequireOwnedProfile(ctx, userID, subscriptionID, profileID); err != nil {
		return err
	}

	posSeen := make(map[int]struct{}, len(placements))
	groupSeen := make(map[uuid.UUID]struct{}, len(placements))
	tagSeen := make(map[string]struct{}, len(placements))
	for _, p := range placements {
		if p.Position < 0 {
			return ErrBadPositions
		}
		hasGroup := p.GroupID != nil
		hasTag := p.TagEnum != nil
		if hasGroup == hasTag {
			return ErrPlacementKind
		}
		if _, dup := posSeen[p.Position]; dup {
			return ErrBadPositions
		}
		posSeen[p.Position] = struct{}{}
		if hasGroup {
			if _, dup := groupSeen[*p.GroupID]; dup {
				return ErrBadPositions
			}
			groupSeen[*p.GroupID] = struct{}{}
		} else {
			if _, dup := tagSeen[*p.TagEnum]; dup {
				return ErrBadPositions
			}
			tagSeen[*p.TagEnum] = struct{}{}
		}
	}
	for i := 0; i < len(placements); i++ {
		if _, ok := posSeen[i]; !ok {
			return ErrBadPositions
		}
	}

	if len(groupSeen) > 0 {
		ids := make([]uuid.UUID, 0, len(groupSeen))
		for id := range groupSeen {
			ids = append(ids, id)
		}
		var owned int
		err := s.Pool.QueryRow(ctx, sqlCountOwnedNavGroupsByIDs, userID, ids).Scan(&owned)
		if err != nil {
			return err
		}
		if owned != len(ids) {
			return ErrUnknownGroup
		}
	}

	if len(tagSeen) > 0 {
		tags := make([]string, 0, len(tagSeen))
		for t := range tagSeen {
			tags = append(tags, t)
		}
		var known int
		err := s.Pool.QueryRow(ctx, sqlCountKnownTagEnums, tags).Scan(&known)
		if err != nil {
			return err
		}
		if known != len(tags) {
			return ErrUnknownTag
		}
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, sqlDeleteProfileGroupPlacements, profileID); err != nil {
		return err
	}

	if len(placements) > 0 {
		batch := &pgx.Batch{}
		for _, p := range placements {
			batch.Queue(sqlInsertProfileGroupPlacement,
				profileID, p.GroupID, p.TagEnum, p.Position, p.IconOverride)
		}
		br := tx.SendBatch(ctx, batch)
		for range placements {
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

// isUniqueViolation reports whether err is a Postgres 23505 unique-
// constraint violation that mentions the named constraint. Tolerates
// non-pg errors and unwraps via errors.As.
func isUniqueViolation(err error, constraint string) bool {
	type pgErr interface {
		SQLState() string
	}
	var pe pgErr
	if !errors.As(err, &pe) {
		return false
	}
	if pe.SQLState() != "23505" {
		return false
	}
	return strings.Contains(err.Error(), constraint)
}
