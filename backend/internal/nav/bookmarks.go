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

var (
	ErrUnknownEntityKind = errors.New("unknown entity_kind")
	ErrEntityNotFound    = errors.New("entity not found or not visible")
	ErrEntityArchived    = errors.New("entity is archived")
	ErrBookmarkCap       = errors.New("bookmark cap reached")
)

// Bookmarks owns the bookmark lifecycle: pin, unpin, list. It coexists
// with Service rather than being folded into it because the surface is
// distinct (single-entity ops vs. bulk pref replace) and the concerns
// are different (entity access checks vs. catalogue/role validation).
type Bookmarks struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
}

func NewBookmarks(pool *pgxpool.Pool, registry *CachedRegistry) *Bookmarks {
	return &Bookmarks{Pool: pool, Registry: registry}
}

// itemKey returns the canonical item_key / pages.key_enum for an entity.
// Format: "entity:<kind>:<uuid>". Stable across renames; only the page
// label changes when the underlying entity is renamed.
func itemKey(kind EntityKind, id uuid.UUID) string {
	return fmt.Sprintf("entity:%s:%s", kind, id.String())
}

// ParseEntityKey returns (kind, id, true) when key matches the entity
// pattern. False on any malformed input — never panics.
func ParseEntityKey(key string) (EntityKind, uuid.UUID, bool) {
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 || parts[0] != "entity" {
		return "", uuid.Nil, false
	}
	kind := EntityKind(parts[1])
	if !kind.Valid() {
		return "", uuid.Nil, false
	}
	id, err := uuid.Parse(parts[2])
	if err != nil {
		return "", uuid.Nil, false
	}
	return kind, id, true
}

