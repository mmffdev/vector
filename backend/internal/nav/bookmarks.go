package nav

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/polymorphicrefs"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// EntityKind names a real-world thing a user can bookmark.
// Mirrors the CHECK constraint on page_entity_refs.entity_kind.
type EntityKind string

const (
	EntityKindPortfolio EntityKind = "portfolio"
	EntityKindProduct   EntityKind = "product"
)

func (k EntityKind) Valid() bool {
	return k == EntityKindPortfolio || k == EntityKindProduct
}

// Re-export the polymorphic sentinels so existing handler code that
// switches on nav.ErrEntityNotFound etc. keeps working unchanged. The
// underlying value lives in entityrefs and is shared across every
// polymorphic writer.
var (
	ErrUnknownEntityKind = polymorphicrefs.ErrUnknownEntityKind
	ErrEntityNotFound    = polymorphicrefs.ErrEntityNotFound
	ErrEntityArchived    = polymorphicrefs.ErrEntityArchived
	ErrBookmarkCap       = errors.New("bookmark cap reached")
)

// Bookmarks owns the bookmark lifecycle: pin, unpin, list. It coexists
// with Service rather than being folded into it because the surface is
// distinct (single-entity ops vs. bulk pref replace) and the concerns
// are different (entity access checks vs. catalogue/role validation).
//
// Polymorphic concerns (parent existence, tenant fence, archive
// rejection, page_entity_refs writes) delegate to polymorphicrefs.Service —
// the same service every other writer uses, so the rules are expressed
// once. See docs/c_polymorphic_writes.md.
type Bookmarks struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
	Refs     *polymorphicrefs.Service
}

func NewBookmarks(pool *pgxpool.Pool, registry *CachedRegistry) *Bookmarks {
	return &Bookmarks{Pool: pool, Registry: registry, Refs: polymorphicrefs.New(pool)}
}

// itemKey returns the canonical item_key / pages.key_enum for an entity.
// Format: "entity:<kind>:<uuid>". Stable across renames; only the page
// label changes when the underlying entity is renamed.
func itemKey(kind EntityKind, id uuid.UUID) string {
	return fmt.Sprintf("entity:%s:%s", kind, id.String())
}

// tagEnumForBookmark picks the page_tags row a freshly-bookmarked entity
// lands in. Products live alongside other strategic pages; portfolios
// remain in the dedicated Bookmarks group. Both still count toward the
// per-user bookmark cap (tracked by kind='entity', not by tag).
func tagEnumForBookmark(kind EntityKind) string {
	switch kind {
	case EntityKindProduct:
		return "strategic"
	default:
		return "bookmarks"
	}
}

// loadEntity fetches the bare minimum needed to mint a page: name,
// subscription_id, archived state. Tenant fence: the caller's tenant must
// match the entity's tenant. Archived entities cannot be bookmarked.
func (b *Bookmarks) loadEntity(ctx context.Context, q pgx.Tx, kind EntityKind, id uuid.UUID, callerSubscription uuid.UUID) (name string, subscriptionID uuid.UUID, err error) {
	var table string
	switch kind {
	case EntityKindPortfolio:
		table = "portfolio"
	case EntityKindProduct:
		table = "product"
	default:
		return "", uuid.Nil, ErrUnknownEntityKind
	}
	var archived *string
	// SQL injection note: table is a hard-coded enum, never user input.
	row := q.QueryRow(ctx, fmt.Sprintf(sqlSelectEntityForBookmarkTemplate, table), id)
	if err := row.Scan(&name, &subscriptionID, &archived); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", uuid.Nil, ErrEntityNotFound
		}
		return "", uuid.Nil, err
	}
	if subscriptionID != callerSubscription {
		// Don't leak existence — same error as not-found.
		return "", uuid.Nil, ErrEntityNotFound
	}
	if archived != nil {
		return "", uuid.Nil, ErrEntityArchived
	}
	return name, subscriptionID, nil
}

