package roles

import (
	"testing"

	"github.com/google/uuid"
)

// TestSystemRoleUUIDsParse verifies the five system-role UUID literals
// are valid. uuid.MustParse would panic at package init if any were
// malformed, but this test makes the contract explicit.
func TestSystemRoleUUIDsParse(t *testing.T) {
	for _, id := range []uuid.UUID{
		SystemRoleGadmin, SystemRolePadmin, SystemRoleTeamLead,
		SystemRoleUser, SystemRoleExternal,
	} {
		if id == uuid.Nil {
			t.Fatalf("system role UUID is nil")
		}
	}
}

// TestIsSystemRole guards against drift between the constants and
// the systemRoleSet lookup map.
func TestIsSystemRole(t *testing.T) {
	for _, id := range []uuid.UUID{
		SystemRoleGadmin, SystemRolePadmin, SystemRoleTeamLead,
		SystemRoleUser, SystemRoleExternal,
	} {
		if !IsSystemRole(id) {
			t.Errorf("IsSystemRole(%s) = false, want true", id)
		}
	}
	random := uuid.New()
	if IsSystemRole(random) {
		t.Errorf("IsSystemRole(random) = true, want false")
	}
}

// TestReservedSystemRanks asserts the rank-band guard matches the DB
// CHECK constraint roles_tenant_rank_band: 5/10/20/25/30 are reserved.
func TestReservedSystemRanks(t *testing.T) {
	for _, rank := range []int{5, 10, 20, 25, 30} {
		if _, reserved := reservedSystemRanks[rank]; !reserved {
			t.Errorf("rank %d should be reserved", rank)
		}
	}
	for _, rank := range []int{1, 11, 12, 19, 21, 24, 26, 29, 100} {
		if _, reserved := reservedSystemRanks[rank]; reserved {
			t.Errorf("rank %d should NOT be reserved", rank)
		}
	}
}
