package topology

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/roles"
)

// TestGrantRole_DelegationGate locks in story 00288:
// only gadmin may issue grants in MVP, and can_redelegate must be
// false. Both checks run before any DB access, so we can exercise
// them without a pgx pool — Service{} is enough.
//
// TD-ROLE-001: gate now compares role UUIDs (granterRoleID) rather
// than the legacy users.role string. Test seeds roles.SystemGrpGlobalID
// with a fixed UUID for the duration of the test so the "gadmin"
// branch is exercisable without booting a real Service.LoadSystemRoles.
func TestGrantRole_DelegationGate(t *testing.T) {
	prev := roles.SystemGrpGlobalID
	roles.SystemGrpGlobalID = uuid.New()
	t.Cleanup(func() { roles.SystemGrpGlobalID = prev })

	svc := &Service{}
	ctx := context.Background()
	sub := uuid.New()
	node := uuid.New()
	user := uuid.New()
	by := uuid.New()
	someOtherRoleID := uuid.New() // any non-Global, non-Nil UUID — stands in for padmin/user.

	t.Run("padmin granter is rejected with ErrDelegationDepth", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, someOtherRoleID, false)
		if !errors.Is(err, ErrDelegationDepth) {
			t.Fatalf("padmin grant: want ErrDelegationDepth, got %v", err)
		}
	})

	t.Run("user granter is rejected with ErrDelegationDepth", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, uuid.New(), false)
		if !errors.Is(err, ErrDelegationDepth) {
			t.Fatalf("user grant: want ErrDelegationDepth, got %v", err)
		}
	})

	t.Run("can_redelegate=true is rejected with ErrRedelegationDisabled", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, roles.SystemGrpGlobalID, true)
		if !errors.Is(err, ErrRedelegationDisabled) {
			t.Fatalf("redelegate: want ErrRedelegationDisabled, got %v", err)
		}
	})

	t.Run("invalid role short-circuits before delegation gate", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, Role("not-a-role"), by, someOtherRoleID, false)
		if !errors.Is(err, ErrInvalidRole) {
			t.Fatalf("invalid role: want ErrInvalidRole, got %v", err)
		}
	})
}
