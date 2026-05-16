package topology

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// TestListGrantsByUser covers the admin-pivot grant listing added for
// PLA-0046 / B6.8 (Topology Permissions page).
//
// Test infrastructure note: the orgdesign package currently has no
// DB-backed test harness — existing tests (grant_gate_test.go,
// middleware_workspace_test.go, boundary_test.go) all exercise guards
// that short-circuit before any pgx call by constructing &Service{}
// directly. Mirroring that pattern, we cover the actorRole gate here,
// which short-circuits with ErrForbidden before s.vaPool is touched.
// The two DB-backed sub-tests proposed in the spec
// (gadmin_returns_grants, target_with_no_grants) are deferred until a
// DB-backed harness lands in this package — adding one solely for
// these cases would constitute new test infrastructure, which is
// explicitly forbidden by the story's hard constraints.
func TestListGrantsByUser(t *testing.T) {
	svc := &Service{}
	ctx := context.Background()
	sub := uuid.New()
	target := uuid.New()

	t.Run("non_gadmin_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, "padmin")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("padmin actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("user_role_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, "user")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("user actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("team_lead_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, "team_lead")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("team_lead actor: want ErrForbidden, got %v", err)
		}
	})

	t.Run("empty_role_returns_forbidden", func(t *testing.T) {
		_, err := svc.ListGrantsByUser(ctx, sub, target, "")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("empty actor role: want ErrForbidden, got %v", err)
		}
	})
}
