package roles

// Service unit + integration tests — refreshed 2026-05-16 (TD-TEST-002).
//
// Pre-PLA-0049 this file asserted package-level constants
// SystemRoleGadmin / Padmin / User / TeamLead / External and a
// package-level IsSystemRole(id) function. Phase 0 of PLA-0049 retired
// the rank-encoded literals and moved the seven grp_* IDs to runtime
// resolution via Service.LoadSystemRoles → s.SystemRoles + package
// vars. IsSystemRole became a method on *Service.
//
// What this file now covers:
//   • reservedSystemRanks contains the seven grp_* ranks {10,20,30,40,
//     50,60,70} the DB CHECK constraint guards (pure unit test).
//   • Service.LoadSystemRoles populates the seven SystemRoles fields +
//     the matching package-level SystemGrp*ID vars (integration test;
//     skips on a missing test DB, same shape as workspacemasterrecord
//     and tenantmasterrecord).
//   • Service.IsSystemRole returns true for every loaded grp_* ID and
//     false for any random UUID.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// TestReservedSystemRanks asserts the rank-band guard matches the DB
// CHECK constraint users_roles_tenant_rank_band. Post-PLA-0049 the
// seven grp_* system roles claim ranks 10/20/30/40/50/60/70.
func TestReservedSystemRanks(t *testing.T) {
	wantReserved := []int{10, 20, 30, 40, 50, 60, 70}
	for _, rank := range wantReserved {
		if _, reserved := reservedSystemRanks[rank]; !reserved {
			t.Errorf("rank %d should be reserved (grp_* slot)", rank)
		}
	}
	for _, rank := range []int{1, 5, 9, 11, 19, 21, 41, 71, 100} {
		if _, reserved := reservedSystemRanks[rank]; reserved {
			t.Errorf("rank %d should NOT be reserved (tenant rank slot)", rank)
		}
	}
	if len(reservedSystemRanks) != len(wantReserved) {
		t.Errorf("reservedSystemRanks size = %d, want %d", len(reservedSystemRanks), len(wantReserved))
	}
}

// mainPoolForRolesTest opens an mmff_vector pool against the dev tunnel.
// Skips when env vars are unset or the tunnel is down — matches the
// skip-on-unreachable convention used elsewhere in the codebase.
func mainPoolForRolesTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local", "../../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=roles_service_test",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open mmff_vector pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector: %v", err)
	}
	return pool
}

// TestLoadSystemRoles_PopulatesAllSeven asserts every grp_* slot on the
// loaded SystemRoles struct + every package-level SystemGrp*ID var ends
// up non-nil. Pre-LoadSystemRoles those package vars are uuid.Nil; the
// boot-time call is what makes downstream gates (topology, portfolio,
// fields) actually work.
func TestLoadSystemRoles_PopulatesAllSeven(t *testing.T) {
	pool := mainPoolForRolesTest(t)
	defer pool.Close()

	svc := New(pool, nil)
	if err := svc.LoadSystemRoles(context.Background()); err != nil {
		t.Fatalf("LoadSystemRoles: %v", err)
	}

	slots := map[string]uuid.UUID{
		"GrpGlobal":      svc.SystemRoles.GrpGlobal,
		"GrpPortfolio":   svc.SystemRoles.GrpPortfolio,
		"GrpProduct":     svc.SystemRoles.GrpProduct,
		"GrpTeamLead":    svc.SystemRoles.GrpTeamLead,
		"GrpTeamMember":  svc.SystemRoles.GrpTeamMember,
		"GrpStakeholder": svc.SystemRoles.GrpStakeholder,
		"GrpExternal":    svc.SystemRoles.GrpExternal,
	}
	for name, id := range slots {
		if id == uuid.Nil {
			t.Errorf("SystemRoles.%s is uuid.Nil after LoadSystemRoles", name)
		}
	}

	// Package-level vars must mirror so callers without a *Service
	// (topology, portfolio, fields) can still compare against them.
	pkgVars := map[string]uuid.UUID{
		"SystemGrpGlobalID":      SystemGrpGlobalID,
		"SystemGrpPortfolioID":   SystemGrpPortfolioID,
		"SystemGrpProductID":     SystemGrpProductID,
		"SystemGrpTeamLeadID":    SystemGrpTeamLeadID,
		"SystemGrpTeamMemberID":  SystemGrpTeamMemberID,
		"SystemGrpStakeholderID": SystemGrpStakeholderID,
		"SystemGrpExternalID":    SystemGrpExternalID,
	}
	for name, id := range pkgVars {
		if id == uuid.Nil {
			t.Errorf("package var %s is uuid.Nil after LoadSystemRoles", name)
		}
	}
}

// TestIsSystemRole_TrueForLoadedFalseForRandom verifies the method
// recognises every grp_* ID and rejects a random UUID.
func TestIsSystemRole_TrueForLoadedFalseForRandom(t *testing.T) {
	pool := mainPoolForRolesTest(t)
	defer pool.Close()

	svc := New(pool, nil)
	if err := svc.LoadSystemRoles(context.Background()); err != nil {
		t.Fatalf("LoadSystemRoles: %v", err)
	}

	for _, id := range []uuid.UUID{
		svc.SystemRoles.GrpGlobal,
		svc.SystemRoles.GrpPortfolio,
		svc.SystemRoles.GrpProduct,
		svc.SystemRoles.GrpTeamLead,
		svc.SystemRoles.GrpTeamMember,
		svc.SystemRoles.GrpStakeholder,
		svc.SystemRoles.GrpExternal,
	} {
		if !svc.IsSystemRole(id) {
			t.Errorf("IsSystemRole(%s) = false, want true", id)
		}
	}
	if svc.IsSystemRole(uuid.New()) {
		t.Errorf("IsSystemRole(<random>) = true, want false")
	}
}
