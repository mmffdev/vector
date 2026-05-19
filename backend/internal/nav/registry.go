package nav

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// currentBackendEnv returns the BACKEND_ENV the process is running
// against ("dev" / "staging" / "production"). Defaults to "dev" if
// unset so unit tests + local runs see the default rail.
func currentBackendEnv() string {
	if v := os.Getenv("BACKEND_ENV"); v != "" {
		return v
	}
	return "dev"
}

// Registry holds the catalogue loaded from the pages / page_tags /
// page_roles tables. It replaces the hand-coded static slice.
//
// Reads are lock-free after load (snapshot pattern): LoadRegistry produces
// a new immutable snapshot, then swaps a pointer. Callers that already
// hold a *Registry can keep reading their snapshot safely even during a
// refresh. A mutex guards only the swap path.
type Registry struct {
	entries    []CatalogEntry
	byKey      map[string]CatalogEntry
	tags       []TagGroup
	tagsByEnum map[string]TagGroup
	// roleRankByID maps users_roles.id → users_roles.rank so the
	// per-request auth_level derivation does not hit the DB. Loaded once
	// per registry refresh (TTL — same cadence as tag/page reloads).
	roleRankByID map[uuid.UUID]int
	loadedAt     time.Time
}

// TagGroup is a row from page_tags, plus a resolved display name.
//
// TD-NAV-001: EnvOnly is the optional env restriction. NULL/empty = the
// tag is visible in every env (default); any other value (e.g. "dev")
// restricts the tag to that env. Compared against BACKEND_ENV at
// registry-load time; tags that don't match are dropped from the
// catalogue before per-user filtering.
type TagGroup struct {
	Enum         string  `json:"enum"`
	Label        string  `json:"label"`
	DefaultOrder int     `json:"defaultOrder"`
	IsAdminMenu  bool    `json:"isAdminMenu"`
	// MinAuthLevel is the minimum admin tier required to see this tag on
	// the primary rail. 1 = Vector Admin, 2 = Workspace Admin, 3 =
	// everyone. Compared client-side against the user's derived
	// auth_level (Global Admin → 1, Portfolio Manager → 2, else → 3).
	MinAuthLevel int     `json:"minAuthLevel"`
	EnvOnly      *string `json:"-"` // omitted from wire; filter-only
}

// CachedRegistry wraps a Registry with a TTL so callers refresh at most
// once per TTL interval. Safe for concurrent use.
type CachedRegistry struct {
	pool *pgxpool.Pool
	ttl  time.Duration

	mu      sync.Mutex
	current *Registry
}

// NewCachedRegistry returns a CachedRegistry but does NOT prime it;
// call Load once at startup so a failing DB fails fast instead of
// silently serving a stale/empty catalogue.
func NewCachedRegistry(pool *pgxpool.Pool, ttl time.Duration) *CachedRegistry {
	return &CachedRegistry{pool: pool, ttl: ttl}
}

// Load forces a fresh read from the database and replaces the cached
// snapshot. Returns the new snapshot.
func (c *CachedRegistry) Load(ctx context.Context) (*Registry, error) {
	r, err := LoadRegistry(ctx, c.pool)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.current = r
	c.mu.Unlock()
	return r, nil
}

// Get returns the current snapshot, refreshing if the TTL has elapsed.
// On refresh failure it returns the stale snapshot with a nil error
// (serving stale data beats breaking every request); the error is logged
// by the caller's middleware if needed.
func (c *CachedRegistry) Get(ctx context.Context) (*Registry, error) {
	c.mu.Lock()
	snap := c.current
	fresh := snap != nil && time.Since(snap.loadedAt) < c.ttl
	c.mu.Unlock()

	if fresh {
		return snap, nil
	}

	r, err := LoadRegistry(ctx, c.pool)
	if err != nil {
		if snap != nil {
			return snap, nil
		}
		return nil, err
	}
	c.mu.Lock()
	c.current = r
	c.mu.Unlock()
	return r, nil
}

