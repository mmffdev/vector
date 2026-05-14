package permissions

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver returns the effective permission code set for a user
// (the codes granted by the user's role).
//
// Lookups are cached in-process with a TTL. Cache entries are
// invalidated explicitly when:
//   - the user's role changes (handler must call Invalidate(userID))
//   - the role grid changes (handler must call InvalidateRole(roleID))
//   - any user the actor cares about logs out (cheap to drop everything)
//
// Cache layer is process-local. Across the cluster we'll publish
// invalidations on the existing realtime hub in a later story; for v0
// the TTL bounds drift and that's enough.
type Resolver struct {
	pool *pgxpool.Pool
	ttl  time.Duration

	mu    sync.RWMutex
	cache map[uuid.UUID]cacheEntry // keyed by user_id
	// roleIndex maps roleID -> set of user_ids whose entry depends on it,
	// used by InvalidateRole.
	roleIndex map[uuid.UUID]map[uuid.UUID]struct{}
}

type cacheEntry struct {
	roleID  uuid.UUID
	codes   map[Code]struct{}
	expires time.Time
}

// NewResolver constructs a resolver. ttl <=0 disables caching (every
// call hits the DB), useful in tests.
func NewResolver(pool *pgxpool.Pool, ttl time.Duration) *Resolver {
	return &Resolver{
		pool:      pool,
		ttl:       ttl,
		cache:     make(map[uuid.UUID]cacheEntry),
		roleIndex: make(map[uuid.UUID]map[uuid.UUID]struct{}),
	}
}

// PermissionsFor returns the effective code set for userID. Reads from
// cache when fresh; on miss, queries the DB and stores the result.
func (r *Resolver) PermissionsFor(ctx context.Context, userID uuid.UUID) (map[Code]struct{}, error) {
	if r.ttl > 0 {
		r.mu.RLock()
		ent, ok := r.cache[userID]
		r.mu.RUnlock()
		if ok && time.Now().Before(ent.expires) {
			return ent.codes, nil
		}
	}

	var roleID uuid.UUID
	err := r.pool.QueryRow(ctx, sqlSelectUserRoleID, userID).Scan(&roleID)
	if err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx, sqlSelectPermissionCodesForRole, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	codes := make(map[Code]struct{})
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		codes[Code(c)] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if r.ttl > 0 {
		r.store(userID, roleID, codes)
	}
	return codes, nil
}

// Has is a convenience wrapper around PermissionsFor for one code.
func (r *Resolver) Has(ctx context.Context, userID uuid.UUID, code Code) (bool, error) {
	set, err := r.PermissionsFor(ctx, userID)
	if err != nil {
		return false, err
	}
	_, ok := set[code]
	return ok, nil
}

// PermissionCodesFor returns the user's effective permission codes as a
// flat (unsorted) string slice. Used by callers that just need to render
// the codes (auth/me payload) without typed `Code` values. Caller may
// sort the result for stable output.
func (r *Resolver) PermissionCodesFor(ctx context.Context, userID uuid.UUID) ([]string, error) {
	set, err := r.PermissionsFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, string(c))
	}
	return out, nil
}

// Invalidate drops the cached entry for userID. Call this after the
// user's role_id changes (creator-matrix updates, role assignment).
func (r *Resolver) Invalidate(userID uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dropLocked(userID)
}

// InvalidateRole drops every cached entry whose role is roleID. Call
// after a role's grid is mutated (Assign/Revoke permissions).
func (r *Resolver) InvalidateRole(roleID uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	users, ok := r.roleIndex[roleID]
	if !ok {
		return
	}
	for uid := range users {
		delete(r.cache, uid)
	}
	delete(r.roleIndex, roleID)
}

// InvalidateAll drops every cached entry. Useful for tests and for the
// extremely rare case of a permissions-catalogue migration.
func (r *Resolver) InvalidateAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cache = make(map[uuid.UUID]cacheEntry)
	r.roleIndex = make(map[uuid.UUID]map[uuid.UUID]struct{})
}

func (r *Resolver) store(userID, roleID uuid.UUID, codes map[Code]struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// If the user previously had a different role, drop the old role-index entry.
	if prev, ok := r.cache[userID]; ok && prev.roleID != roleID {
		if idx, ok2 := r.roleIndex[prev.roleID]; ok2 {
			delete(idx, userID)
		}
	}
	r.cache[userID] = cacheEntry{
		roleID:  roleID,
		codes:   codes,
		expires: time.Now().Add(r.ttl),
	}
	if r.roleIndex[roleID] == nil {
		r.roleIndex[roleID] = make(map[uuid.UUID]struct{})
	}
	r.roleIndex[roleID][userID] = struct{}{}
}

func (r *Resolver) dropLocked(userID uuid.UUID) {
	ent, ok := r.cache[userID]
	if !ok {
		return
	}
	if idx, ok2 := r.roleIndex[ent.roleID]; ok2 {
		delete(idx, userID)
		if len(idx) == 0 {
			delete(r.roleIndex, ent.roleID)
		}
	}
	delete(r.cache, userID)
}