// hrefFor returns the canonical detail-page URL for an entity. These
// routes don't all exist as filesystem pages yet; the bookmark stores
// the link so navigation lands somewhere coherent once they do.
func hrefFor(kind EntityKind, id uuid.UUID) string {
	return fmt.Sprintf("/%s/%s", kind, id.String())
}

// iconFor picks a sensible icon name for an entity bookmark. Names match
// the keys handled by the frontend's IconFor switch in AppSidebar.
func iconFor(kind EntityKind) string {
	switch kind {
	case EntityKindPortfolio:
		return "folder"
	case EntityKindProduct:
		return "package"
	default:
		return "pin"
	}
}

// Pin bookmarks an entity for the caller. Returns the item_key so the
// frontend can confirm without a follow-up read.
//
// Flow (single transaction):
//  1. Validate kind, fetch entity (tenant fence + archive check)
//  2. Get-or-create the shared pages row (subscription_id = entity tenant)
//  3. Get-or-create the page_entity_refs backlink
//  4. Ensure all roles have access via page_roles (idempotent)
//  5. Insert users_nav_prefs at end of bookmarks group (idempotent)
//  6. Bust the registry cache so the next catalogue read picks up the new page
func (b *Bookmarks) Pin(ctx context.Context, userID, callerSubscription uuid.UUID, role roletypes.Role, kind EntityKind, entityID uuid.UUID) (string, error) {
	if !kind.Valid() {
		return "", ErrUnknownEntityKind
	}
	key := itemKey(kind, entityID)

	tx, err := b.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	name, entityTenant, err := b.loadEntity(ctx, tx, kind, entityID, callerSubscription)
	if err != nil {
		return "", err
	}

	// Serialise concurrent Pin/Unpin for this user so the cap COUNT
	// reflects all in-flight transactions. Without this lock two parallel
	// Pin calls both read COUNT < cap and both insert, breaching MaxPinned.
	// hashtextextended → bigint key into pg_advisory_xact_lock; lock is
	// released at commit/rollback automatically.
	if _, err := tx.Exec(ctx, sqlPgAdvisoryXactLockForPin, userID); err != nil {
		return "", err
	}

	// Cap: count existing bookmarks for this user before adding.
	// Cheap COUNT — the unique index on (user, tenant, profile, item_key)
	// makes the scan tight. Filter by kind='entity' rather than tag_enum
	// so the cap survives entity bookmarks landing in different tag
	// groups (e.g. product → 'strategic', portfolio → 'bookmarks').
	var current int
	if err := tx.QueryRow(ctx, sqlCountUserEntityBookmarks, userID, callerSubscription).Scan(&current); err != nil {
		return "", err
	}
	if current >= MaxPinned {
		return "", fmt.Errorf("%w: %d >= %d", ErrBookmarkCap, current, MaxPinned)
	}

	// Get-or-create pages row. The partial unique index
	// pages_unique_key_shared_tenant covers (key_enum, subscription_id) WHERE
	// created_by IS NULL, so two consecutive Pin calls collapse onto the
	// same row instead of duplicating it (NULL-distinct semantics on the
	// old plain UNIQUE constraint produced phantom duplicates).
	var pageID uuid.UUID
	if err := tx.QueryRow(ctx, sqlUpsertSharedEntityPage,
		key, name, hrefFor(kind, entityID), iconFor(kind), tagEnumForBookmark(kind), entityTenant,
	).Scan(&pageID); err != nil {
		return "", err
	}

	// Polymorphic backlink — one row per real entity. Delegated to
	// entityrefs so the parent-existence + tenant + archive checks (and
	// the eventual move to per-kind tables in TD-001 Phase 4) live in one
	// place. loadEntity above already performed the same checks; the
	// duplicate inside InsertPageEntityRef is cheap (FOR UPDATE on a row
	// we've just selected) and keeps writers obliged to route through
	// the shared service.
	if err := b.Refs.InsertPageEntityRef(ctx, tx, pageID, polymorphicrefs.EntityKind(kind), entityID, callerSubscription); err != nil {
		return "", err
	}

	// Grant access to all roles. A bookmark sits in the user's own pinned
	// list; per-tenant role gating on the page row itself is uniform.
	for _, r := range []roletypes.Role{roletypes.RoleUser, roletypes.RolePAdmin, roletypes.RoleGAdmin} {
		_ = r // keep r in scope for the closure below
		if _, err := tx.Exec(ctx, sqlUpsertPageRoleGrant, pageID, string(r)); err != nil {
			return "", err
		}
	}

	// Append to user's bookmarks group. Compute next position as
	// max(position over users_nav_prefs for this user/tenant) + 1; that
	// keeps the global position contiguity invariant intact (validated
	// elsewhere on bulk replace).
	var nextPos int
	if err := tx.QueryRow(ctx, sqlNextUserNavPrefPosition, userID, callerSubscription).Scan(&nextPos); err != nil {
		return "", err
	}

	// Idempotent: ON CONFLICT (user, tenant, profile, item_key) DO NOTHING
	// means a second pin is a no-op rather than an error — friendlier UX
	// and matches what the caller probably expected.
	tag, err := tx.Exec(ctx, sqlInsertUserNavPrefBookmark,
		userID, callerSubscription, key, nextPos)
	if err != nil {
		return "", err
	}
	_ = tag

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	// Force registry refresh so the next /api/nav/catalogue call sees
	// the new entity page. Without this, the 60s TTL window leaves
	// freshly bookmarked items as "unknown key" until expiry.
	if _, err := b.Registry.Load(ctx); err != nil {
		// Non-fatal: stale cache merely delays visibility, doesn't break.
		// Caller's next save will see ErrUnknownItemKey if catalogue
		// hasn't refreshed; the front-end re-fetches on bookmark anyway.
		_ = err
	}
	return key, nil
}