// LoadRegistry reads pages, page_tags, and page_roles in a single
// snapshot transaction so a concurrent admin write can't produce a
// half-consistent view (e.g. a page with no roles).
func LoadRegistry(ctx context.Context, pool *pgxpool.Pool) (*Registry, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("nav registry: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Tags first — small, needed for page rows to validate.
	tagRows, err := tx.Query(ctx, sqlListPageTags)
	if err != nil {
		return nil, fmt.Errorf("nav registry: query tags: %w", err)
	}
	env := currentBackendEnv()
	var tags []TagGroup
	tagsByEnum := make(map[string]TagGroup)
	for tagRows.Next() {
		var t TagGroup
		if err := tagRows.Scan(&t.Enum, &t.Label, &t.DefaultOrder, &t.IsAdminMenu, &t.MinAuthLevel, &t.EnvOnly); err != nil {
			tagRows.Close()
			return nil, fmt.Errorf("nav registry: scan tag: %w", err)
		}
		// TD-NAV-001: drop tags that are restricted to a different env.
		if t.EnvOnly != nil && *t.EnvOnly != "" && *t.EnvOnly != env {
			continue
		}
		tags = append(tags, t)
		tagsByEnum[t.Enum] = t
	}
	tagRows.Close()
	if err := tagRows.Err(); err != nil {
		return nil, fmt.Errorf("nav registry: tag rows: %w", err)
	}

	// Pages + aggregated roles in one query so we don't N+1.
	// Includes system-scoped pages (created_by IS NULL AND subscription_id IS NULL)
	// and tenant-scoped entity pages (created_by IS NULL AND subscription_id IS NOT NULL,
	// kind = 'entity'). Tenant scoping at the row level is fine here: a user
	// only ever has prefs in their own tenant, and the catalogue handler
	// further filters to entity rows that user has actually pinned.
	// User-custom pages light up when that feature lands.
	pageRows, err := tx.Query(ctx, sqlListSystemPagesWithRoles)
	if err != nil {
		return nil, fmt.Errorf("nav registry: query pages: %w", err)
	}
	defer pageRows.Close()

	var entries []CatalogEntry
	byKey := make(map[string]CatalogEntry)
	for pageRows.Next() {
		var e CatalogEntry
		var kind string
		if err := pageRows.Scan(
			&e.Key, &e.Label, &e.Href, &e.Icon, &e.TagEnum, &kind,
			&e.Pinnable, &e.DefaultPinned, &e.DefaultOrder, &e.SubscriptionID, &e.RoleIDs,
		); err != nil {
			return nil, fmt.Errorf("nav registry: scan page: %w", err)
		}
		e.Kind = NavItemKind(kind)
		// TD-NAV-001: skip pages whose tag was env-filtered out. The tag
		// is a FK in the DB so the row exists in pages_tags; tagsByEnum
		// only carries env-matched tags after the filter loop above.
		if _, ok := tagsByEnum[e.TagEnum]; !ok {
			continue
		}
		entries = append(entries, e)
		byKey[e.Key] = e
	}
	if err := pageRows.Err(); err != nil {
		return nil, fmt.Errorf("nav registry: page rows: %w", err)
	}

	// Role rank map — drives server-side auth_level filtering on
	// CatalogFor / TagsFor. Loaded inside the same snapshot tx so the
	// rank values match whatever role rows existed when pages/tags were
	// scanned. Tenant-custom roles are included; they slot into the
	// 1/2/3 tiers via the same rank thresholds as system roles.
	rankRows, err := tx.Query(ctx, sqlListRoleRanks)
	if err != nil {
		return nil, fmt.Errorf("nav registry: query role ranks: %w", err)
	}
	roleRankByID := make(map[uuid.UUID]int)
	for rankRows.Next() {
		var id uuid.UUID
		var rank int
		if err := rankRows.Scan(&id, &rank); err != nil {
			rankRows.Close()
			return nil, fmt.Errorf("nav registry: scan role rank: %w", err)
		}
		roleRankByID[id] = rank
	}
	rankRows.Close()
	if err := rankRows.Err(); err != nil {
		return nil, fmt.Errorf("nav registry: role rank rows: %w", err)
	}

	return &Registry{
		entries:      entries,
		byKey:        byKey,
		tags:         tags,
		tagsByEnum:   tagsByEnum,
		roleRankByID: roleRankByID,
		loadedAt:     time.Now(),
	}, nil
}

// Find returns the entry for a key, or (zero, false).
func (r *Registry) Find(key string) (CatalogEntry, bool) {
	e, ok := r.byKey[key]
	return e, ok
}

// IsPinnable reports whether a key exists AND is pinnable.
func (r *Registry) IsPinnable(key string) bool {
	e, ok := r.byKey[key]
	return ok && e.Pinnable
}

// authLevelFor maps a role UUID to its admin tier (1/2/3) using the
// preloaded rank table. Lower number = higher privilege.
//
//   rank ≥ 70 → 1 (Vector Admin)
//   rank ≥ 60 → 2 (Workspace Admin)
//   else      → 3 (Everyone)
//
// An unknown roleID (e.g. a tenant-custom role created after the
// registry's last refresh) gets the safest fallback: tier 3. The cache
// will pick it up on the next TTL.
func (r *Registry) authLevelFor(roleID uuid.UUID) int {
	rank, ok := r.roleRankByID[roleID]
	if !ok {
		return 3
	}
	if rank >= 70 {
		return 1
	}
	if rank >= 60 {
		return 2
	}
	return 3
}

// CatalogFor returns entries visible to (roleID, tenant), in canonical
// order. Two filters are applied:
//
//   1. roleAllowed(roleID, page.RoleIDs) — the per-page role grant
//      (PLA-0049); unchanged.
//   2. tag.MinAuthLevel — server-side admin-tier gate so a Team Member
//      cannot enumerate admin-surface pages (Vector Admin / Workspace
//      Admin / User Management / Dev Tools) even by tampering with the
//      client. This is the authoritative gate; the rail's client-side
//      filter is defence-in-depth.
//
// Static pages (SubscriptionID == nil) appear for every tenant; entity
// pages appear only for users in their owning tenant.
func (r *Registry) CatalogFor(roleID uuid.UUID, subscriptionID uuid.UUID) []CatalogEntry {
	level := r.authLevelFor(roleID)
	out := make([]CatalogEntry, 0, len(r.entries))
	for _, e := range r.entries {
		if !roleAllowed(roleID, e.RoleIDs) {
			continue
		}
		if e.SubscriptionID != nil && *e.SubscriptionID != subscriptionID {
			continue
		}
		// Admin-tier gate via the page's tag. Pages under a tag the
		// caller isn't cleared for are dropped from the catalogue
		// payload entirely.
		if tag, ok := r.tagsByEnum[e.TagEnum]; ok {
			if level > tag.MinAuthLevel {
				continue
			}
		}
		out = append(out, e)
	}
	return out
}

// Tags returns every tag group in default order, regardless of caller.
// Internal use (registry-self plumbing, tests, admin tooling). HTTP
// handlers MUST use TagsFor so admin tags don't leak to lower-tier
// callers.
func (r *Registry) Tags() []TagGroup {
	return r.tags
}

// TagsFor returns the tag groups visible to (roleID), filtered by the
// admin-tier gate (MinAuthLevel). This is the authoritative server-side
// filter for the nav rail — a lower-tier user's response will not
// contain the admin-only tag enums at all, so client tampering cannot
// re-introduce them.
func (r *Registry) TagsFor(roleID uuid.UUID) []TagGroup {
	level := r.authLevelFor(roleID)
	out := make([]TagGroup, 0, len(r.tags))
	for _, t := range r.tags {
		if level > t.MinAuthLevel {
			continue
		}
		out = append(out, t)
	}
	return out
}

// TagByEnum returns the tag group for an enum, or (zero, false).
func (r *Registry) TagByEnum(enum string) (TagGroup, bool) {
	t, ok := r.tagsByEnum[enum]
	return t, ok
}
