package workspaces

// Integration test for CheckCrossDBOrphans against a LIVE
// vector_artefacts pool. PLA-0026 / story 00502 (B13).
//
// Skip-on-unreachable: if VECTOR_ARTEFACTS_DB_URL is unset OR the
// resulting pool fails to ping, the test calls t.Skipf — matches the
// canary test's strategy (cross_db_canary_test.go).

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

// vaPoolForTest opens a read-only-style pool against vector_artefacts.
// Mirrors vaTestPool in internal/portfoliomodels/, kept local here to
// avoid a cross-package _test.go import.
func vaPoolForTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=workspaces_crossdb_test",
		os.Getenv("VA_DB_HOST"),
		os.Getenv("VA_DB_PORT"),
		os.Getenv("VA_DB_USER"),
		os.Getenv("VA_DB_PASSWORD"),
		os.Getenv("VA_DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts: %v", err)
	}
	return pool
}

// TestCheckCrossDBOrphans_RandomWorkspaceHasNoOrphans drives the scan
// with a freshly-minted UUID guaranteed not to exist anywhere in
// vector_artefacts. Expectation: empty slice — every COUNT(*) query
// returns 0 — exercises the read path and the "no orphans" exit.
func TestCheckCrossDBOrphans_RandomWorkspaceHasNoOrphans(t *testing.T) {
	va := vaPoolForTest(t)
	defer va.Close()

	s := (&Service{}).WithVAPool(va)
	out, err := s.CheckCrossDBOrphans(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("scan with fresh uuid: want nil error, got %v", err)
	}
	if len(out) != 0 {
		t.Errorf("fresh uuid: want empty slice, got %d entries: %+v", len(out), out)
	}
}

// TestCheckCrossDBOrphans_DetectsInsertedRow inserts a synthetic
// master_record_portfolio row carrying a fresh workspace_id, runs the
// scan against THAT id, asserts the report includes
// "master_record_portfolio" with count=1, then cleans up. We pick
// master_record_portfolio because it has the smallest required-cols
// surface (workspace_id PK + model_name) — see
// db/vector_artefacts/schema/020_master_record_portfolio.sql.
func TestCheckCrossDBOrphans_DetectsInsertedRow(t *testing.T) {
	va := vaPoolForTest(t)
	defer va.Close()
	ctx := context.Background()

	wsID := uuid.New()
	defer func() {
		if _, err := va.Exec(ctx, `DELETE FROM master_record_portfolio WHERE workspace_id = $1`, wsID); err != nil {
			t.Errorf("cleanup synthetic row: %v", err)
		}
	}()

	if _, err := va.Exec(ctx, `
		INSERT INTO master_record_portfolio (workspace_id, model_name)
		VALUES ($1, $2)
	`, wsID, "B13 cross-db orphan guard test"); err != nil {
		t.Fatalf("insert synthetic mrp row: %v", err)
	}

	s := (&Service{}).WithVAPool(va)
	out, err := s.CheckCrossDBOrphans(ctx, wsID)
	if err != nil {
		t.Fatalf("scan with synthetic orphan: want nil error, got %v", err)
	}

	var sawMRP bool
	for _, r := range out {
		if r.Table == "master_record_portfolio" {
			sawMRP = true
			if r.Count != 1 {
				t.Errorf("master_record_portfolio count: got %d, want 1", r.Count)
			}
		}
	}
	if !sawMRP {
		t.Errorf("scan did not flag master_record_portfolio orphan; got %+v", out)
	}
}