// Unpin removes a bookmark from the caller's pinned list. Idempotent —
// removing something that isn't pinned is not an error. The shared
// pages row is left in place; other users may still have it pinned.
func (b *Bookmarks) Unpin(ctx context.Context, userID, callerSubscription uuid.UUID, kind EntityKind, entityID uuid.UUID) error {
	if !kind.Valid() {
		return ErrUnknownEntityKind
	}
	key := itemKey(kind, entityID)

	tx, err := b.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Find position of the row we're removing so we can compact later.
	var removed *int
	if err := tx.QueryRow(ctx, sqlSelectUserNavPrefPositionByKey,
		userID, callerSubscription, key).Scan(&removed); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx) // not pinned — nothing to do
		}
		return err
	}

	if _, err := tx.Exec(ctx, sqlDeleteUserNavPrefByKey,
		userID, callerSubscription, key); err != nil {
		return err
	}

	// Compact positions: everything above the removed slot shifts down
	// by one so positions remain contiguous 0..N-1. The unique index on
	// (user, tenant, profile, position) is DEFERRABLE so the bulk
	// shift commits cleanly without temp positions.
	if removed != nil {
		if _, err := tx.Exec(ctx, sqlCompactUserNavPrefPositionsAbove,
			userID, callerSubscription, *removed); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// IsPinned returns true if this user has the entity pinned in their
// current tenant. Cheap point lookup — used to drive pin-button state.
func (b *Bookmarks) IsPinned(ctx context.Context, userID, callerSubscription uuid.UUID, kind EntityKind, entityID uuid.UUID) (bool, error) {
	if !kind.Valid() {
		return false, ErrUnknownEntityKind
	}
	key := itemKey(kind, entityID)
	var n int
	err := b.Pool.QueryRow(ctx, sqlCountUserNavPrefByKey,
		userID, callerSubscription, key).Scan(&n)
	return n > 0, err
}
