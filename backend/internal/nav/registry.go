package nav

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/models"
)

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
type TagGroup struct {
	Enum         string `json:"enum"`
	Label        string `json:"label"`
	DefaultOrder int    `json:"defaultOrder"`
	IsAdminMenu  bool   `json:"isAdminMenu"`
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
	tagRows, err := tx.Query(ctx, `
		SELECT tag_enum, display_name, default_order, is_admin_menu
		FROM page_tags
		ORDER BY default_order`)
	if err != nil {
		return nil, fmt.Errorf("nav registry: query tags: %w", err)
	}
	var tags []TagGroup
	tagsByEnum := make(map[string]TagGroup)
	for tagRows.Next() {
		var t TagGroup
		if err := tagRows.Scan(&t.Enum, &t.Label, &t.DefaultOrder, &t.IsAdminMenu); err != nil {
			tagRows.Close()
			return nil, fmt.Errorf("nav registry: scan tag: %w", err)
		}
		tags = append(tags, t)
		tagsByEnum[t.Enum] = t
	}
	tagRows.Close()
	if err := tagRows.Err(); err != nil {
		return nil, fmt.Errorf("nav registry: tag rows: %w", err)
	}

	// Pages + aggregated roles in one query so we don't N+1.
	// Restrict to system-scoped pages for now (created_by IS NULL AND tenant_id IS NULL);
	// tenant-scoped and user-custom pages light up when the entity + user-custom
	// features land (tracked in the plan).
	pageRows, err := tx.Query(ctx, `
		SELECT p.key_enum, p.label, p.href, p.icon, p.tag_enum, p.kind,
		       p.pinnable, p.default_pinned, p.default_order,
		       COALESCE(array_agg(pr.role::text ORDER BY pr.role) FILTER (WHERE pr.role IS NOT NULL), '{}') AS roles
		FROM pages p
		LEFT JOIN page_roles pr ON pr.page_id = p.id
		WHERE p.created_by IS NULL AND p.tenant_id IS NULL
		GROUP BY p.id
		ORDER BY p.tag_enum, p.default_order`)
	if err != nil {
		return nil, fmt.Errorf("nav registry: query pages: %w", err)
	}
	defer pageRows.Close()

	var entries []CatalogEntry
	byKey := make(map[string]CatalogEntry)
	for pageRows.Next() {
		var e CatalogEntry
		var kind string
		var roleStrs []string
		if err := pageRows.Scan(
			&e.Key, &e.Label, &e.Href, &e.Icon, &e.TagEnum, &kind,
			&e.Pinnable, &e.DefaultPinned, &e.DefaultOrder, &roleStrs,
		); err != nil {
			return nil, fmt.Errorf("nav registry: scan page: %w", err)
		}
		e.Kind = NavItemKind(kind)
		e.Roles = make([]models.Role, 0, len(roleStrs))
		for _, r := range roleStrs {
			e.Roles = append(e.Roles, models.Role(r))
		}
		if _, ok := tagsByEnum[e.TagEnum]; !ok {
			return nil, fmt.Errorf("nav registry: page %q references unknown tag %q", e.Key, e.TagEnum)
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

// CatalogFor returns only entries visible to the given role, in the
// canonical order (by tag default_order, then by default_order within tag).
func (r *Registry) CatalogFor(role models.Role) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(r.entries))
	for _, e := range r.entries {
		if roleAllowed(role, e.Roles) {
			out = append(out, e)
		}
	}
	return out
}

// Tags returns all tag groups in default order. Caller must treat as read-only.
func (r *Registry) Tags() []TagGroup {
	return r.tags
}

// TagByEnum returns the tag group for an enum, or (zero, false).
func (r *Registry) TagByEnum(enum string) (TagGroup, bool) {
	t, ok := r.tagsByEnum[enum]
	return t, ok
}
