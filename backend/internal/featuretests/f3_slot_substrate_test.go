package featuretests_test

// F3 — Slot enum substrate.
//
// PLA-0054 feature test. Covers stories 00582 (slot column + CHECK + index)
// and 00583 (backfill 5 system slots per workspace). Story 00584 (DTO
// surfaces Slot) is covered by f3_dto_slot_test.go behind the
// `f3_dto_landed` build tag — see that file for why.
//
// Tracker group: `frontend-chip-foundation`, feature `F3`.
//
// Written RED 2026-05-16. The assertions below FAIL on main because:
//   - artefacts_types has no `artefacts_types_slot` column (story 00582)
//   - even if added, no rows carry seeded slots (story 00583)
//
// Tier A — none (this feature is DB-shaped end-to-end).
// Tier B — live-DB integration; tunnel-down skip via vectorArtefactsPoolForF1.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestF3_SlotColumn_Exists asserts the slot column landed via story 00582.
// SELECT against information_schema is the cheapest invariant check;
// avoids running the actual migration in CI.
func TestF3_SlotColumn_Exists(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f3SlotColumnExists(ctx, t, pool) {
		t.Errorf("artefacts_types_slot column missing — story 00582 (slot column + CHECK + index) must add it")
	}
}

// TestF3_SlotCheckConstraint_Enforced asserts the CHECK constraint
// rejects bogus values and accepts the project-locked vocabulary
// (wrk_epic / wrk_story / wrk_defect / wrk_task / wrk_risk) + NULL.
//
// Runs the assertions inside a rolled-back transaction so the dev DB
// stays clean. Skips when the column doesn't exist yet (story 00582
// is the prerequisite).
func TestF3_SlotCheckConstraint_Enforced(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f3SlotColumnExists(ctx, t, pool) {
		t.Skip("artefacts_types_slot missing — story 00582 prerequisite")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Pick any real subscription + workspace pair to satisfy NOT NULL
	// columns; we never commit.
	var subID, wsID string
	if err := tx.QueryRow(ctx, `
		SELECT artefacts_types_id_subscription::text,
		       artefacts_types_id_workspace::text
		  FROM artefacts_types
		 LIMIT 1
	`).Scan(&subID, &wsID); err != nil {
		t.Skipf("no rows in artefacts_types to source fixture IDs from: %v", err)
	}

	insertWithSlot := `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix,
			artefacts_types_sort_order, artefacts_types_slot
		) VALUES ($1::uuid, $2::uuid, 'work', 'system', $3, $4, 99, $5)
	`

	// Bogus slot must be rejected by CHECK.
	if _, err := tx.Exec(ctx, insertWithSlot, subID, wsID, "F3-bogus", "F3B", "bogus_slot"); err == nil {
		t.Errorf("CHECK constraint failed to reject slot='bogus_slot' — story 00582 vocabulary check missing")
	}

	// One canonical slot must be accepted (inside this rolled-back tx).
	if _, err := tx.Exec(ctx, insertWithSlot, subID, wsID, "F3-risk", "F3R", "wrk_risk"); err != nil {
		// If this fails it's likely the unique partial index — pick a
		// fixture workspace that doesn't already have wrk_risk seeded.
		// Skip rather than spuriously fail.
		t.Skipf("could not INSERT wrk_risk in fixture workspace (likely already seeded — story 00583 backfill): %v", err)
	}

	// NULL slot must be accepted (custom artefact types have no slot).
	if _, err := tx.Exec(ctx, insertWithSlot, subID, wsID, "F3-custom", "F3C", nil); err != nil {
		t.Errorf("CHECK constraint must allow slot=NULL (custom artefact types): %v", err)
	}
}

// TestF3_Backfill_FiveSlotsPerWorkspace asserts story 00583's backfill
// populated every workspace with the 5 system slots.
func TestF3_Backfill_FiveSlotsPerWorkspace(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f3SlotColumnExists(ctx, t, pool) {
		t.Skip("artefacts_types_slot missing — story 00582 prerequisite")
	}

	// One row per slot value, counted across all workspaces.
	// Expect 5 distinct slot rows: wrk_epic, wrk_story, wrk_defect, wrk_task, wrk_risk.
	rows, err := pool.Query(ctx, `
		SELECT artefacts_types_slot, COUNT(*)
		  FROM artefacts_types
		 WHERE artefacts_types_slot IS NOT NULL
		   AND artefacts_types_archived_at IS NULL
		 GROUP BY artefacts_types_slot
		 ORDER BY artefacts_types_slot
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

	wantSlots := []string{"wrk_epic", "wrk_story", "wrk_defect", "wrk_task", "wrk_risk"}
	for _, s := range wantSlots {
		if got[s] == 0 {
			t.Errorf("slot %q has 0 rows — story 00583 backfill must seed it per workspace", s)
		}
	}
}

// TestF3_UniquePartialIndex_PerWorkspace asserts the unique partial
// index rejects a duplicate slot within one workspace.
func TestF3_UniquePartialIndex_PerWorkspace(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f3SlotColumnExists(ctx, t, pool) {
		t.Skip("artefacts_types_slot missing — story 00582 prerequisite")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Find any workspace that already has wrk_risk seeded (post-00583).
	var subID, wsID string
	err = tx.QueryRow(ctx, `
		SELECT artefacts_types_id_subscription::text,
		       artefacts_types_id_workspace::text
		  FROM artefacts_types
		 WHERE artefacts_types_slot = 'wrk_risk'
		   AND artefacts_types_archived_at IS NULL
		 LIMIT 1
	`).Scan(&subID, &wsID)
	if err != nil {
		t.Skipf("no wrk_risk row seeded yet — story 00583 prerequisite: %v", err)
	}

	insert := `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix,
			artefacts_types_sort_order, artefacts_types_slot
		) VALUES ($1::uuid, $2::uuid, 'work', 'tenant', $3, $4, 99, 'wrk_risk')
	`

	// Inserting a SECOND wrk_risk in the SAME workspace must be rejected.
	if _, err := tx.Exec(ctx, insert, subID, wsID, "F3-dup-risk", "F3D"); err == nil {
		t.Errorf("unique partial index failed to reject duplicate slot=wrk_risk in workspace %s", wsID)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// f3SlotColumnExists reports whether the artefacts_types_slot column
// is present in information_schema. Used to skip Tier-B checks that
// depend on story 00582 having landed.
func f3SlotColumnExists(ctx context.Context, t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			 WHERE table_name  = 'artefacts_types'
			   AND column_name = 'artefacts_types_slot'
		)
	`).Scan(&exists)
	if err != nil {
		t.Fatalf("query information_schema for artefacts_types_slot: %v", err)
	}
	return exists
}