// loadEntity fetches the bare minimum needed to mint a page: name,
// tenant_id, archived state. Tenant fence: the caller's tenant must
// match the entity's tenant. Archived entities cannot be bookmarked.
func (b *Bookmarks) loadEntity(ctx context.Context, q pgx.Tx, kind EntityKind, id uuid.UUID, callerTenant uuid.UUID) (name string, tenantID uuid.UUID, err error) {
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
	row := q.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, tenant_id, archived_at::text FROM %s WHERE id = $1`, table), id)
	if err := row.Scan(&name, &tenantID, &archived); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", uuid.Nil, ErrEntityNotFound
		}
		return "", uuid.Nil, err
	}
	if tenantID != callerTenant {
		// Don't leak existence — same error as not-found.
		return "", uuid.Nil, ErrEntityNotFound
	}
	if archived != nil {
		return "", uuid.Nil, ErrEntityArchived
	}
	return name, tenantID, nil
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
//  2. Get-or-create the shared pages row (tenant_id = entity tenant)
//  3. Get-or-create the page_entity_refs backlink
//  4. Ensure all roles have access via page_roles (idempotent)
//  5. Insert user_nav_prefs at end of bookmarks group (idempotent)
//  6. Bust the registry cache so the next catalogue read picks up the new page
func (b *Bookmarks) Pin(ctx context.Context, userID, callerTenant uuid.UUID, role models.Role, kind EntityKind, entityID uuid.UUID) (string, error) {
	if !kind.Valid() {
		return "", ErrUnknownEntityKind
	}
	key := itemKey(kind, entityID)

	tx, err := b.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	name, entityTenant, err := b.loadEntity(ctx, tx, kind, entityID, callerTenant)
	if err != nil {
		return "", err
	}

	// Cap: count existing bookmarks for this user before adding.
	// Cheap COUNT — the unique index on (user, tenant, profile, item_key)
	// makes the scan tight.
	var current int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_nav_prefs unp
		JOIN pages p ON p.key_enum = unp.item_key
		WHERE unp.user_id = $1 AND unp.tenant_id = $2 AND unp.profile_id IS NULL
		  AND p.tag_enum = 'bookmarks'`, userID, callerTenant).Scan(&current); err != nil {
		return "", err
	}
	if current >= MaxPinned {
		return "", fmt.Errorf("%w: %d >= %d", ErrBookmarkCap, current, MaxPinned)
	}

	// Get-or-create pages row. ON CONFLICT on (key_enum, tenant_id, created_by)
	// — for entity rows created_by is NULL so the unique index treats them
	// as one shared page per entity per tenant.
	var pageID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind,
		                   pinnable, default_pinned, default_order,
		                   created_by, tenant_id)
		VALUES ($1, $2, $3, $4, 'bookmarks', 'entity', TRUE, FALSE, 0, NULL, $5)
		ON CONFLICT (key_enum, tenant_id, created_by) DO UPDATE
		  SET label = EXCLUDED.label, updated_at = NOW()
		RETURNING id`,
		key, name, hrefFor(kind, entityID), iconFor(kind), entityTenant,
	).Scan(&pageID); err != nil {
		return "", err
	}

	// Polymorphic backlink — one row per real entity.
	if _, err := tx.Exec(ctx, `
		INSERT INTO page_entity_refs (page_id, entity_kind, entity_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (entity_kind, entity_id) DO NOTHING`,
		pageID, string(kind), entityID,
	); err != nil {
		return "", err
	}

	// Grant access to all roles. A bookmark sits in the user's own pinned
	// list; per-tenant role gating on the page row itself is uniform.
	for _, r := range []models.Role{models.RoleUser, models.RolePAdmin, models.RoleGAdmin} {
		_ = r // keep r in scope for the closure below
		if _, err := tx.Exec(ctx, `
			INSERT INTO page_roles (page_id, role) VALUES ($1, $2)
			ON CONFLICT (page_id, role) DO NOTHING`, pageID, string(r)); err != nil {
			return "", err
		}
	}

	// Append to user's bookmarks group. Compute next position as
	// max(position over user_nav_prefs for this user/tenant) + 1; that
	// keeps the global position contiguity invariant intact (validated
	// elsewhere on bulk replace).
	var nextPos int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position) + 1, 0)
		FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL`,
		userID, callerTenant).Scan(&nextPos); err != nil {
		return "", err
	}

	// Idempotent: ON CONFLICT (user, tenant, profile, item_key) DO NOTHING
	// means a second pin is a no-op rather than an error — friendlier UX
	// and matches what the caller probably expected.
	tag, err := tx.Exec(ctx, `
		INSERT INTO user_nav_prefs (user_id, tenant_id, profile_id, item_key, position, is_start_page)
		VALUES ($1, $2, NULL, $3, $4, FALSE)
		ON CONFLICT (user_id, tenant_id, profile_id, item_key) DO NOTHING`,
		userID, callerTenant, key, nextPos)
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
func (b *Bookmarks) Unpin(ctx context.Context, userID, callerTenant uuid.UUID, kind EntityKind, entityID uuid.UUID) error {
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
	if err := tx.QueryRow(ctx, `
		SELECT position FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL AND item_key = $3`,
		userID, callerTenant, key).Scan(&removed); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx) // not pinned — nothing to do
		}
		return err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL AND item_key = $3`,
		userID, callerTenant, key); err != nil {
		return err
	}

	// Compact positions: everything above the removed slot shifts down
	// by one so positions remain contiguous 0..N-1. The unique index on
	// (user, tenant, profile, position) is DEFERRABLE so the bulk
	// shift commits cleanly without temp positions.
	if removed != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE user_nav_prefs SET position = position - 1
			WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL AND position > $3`,
			userID, callerTenant, *removed); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// IsPinned returns true if this user has the entity pinned in their
// current tenant. Cheap point lookup — used to drive pin-button state.
func (b *Bookmarks) IsPinned(ctx context.Context, userID, callerTenant uuid.UUID, kind EntityKind, entityID uuid.UUID) (bool, error) {
	if !kind.Valid() {
		return false, ErrUnknownEntityKind
	}
	key := itemKey(kind, entityID)
	var n int
	err := b.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL AND item_key = $3`,
		userID, callerTenant, key).Scan(&n)
	return n > 0, err
}
