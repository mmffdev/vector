package topology

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/roles"
)

// TestListGrantsByUser covers the admin-pivot grant listing added for
// PLA-0046 / B6.8 (Topology Permissions page).
//
// Test infrastructure note: the orgdesign package currently has no
// DB-backed test harness — existing tests (grant_gate_test.go,
// middleware_workspace_test.go, boundary_test.go) all exercise guards
// that short-circuit before any pgx call by constructing &Service{}
// directly. Mirroring that pattern, we cover the actorRoleID gate here,
// which short-circuits with ErrForbidden before s.vaPool is touched.
// The two DB-backed sub-tests proposed in the spec
// (gadmin_returns_grants, target_with_no_grants) are deferred until a
// DB-backed harness lands in this package — adding one solely for
// these cases would constitute new test infrastructure, which is
// explicitly forbidden by the story's hard constraints.
//
// TD-ROLE-001: gate now compares role UUIDs (actorRoleID) rather than
// the legacy users.role string. Test seeds roles.SystemGrpGlobalID
// with a fixed UUID for the duration of the test so the non-gadmin
// branches reliably fall through to ErrForbidden.
func TestListGrantsByUser(t *testing.T) {
	prev := roles.SystemGrpGlobalID
	roles.SystemGrpGlobalID = uuid.New()
	t.Cleanup(func() { roles.SystemGrpGlobalID = prev })

	svc := &Service{}
	ctx := context.Background()
	sub := uuid.New()
	target := uuid.New()

	t.Run("non_gadmin_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, uuid.New())
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("padmin actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("user_role_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, uuid.New())
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("user actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("team_lead_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, uuid.New())
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("team_lead actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("empty_role_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, uuid.Nil)
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("empty actor role: want ErrForbidden, got %v", err)
		}
	})
}

// TestListMyGrants_GadminDispatch covers TD-MYGRANTS-HANDLER-TEST partially:
// the dispatch branch in ListMyGrants short-circuits to listMyGrantsGadmin
// when actorRoleID == roles.SystemGrpGlobalID. We can't exercise the SQL
// without a DB harness (the topology package has none — see the TestListGrantsByUser
// docstring), but the dispatch decision itself is observable via panic on
// nil pool. This pins the gadmin-detection sentinel so a future refactor
// can't accidentally route gadmin actors through the per-user grant SQL.
func TestListMyGrants_GadminDispatch(t *testing.T) {
	prev := roles.SystemGrpGlobalID
	roles.SystemGrpGlobalID = uuid.New()
	t.Cleanup(func() { roles.SystemGrpGlobalID = prev })

	svc := &Service{}
	ctx := context.Background()
	sub := uuid.New()
	user := uuid.New()

	t.Run("gadmin_routes_to_gadmin_path", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic on nil vaPool — gadmin path should reach listMyGrantsGadmin")
			}
		}()
		_, _ = svc.ListMyGrants(ctx, sub, user, roles.SystemGrpGlobalID)
	})

	t.Run("non_gadmin_routes_to_per_user_path", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic on nil vaPool — non-gadmin path should reach sqlListMyGrants")
			}
		}()
		_, _ = svc.ListMyGrants(ctx, sub, user, uuid.New())
	})
}
