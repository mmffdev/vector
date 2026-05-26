package sentinel

// Regression test for the gadmin synthetic-grant contract.
//
// Origin: 2026-05-26. After the refactorDB Pillar 3 work landed and the
// workspace-aware focus resolution rolled out, gadmin (grp_global) users
// started hitting 403 focus-no-access on any /work-items or
// /portfolio-items page with ?meg= in the URL. Root cause: a
// synthetic-grant asymmetry between two paths.
//
//   - topology.ListMyGrants (used by /sentinel/boot via the
//     /auth/me + /topology/grants/me bridge) fabricates a synthetic
//     admin grant on every live node when actorRoleID == SystemGrpGlobalID.
//     The frontend sees the user "has 39 grants" and lets them pin focus
//     anywhere in the tenant.
//   - sentinel.PoolResolver.GrantOnNode runs a raw recursive-CTE walk
//     against users_roles_topology_nodes. Without a matching role-aware
//     short-circuit, it returns FALSE for gadmin (no real rows) and the
//     middleware 403s the request.
//
// The fix: GrantOnNode short-circuits to (true, nil) when roleID
// matches SystemGrpGlobalID. This test pins both halves of the
// contract — gadmin gets through without touching SQL, padmin and the
// nil-role guard do NOT get short-circuited.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/roles"
)

// TestPoolResolver_GrantOnNode_GadminShortCircuit pins the
// synthetic-grant contract: when the actor's roleID equals
// roles.SystemGrpGlobalID, GrantOnNode returns true WITHOUT touching
// the database. The proof of "without touching the database" is that
// VAPool is nil — any SQL call would panic.
func TestPoolResolver_GrantOnNode_GadminShortCircuit(t *testing.T) {
	// Install a known SystemGrpGlobalID for the duration of this test.
	// LoadSystemRoles writes it once at boot in production; tests can
	// poke the package variable directly because this is a single-
	// goroutine init (per roles/service.go § single-writer).
	originalID := roles.SystemGrpGlobalID
	t.Cleanup(func() { roles.SystemGrpGlobalID = originalID })

	gadminRoleID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	roles.SystemGrpGlobalID = gadminRoleID

	// VAPool intentionally nil — if the short-circuit doesn't fire,
	// the QueryRow call below will panic on nil-pointer access. That
	// failure mode IS the assertion: gadmin must not reach SQL.
	r := &PoolResolver{VAPool: nil, MVPool: nil}

	tenant := uuid.New()
	userID := uuid.New()
	nodeID := uuid.New()

	ok, err := r.GrantOnNode(context.Background(), tenant, userID, nodeID, gadminRoleID)
	if err != nil {
		t.Fatalf("gadmin GrantOnNode error: %v (expected nil)", err)
	}
	if !ok {
		t.Fatal("gadmin GrantOnNode = false; expected synthetic-grant true")
	}
}

// TestPoolResolver_GrantOnNode_NonGadminFallsThrough pins the
// other half: a non-gadmin role MUST NOT be short-circuited. We
// can't run SQL in this unit-test context, so we assert via the
// nil-pool panic — if GrantOnNode tries to reach SQL for a non-gadmin
// role, the call panics. recover() converts the panic into a clear
// pass signal; reaching past recover() with no panic is the failure
// (means a non-gadmin role got the synthetic-grant treatment).
func TestPoolResolver_GrantOnNode_NonGadminFallsThrough(t *testing.T) {
	originalID := roles.SystemGrpGlobalID
	t.Cleanup(func() { roles.SystemGrpGlobalID = originalID })

	gadminRoleID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	roles.SystemGrpGlobalID = gadminRoleID

	r := &PoolResolver{VAPool: nil, MVPool: nil}

	// padmin / grp_portfolio — must NOT short-circuit.
	padminRoleID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	defer func() {
		if rec := recover(); rec == nil {
			t.Fatal("padmin GrantOnNode did NOT reach SQL (recovered no panic); the short-circuit fired for a non-gadmin role — security regression")
		}
	}()

	// Expected to panic on the nil-pool QueryRow — that proves the
	// short-circuit did NOT fire. The deferred recover above turns
	// that panic into a successful assertion.
	_, _ = r.GrantOnNode(context.Background(), uuid.New(), uuid.New(), uuid.New(), padminRoleID)
}

// TestPoolResolver_GrantOnNode_NilRoleFallsThrough — defence-in-depth:
// uuid.Nil MUST NOT short-circuit even if SystemGrpGlobalID is also
// the zero value (e.g. LoadSystemRoles hasn't run yet). Without this
// gate, every pre-boot request would silently get gadmin powers.
func TestPoolResolver_GrantOnNode_NilRoleFallsThrough(t *testing.T) {
	originalID := roles.SystemGrpGlobalID
	t.Cleanup(func() { roles.SystemGrpGlobalID = originalID })

	// Worst case: SystemGrpGlobalID hasn't been loaded yet.
	roles.SystemGrpGlobalID = uuid.Nil

	r := &PoolResolver{VAPool: nil, MVPool: nil}

	defer func() {
		if rec := recover(); rec == nil {
			t.Fatal("uuid.Nil roleID short-circuited GrantOnNode; pre-boot requests would silently bypass grant checks")
		}
	}()

	// Both roleID and SystemGrpGlobalID are uuid.Nil — short-circuit
	// MUST NOT fire (the guard `roleID != uuid.Nil` blocks it).
	_, _ = r.GrantOnNode(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.Nil)
}
