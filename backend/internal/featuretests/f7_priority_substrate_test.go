package featuretests_test

// F7 — Priority substrate (artefact_priorities table + artefacts.priority
// TEXT → priority_id UUID FK migration).
//
// PLA-0055 feature test. Covers stories 00594 (new artefact_priorities
// table + slot enum + seed) and 00595 (high-risk TEXT→UUID FK migration
// with backfill). Tracker group: `frontend-priority-customisation`,
// feature `F7`.
//
// Written RED 2026-05-16. The assertions below FAIL on main because:
//   - artefact_priorities table does not exist (story 00594)
//   - artefacts.priority is still TEXT, not priority_id UUID FK
//     (story 00595)
//
// Tier A — none (this feature is DB-shaped end-to-end).
// Tier B — live-DB integration; tunnel-down skip via vectorArtefactsPoolForF1.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestF7_PrioritiesTable_Exists asserts the artefact_priorities table
// landed via story 00594. information_schema check is the cheapest
// invariant; doesn't require running the migration in CI.
func TestF7_PrioritiesTable_Exists(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f7PrioritiesTableExists(ctx, t, pool) {
		t.Errorf("artefact_priorities table missing — story 00594 must create it")
	}
}

// TestF7_PrioritySlotCheck_Enforced asserts the slot CHECK constraint
// rejects bogus values and accepts the project-locked vocabulary
// (pri_critical / pri_high / pri_medium / pri_low) + NULL.
func TestF7_PrioritySlotCheck_Enforced(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f7PrioritiesTableExists(ctx, t, pool) {
		t.Skip("artefact_priorities missing — story 00594 prerequisite")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Pick a real workspace UUID to satisfy the FK.
	var wsID string
	if err := tx.QueryRow(ctx, `
		SELECT artefacts_types_id_workspace::text
		  FROM artefacts_types
		 LIMIT 1
	`).Scan(&wsID); err != nil {
		t.Skipf("no workspace fixture available: %v", err)
	}

	insertWithSlot := `
		INSERT INTO artefact_priorities (workspace_id, name, slot, sort_order)
		VALUES ($1::uuid, $2, $3, 99)
	`

	// Bogus slot must be rejected by CHECK.
	if _, err := tx.Exec(ctx, "SAVEPOINT s_bogus"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	if _, err := tx.Exec(ctx, insertWithSlot, wsID, "F7-bogus", "bogus_slot"); err == nil {
		t.Errorf("CHECK failed to reject slot='bogus_slot' — story 00594 vocabulary check missing")
	}
	_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT s_bogus")

	// NULL slot must be accepted (custom tenant priorities).
	if _, err := tx.Exec(ctx, "SAVEPOINT s_null"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	if _, err := tx.Exec(ctx, insertWithSlot, wsID, "F7-custom-Showstopper", nil); err != nil {
		t.Errorf("CHECK must allow slot=NULL (custom priorities): %v", err)
	}
	_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT s_null")
}

// TestF7_PriorityFK_RejectsBadWorkspace was originally written to
// assert a workspace_id FOREIGN KEY on artefact_priorities. The
// workspaces table lives in the separate mmff_vector DB, so a true
// cross-database FK is not enforceable here. The existing pattern
// (artefacts_types) carries workspace_id as a plain UUID and relies
// on application-layer validation; this table follows that pattern.
// Skipped permanently; the equivalent guard is application-level
// (artefactpriorities service rejects bogus workspace_id at the edge).
func TestF7_PriorityFK_RejectsBadWorkspace(t *testing.T) {
	t.Skip("workspaces table is cross-database (mmff_vector) — FK not enforceable from vector_artefacts; application-layer validation instead. See artefacts_types for the same pattern.")
}

// TestF7_SeededSlotsPerWorkspace asserts story 00594's seed populated
// every workspace with the 4 system priority slots (pri_critical /
// pri_high / pri_medium / pri_low).
func TestF7_SeededSlotsPerWorkspace(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f7PrioritiesTableExists(ctx, t, pool) {
		t.Skip("artefact_priorities missing — story 00594 prerequisite")
	}

	rows, err := pool.Query(ctx, `
		SELECT slot, COUNT(*)
		  FROM artefact_priorities
		 WHERE slot IS NOT NULL
		   AND archived_at IS NULL
		 GROUP BY slot
		 ORDER BY slot
	`)
	if err != nil {
		t.Fatalf("query slot counts: %v", err)
	}
	defer rows.Close()

	got := map[string]int{}
	for rows.Next() {
		var slot string
		var count int
		if err := rows.Scan(&slot, &count); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[slot] = count
	}

	for _, s := range []string{"pri_critical", "pri_high", "pri_medium", "pri_low"} {
		if got[s] == 0 {
			t.Errorf("slot %q has 0 rows — story 00594 seed must populate it per workspace", s)
		}
	}
}

// TestF7_PriorityIDColumn_Exists asserts story 00595's TEXT→UUID FK
// migration replaced artefacts.priority (TEXT) with artefacts.priority_id
// (UUID FK to artefact_priorities). information_schema check.
func TestF7_PriorityIDColumn_Exists(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var hasPriorityID bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			 WHERE table_name  = 'artefacts'
			   AND column_name = 'priority_id'
			   AND data_type   = 'uuid'
		)
	`).Scan(&hasPriorityID)
	if err != nil {
		t.Fatalf("query information_schema for artefacts.priority_id: %v", err)
	}
	if !hasPriorityID {
		t.Errorf("artefacts.priority_id (uuid) missing — story 00595 must add the FK column")
	}
}

// TestF7_OldPriorityTextColumn_Dropped asserts story 00595 dropped the
// legacy TEXT priority column. Keeping it alive would invite drift.
func TestF7_OldPriorityTextColumn_Dropped(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var stillExists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			 WHERE table_name  = 'artefacts'
			   AND column_name = 'priority'
		)
	`).Scan(&stillExists)
	if err != nil {
		t.Fatalf("query information_schema for artefacts.priority: %v", err)
	}
	if stillExists {
		t.Errorf("artefacts.priority (TEXT) still present — story 00595 must drop it after backfill")
	}
}

// TestF7_BackfillNoNullPriorityID asserts post-migration that every
// existing artefacts row was matched to a priority row by name and
// has a non-NULL priority_id.
func TestF7_BackfillNoNullPriorityID(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f7PriorityIDColumnExists(ctx, t, pool) {
		t.Skip("artefacts.priority_id missing — story 00595 prerequisite")
	}

	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM artefacts WHERE priority_id IS NULL`).Scan(&n)
	if err != nil {
		t.Fatalf("count NULL priority_id: %v", err)
	}
	if n > 0 {
		t.Errorf("%d artefacts rows have NULL priority_id — story 00595 backfill missed them", n)
	}
}

// TestF7_BackfillNoOrphanFK asserts every artefacts.priority_id
// resolves to a live artefact_priorities row.
func TestF7_BackfillNoOrphanFK(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f7PriorityIDColumnExists(ctx, t, pool) {
		t.Skip("artefacts.priority_id missing — story 00595 prerequisite")
	}

	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM artefacts a
		  LEFT JOIN artefact_priorities p ON a.priority_id = p.id
		 WHERE a.priority_id IS NOT NULL AND p.id IS NULL
	`).Scan(&n)
	if err != nil {
		t.Fatalf("count orphan FKs: %v", err)
	}
	if n > 0 {
		t.Errorf("%d artefacts rows have priority_id pointing nowhere — backfill mapping broken", n)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

func f7PrioritiesTableExists(ctx context.Context, t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			 WHERE table_name = 'artefact_priorities'
		)
	`).Scan(&exists)
	if err != nil {
		t.Fatalf("query information_schema for artefact_priorities: %v", err)
	}
	return exists
}

func f7PriorityIDColumnExists(ctx context.Context, t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			 WHERE table_name  = 'artefacts'
			   AND column_name = 'priority_id'
		)
	`).Scan(&exists)
	if err != nil {
		t.Fatalf("query information_schema for artefacts.priority_id: %v", err)
	}
	return exists
}
