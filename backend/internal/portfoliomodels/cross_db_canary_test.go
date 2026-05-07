package portfoliomodels

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// PLA-0026 / Story 00506 (T6): cross-DB integrity canary.
//
// Postgres cannot enforce foreign keys across databases. Every
// `vector_artefacts.<table>.workspace_id` is a SOFT reference to
// `mmff_vector.workspaces.id`; the application layer is supposed to validate
// before insert (see db/artefacts_schema/001_init_vector_artefacts.sql top
// comment). This test stands in for the missing FK by ASSERTING that no live
// (un-archived) row in any VA table carries a workspace_id that is absent
// from mmff_vector.workspaces.
//
// Implementation strategy: TWO-POOL — not dblink.
//   - dblink is NOT installed on the cluster (verified 2026-05-07).
//     postgres_fdw is installed and `fdw_workspaces` already mirrors
//     mmff_vector.workspaces, but the test deliberately avoids depending on
//     that wiring so a future fdw drift / drop doesn't turn this canary into
//     a false-positive cascade.
//   - Two-pool means: open one pool to mmff_vector, load every workspace
//     id into a Go set; open one pool to vector_artefacts, SELECT DISTINCT
//     workspace_id per VA table; assert subset.
//   - Skip-on-unreachable: either pool failing to open or ping causes a
//     t.Skipf — the canary is for CI/dev where both clusters are up; ops use
//     the dev/scripts/cross_db_canary.sh wrapper which exits non-zero.
//
// Tables covered (verified live 2026-05-07 against vector_artefacts):
//   artefact_types, artefact_workspace_fields, artefacts,
//   master_record_portfolio
//
// Note: sprints (013) was replaced by timebox_sprints in migration 025
// (db/artefacts_schema/025_timebox_sprints.sql). Add timebox_sprints to
// vaCanaryTables once 025 is applied to the dev DB.
//
// Detection rule: `archived_at IS NULL` is filtered out for tables that have
// the column. master_record_portfolio is the one exception — its row IS the
// adoption record and it has no archived_at; one row per workspace_id PK.

// vaCanaryTables is the authoritative list of vector_artefacts tables whose
// workspace_id column must point at a live mmff_vector.workspaces row.
//
// hasArchivedAt = true means the canary filters out archived rows (a
// workspace deletion + soft-archive is allowed to leave dangling references
// from archived rows). master_record_portfolio has no archived_at column —
// the row IS the adoption state, lifetime equals the workspace.
var vaCanaryTables = []struct {
	name          string
	hasArchivedAt bool
}{
	{"artefact_types", true},
	{"artefact_workspace_fields", false}, // admit-row table; lifetime = workspace
	{"artefacts", true},
	{"master_record_portfolio", false}, // PK = workspace_id; lifetime = workspace
	// {"timebox_sprints", true}, -- add once migration 025 is applied to dev DB
}

// vectorPoolForCanary opens a read-only-style pool against mmff_vector. We
// reuse the same env-var convention as testVectorPoolPadmin but skip the
// padmin lookup — the canary only reads workspaces.
func vectorPoolForCanary(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=cross_db_canary_test",
		envOr("DB_HOST", "localhost"),
		envOr("DB_PORT", "5434"),
		envOr("DB_USER", "mmff_dev"),
		os.Getenv("DB_PASSWORD"),
		envOr("DB_NAME", "mmff_vector"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open mmff_vector pool (cluster down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector: %v", err)
	}
	return pool
}

func TestCrossDBCanary_WorkspaceReferences(t *testing.T) {
	ctx := context.Background()

	vec := vectorPoolForCanary(t)
	defer vec.Close()

	va := vaTestPool(t)
	defer va.Close()

	// Step 1: load the authoritative workspace id set from mmff_vector.
	rows, err := vec.Query(ctx, `SELECT id FROM workspaces`)
	if err != nil {
		t.Fatalf("load workspaces from mmff_vector: %v", err)
	}
	known := make(map[uuid.UUID]struct{}, 64)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatalf("scan workspace id: %v", err)
		}
		known[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("rows.Err on workspaces load: %v", err)
	}
	if len(known) == 0 {
		// Belt-and-braces — empty workspaces would render every VA row an
		// orphan. If this happens we are pointed at the wrong DB.
		t.Skipf("mmff_vector.workspaces returned 0 rows — refusing to run canary against an empty source-of-truth")
	}

	// Step 2: per VA table, pull distinct workspace_id values for live rows
	// and assert subset.
	type orphan struct {
		Table       string
		WorkspaceID uuid.UUID
	}
	var orphans []orphan

	for _, tbl := range vaCanaryTables {
		q := fmt.Sprintf(`SELECT DISTINCT workspace_id FROM %s`, tbl.name)
		if tbl.hasArchivedAt {
			q += ` WHERE archived_at IS NULL`
		}
		rows, err := va.Query(ctx, q)
		if err != nil {
			t.Fatalf("query %s: %v", tbl.name, err)
		}
		var seen []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				t.Fatalf("scan %s.workspace_id: %v", tbl.name, err)
			}
			seen = append(seen, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatalf("rows.Err on %s: %v", tbl.name, err)
		}
		for _, id := range seen {
			if _, ok := known[id]; !ok {
				orphans = append(orphans, orphan{Table: tbl.name, WorkspaceID: id})
			}
		}
		t.Logf("canary %-30s distinct_workspace_ids=%d", tbl.name, len(seen))
	}

	if len(orphans) == 0 {
		return
	}

	// Stable order so the failure message is deterministic for diff.
	sort.Slice(orphans, func(i, j int) bool {
		if orphans[i].Table != orphans[j].Table {
			return orphans[i].Table < orphans[j].Table
		}
		return orphans[i].WorkspaceID.String() < orphans[j].WorkspaceID.String()
	})
	msg := fmt.Sprintf("cross-DB canary FAILED: %d orphan workspace_id reference(s) in vector_artefacts:\n", len(orphans))
	for _, o := range orphans {
		msg += fmt.Sprintf("  %-30s workspace_id=%s (no row in mmff_vector.workspaces)\n", o.Table, o.WorkspaceID)
	}
	t.Fatal(msg)
}
