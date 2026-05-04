package orgdesign

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// TestGrantRole_DelegationGate locks in story 00288:
// only gadmin may issue grants in MVP, and can_redelegate must be
// false. Both checks run before any DB access, so we can exercise
// them without a pgx pool — Service{} is enough.
func TestGrantRole_DelegationGate(t *testing.T) {
	svc := &Service{}
	ctx := context.Background()
	sub := uuid.New()
	node := uuid.New()
	user := uuid.New()
	by := uuid.New()

	t.Run("padmin granter is rejected with ErrDelegationDepth", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, "padmin", false)
		if !errors.Is(err, ErrDelegationDepth) {
			t.Fatalf("padmin grant: want ErrDelegationDepth, got %v", err)
		}
	})

	t.Run("user granter is rejected with ErrDelegationDepth", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, "user", false)
		if !errors.Is(err, ErrDelegationDepth) {
			t.Fatalf("user grant: want ErrDelegationDepth, got %v", err)
		}
	})

	t.Run("can_redelegate=true is rejected with ErrRedelegationDisabled", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, RoleAdmin, by, "gadmin", true)
		if !errors.Is(err, ErrRedelegationDisabled) {
			t.Fatalf("redelegate: want ErrRedelegationDisabled, got %v", err)
		}
	})

	t.Run("invalid role short-circuits before delegation gate", func(t *testing.T) {
		_, err := svc.GrantRole(ctx, sub, node, user, Role("not-a-role"), by, "padmin", false)
		if !errors.Is(err, ErrInvalidRole) {
			t.Fatalf("invalid role: want ErrInvalidRole, got %v", err)
		}
	})
}
