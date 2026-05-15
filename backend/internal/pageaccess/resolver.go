// Package pageaccess decides whether a user may view a given page,
// keyed by the page's stable key_enum.
//
// PLA-0049 Phase 0.5. Backed by users_roles_pages (page_id × role_id)
// JOINed against users.role_id. The expensive part is the per-user
// access set — every user has 0..~80 page key_enums they can see.
//
// Cache strategy (Option 4 from PLA-0049 grilling, "stale-while-
// revalidate"):
//
//   1. Singleton DB row pages_access_version holds a global BIGINT
//      bumped by triggers on users_roles_pages and users_roles. Read
//      every request, but with a 1-second in-process cache so PG sees
//      ~1 query/sec/instance regardless of request rate.
//
//   2. Per-user access set is cached in-process. The cache entry
//      records the version it was loaded against. On request: if
//      cached entry's version matches the current global version, use
//      it; otherwise re-fetch from DB and update.
//
//   3. Worst-case staleness window is the in-process version cache TTL
//      (1 second). After any grant change, the next request from any
//      user on any backend instance picks up the bump within 1s and
//      re-fetches its own access set on the request after that.
//
// Multi-instance coherence: today single-instance dev. For HA the
// same primitive scales — every instance polls the version row
// independently. Postgres LISTEN/NOTIFY would shrink the 1s window to
// ~milliseconds; tracked as TD if needed.
package pageaccess

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver is the per-instance cache + DB lookup surface. Safe for
// concurrent use.
type Resolver struct {
	pool            *pgxpool.Pool
	versionCacheTTL time.Duration

	mu sync.RWMutex
	// versionCache: latest observed global version + when it expires
	// from the in-process cache. The stored value is the DB-truthful
	// version at versionCachedAt; readers compare their own user-cache
	// version against this.
	cachedVersion   int64
	versionCachedAt time.Time

	// userCache: per-user access set + the version it was loaded at.
	// Keyed by user_id.
	userCache map[uuid.UUID]userEntry
}

type userEntry struct {
	version int64
	access  map[string]struct{} // key_enum set
}

// New constructs a Resolver. versionCacheTTL=0 disables the in-process
// version cache (every request hits PG for the version — useful in
// tests where you want zero staleness).
func New(pool *pgxpool.Pool, versionCacheTTL time.Duration) *Resolver {
	return &Resolver{
		pool:            pool,
		versionCacheTTL: versionCacheTTL,
		userCache:       make(map[uuid.UUID]userEntry),
	}
}

// Allowed reports whether userID has page access for keyEnum. Returns
// (false, nil) when the user has the user row but no grant covering
// that page; (false, err) on DB failure.
func (r *Resolver) Allowed(ctx context.Context, userID uuid.UUID, keyEnum string) (bool, error) {
	set, err := r.AccessSetFor(ctx, userID)
	if err != nil {
		return false, err
	}
	_, ok := set[keyEnum]
	return ok, nil
}

// AccessSetFor returns the user's full key_enum access set. Used by the
// /me/page-access endpoint and by Allowed().
func (r *Resolver) AccessSetFor(ctx context.Context, userID uuid.UUID) (map[string]struct{}, error) {
	currentVersion, err := r.currentVersion(ctx)
	if err != nil {
		return nil, err
	}

	r.mu.RLock()
	ent, ok := r.userCache[userID]
	r.mu.RUnlock()
	if ok && ent.version == currentVersion {
		return ent.access, nil
	}

	// Cache miss or stale — re-fetch.
	rows, err := r.pool.Query(ctx, sqlSelectUserAccessSet, userID)
	if err != nil {
		return nil, fmt.Errorf("pageaccess: query user access set: %w", err)
	}
	defer rows.Close()
	access := make(map[string]struct{}, 32)
	for rows.Next() {
		var keyEnum string
		if err := rows.Scan(&keyEnum); err != nil {
			return nil, fmt.Errorf("pageaccess: scan key_enum: %w", err)
		}
		access[keyEnum] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	r.userCache[userID] = userEntry{version: currentVersion, access: access}
	r.mu.Unlock()
	return access, nil
}

// CurrentVersion returns the latest cached version (cheap — no DB hit
// if the in-process cache is fresh). Useful for the /me/page-access
// endpoint to ship the version alongside the access set so the client
// can detect drift.
func (r *Resolver) CurrentVersion(ctx context.Context) (int64, error) {
	return r.currentVersion(ctx)
}

// currentVersion: 1s in-process cached read of pages_access_version.
// Single PG round-trip per Resolver per TTL window.
func (r *Resolver) currentVersion(ctx context.Context) (int64, error) {
	if r.versionCacheTTL > 0 {
		r.mu.RLock()
		v := r.cachedVersion
		fresh := !r.versionCachedAt.IsZero() && time.Since(r.versionCachedAt) < r.versionCacheTTL
		r.mu.RUnlock()
		if fresh {
			return v, nil
		}
	}

	var v int64
	if err := r.pool.QueryRow(ctx, sqlSelectAccessVersion).Scan(&v); err != nil {
		return 0, fmt.Errorf("pageaccess: read version: %w", err)
	}

	if r.versionCacheTTL > 0 {
		r.mu.Lock()
		r.cachedVersion = v
		r.versionCachedAt = time.Now()
		r.mu.Unlock()
	}
	return v, nil
}

// InvalidateUser drops the per-user cache entry for userID. Use after
// the user's role changes (creator-matrix update). Not strictly needed
// because the trigger on users_roles bumps the global version too —
// but lets callers be explicit.
func (r *Resolver) InvalidateUser(userID uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.userCache, userID)
}

// InvalidateAll drops every cached entry AND the version cache. Useful
// for tests and after schema-level changes.
func (r *Resolver) InvalidateAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userCache = make(map[uuid.UUID]userEntry)
	r.cachedVersion = 0
	r.versionCachedAt = time.Time{}
}
