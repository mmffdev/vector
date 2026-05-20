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
	loadedAt   time.Time
}

// TagGroup is a row from page_tags, plus a resolved display name.
//
// TD-NAV-001: EnvOnly is the optional env restriction. NULL/empty = the
// tag is visible in every env (default); any other value (e.g. "dev")
// restricts the tag to that env. Compared against BACKEND_ENV at
// registry-load time; tags that don't match are dropped from the
// catalogue before per-user filtering.
//
// PLA-0053 (B5.11–B5.12): the legacy MinAuthLevel tier gate is gone.
// Tag visibility is now derived from page-grant fan-out — TagsFor only
// returns tags that have at least one page the caller can see via
// users_roles_pages. IsAdminMenu is kept because it's used by the
// avatar/notification dropdown router, not the page-access gate.
type TagGroup struct {
	Enum         string  `json:"enum"`
	Label        string  `json:"label"`
	DefaultOrder int     `json:"defaultOrder"`
	IsAdminMenu  bool    `json:"isAdminMenu"`
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
		if err := tagRows.Scan(&t.Enum, &t.Label, &t.DefaultOrder, &t.IsAdminMenu, &t.EnvOnly); err != nil {
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

	return &Registry{
		entries:    entries,
		byKey:      byKey,
		tags:       tags,
		tagsByEnum: tagsByEnum,
		loadedAt:   time.Now(),
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

// CatalogFor returns entries visible to (roleID, tenant), in canonical
// order. One gate applies:
//
//   roleAllowed(roleID, page.RoleIDs) — the per-page role grant in
//   users_roles_pages (PLA-0049). This is the sole page-access gate
//   after PLA-0053: the permissions matrix at /user-management/permissions
//   writes this table, and that's the only place page visibility is
//   configured. There is no separate tier filter anymore.
//
// Static pages (SubscriptionID == nil) appear for every tenant; entity
// pages appear only for users in their owning tenant.
func (r *Registry) CatalogFor(roleID uuid.UUID, subscriptionID uuid.UUID) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(r.entries))
	for _, e := range r.entries {
		if !roleAllowed(roleID, e.RoleIDs) {
			continue
		}
		if e.SubscriptionID != nil && *e.SubscriptionID != subscriptionID {
			continue
		}
		out = append(out, e)
	}
	return out
}

// Tags returns every tag group in default order, regardless of caller.
// Internal use (registry-self plumbing, tests, admin tooling). HTTP
// handlers MUST use TagsFor so tags with zero visible pages don't leak
// to callers who can't see any of their contents.
func (r *Registry) Tags() []TagGroup {
	return r.tags
}

// TagsFor returns the tag groups visible to (roleID, subscriptionID):
// only tags that contain at least one page the caller can reach via
// users_roles_pages. The rule "tag visible iff a granted page lives in
// it" replaces the previous min_auth_level tier gate (PLA-0053) — there
// is now a single authoritative source for both page and tag visibility,
// and that source is the permissions matrix at /user-management/permissions.
//
// Procurement / SOC2 narrative: a tampered client cannot re-introduce
// admin tags it has no granted pages for, because the server never emits
// those tag enums in the catalogue response. Enumerating admin surfaces
// is impossible without holding ≥1 grant in them.
func (r *Registry) TagsFor(roleID uuid.UUID, subscriptionID uuid.UUID) []TagGroup {
	visible := make(map[string]bool, len(r.tagsByEnum))
	for _, e := range r.entries {
		if !roleAllowed(roleID, e.RoleIDs) {
			continue
		}
		if e.SubscriptionID != nil && *e.SubscriptionID != subscriptionID {
			continue
		}
		visible[e.TagEnum] = true
	}
	out := make([]TagGroup, 0, len(visible))
	for _, t := range r.tags {
		if visible[t.Enum] {
			out = append(out, t)
		}
	}
	return out
}

// TagByEnum returns the tag group for an enum, or (zero, false).
func (r *Registry) TagByEnum(enum string) (TagGroup, bool) {
	t, ok := r.tagsByEnum[enum]
	return t, ok
}
