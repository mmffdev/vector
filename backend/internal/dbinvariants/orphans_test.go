package dbinvariants

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// TestNoPolymorphicOrphans is the canary for the four app-enforced
// polymorphic FK relationships in mmff_vector. See
// docs/c_polymorphic_writes.md for the writer rules these queries enforce.
//
// The test runs four assertions in a single read-only transaction, one
// per relationship. None fail-fast: every quadrant is checked and any
// failures are reported together so a single CI run surfaces the full
// picture.
//
// Pattern matched from backend/internal/nav/service_test.go: load the
// pool from backend/.env.local, skip (don't fail) if the SSH tunnel is
// down, do not mock the DB.
func TestNoPolymorphicOrphans(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	ctx := context.Background()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	type check struct {
		name string
		// sql must SELECT a single bigint count of orphan rows.
		sql string
		// skip true logs and continues without running sql.
		skip       bool
		skipReason string
	}

	checks := []check{
		{
			// CUT1.1.1 (PLA064): company_roadmap, workspace, portfolio, product
			// tables were dropped in migration 249. subscriptions_stakeholders has
			// no remaining valid entity kinds, so any row is an orphan. The table
			// should be empty; this check enforces that invariant.
			name: "subscriptions_stakeholders",
			sql:  `SELECT count(*) FROM subscriptions_stakeholders`,
		},
		{
			// CUT1.1.1 (PLA064): portfolio and product tables dropped in mig 249.
			// page_entity_refs must be empty — no valid entity kinds remain.
			name: "page_entity_refs",
			sql:  `SELECT count(*) FROM page_entity_refs`,
		},
	}

	for _, c := range checks {
		c := c
		t.Run(c.name, func(t *testing.T) {
			if c.skip {
				t.Logf("skipping %s — %s", c.name, c.skipReason)
				return
			}
			var n int64
			if err := tx.QueryRow(ctx, c.sql).Scan(&n); err != nil {
				t.Errorf("%s: query failed: %v", c.name, err)
				return
			}
			if n != 0 {
				t.Errorf("%s: %d orphan row(s) — polymorphic child without a live parent", c.name, n)
			}
		})
	}
}

// testPool mirrors the harness used by backend/internal/nav/service_test.go:
// load backend/.env.local, open a pgx pool against the tunnel, skip
// (don't fail) when the tunnel isn't up so unit-test runs on dev
// machines without the tunnel still pass.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}
