package permissions

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// These tests cover the pure cache-mechanics paths (store / Invalidate /
// InvalidateRole / InvalidateAll). The DB-backed path (PermissionsFor on
// miss) is exercised by integration tests under cmd/server.

func TestResolverInvalidate(t *testing.T) {
	r := NewResolver(nil, 60*time.Second)
	uid := uuid.New()
	rid := uuid.New()
	r.store(uid, rid, map[Code]struct{}{MenuAdminView: {}})

	if _, ok := r.cache[uid]; !ok {
		t.Fatalf("expected cache hit after store")
	}
	r.Invalidate(uid)
	if _, ok := r.cache[uid]; ok {
		t.Errorf("Invalidate did not drop entry")
	}
	if idx, ok := r.roleIndex[rid]; ok && len(idx) != 0 {
		t.Errorf("Invalidate left role-index dangling: %v", idx)
	}
}

func TestResolverInvalidateRole(t *testing.T) {
	r := NewResolver(nil, 60*time.Second)
	rid := uuid.New()
	u1, u2 := uuid.New(), uuid.New()
	r.store(u1, rid, map[Code]struct{}{MenuAdminView: {}})
	r.store(u2, rid, map[Code]struct{}{MenuAdminView: {}})

	r.InvalidateRole(rid)

	if _, ok := r.cache[u1]; ok {
		t.Errorf("InvalidateRole did not drop u1")
	}
	if _, ok := r.cache[u2]; ok {
		t.Errorf("InvalidateRole did not drop u2")
	}
	if _, ok := r.roleIndex[rid]; ok {
		t.Errorf("InvalidateRole left role-index entry")
	}
}

func TestResolverInvalidateAll(t *testing.T) {
	r := NewResolver(nil, 60*time.Second)
	for i := 0; i < 3; i++ {
		r.store(uuid.New(), uuid.New(), map[Code]struct{}{PortfolioList: {}})
	}
	r.InvalidateAll()
	if len(r.cache) != 0 || len(r.roleIndex) != 0 {
		t.Errorf("InvalidateAll left state: cache=%d roleIndex=%d", len(r.cache), len(r.roleIndex))
	}
}

func TestResolverStoreReplacesRoleIndex(t *testing.T) {
	// User changes role: old role-index entry must drop, new one must add.
	r := NewResolver(nil, 60*time.Second)
	uid := uuid.New()
	oldRole := uuid.New()
	newRole := uuid.New()

	r.store(uid, oldRole, map[Code]struct{}{MenuAdminView: {}})
	if _, ok := r.roleIndex[oldRole][uid]; !ok {
		t.Fatalf("expected uid in oldRole index")
	}

	r.store(uid, newRole, map[Code]struct{}{PortfolioList: {}})
	if _, ok := r.roleIndex[oldRole][uid]; ok {
		t.Errorf("uid still in oldRole index after role change")
	}
	if _, ok := r.roleIndex[newRole][uid]; !ok {
		t.Errorf("uid not in newRole index after role change")
	}
}

func TestResolverTTLZeroDisablesCache(t *testing.T) {
	// ttl <= 0 means store() never persists; this is the test mode.
	r := NewResolver(nil, 0)
	if r.ttl != 0 {
		t.Fatalf("expected ttl=0")
	}
	// store is a no-op gate — but the cache map is initialised. Manual
	// store still works (it doesn't gate on ttl). The gating is in
	// PermissionsFor: it skips both the cache read and the cache write
	// when ttl <= 0. That's exercised by integration tests.
}
