package portfoliomodels

// PLA-0026 / Story 00504 (T4): saga-level integration test asserting
// the re-adoption invariant — across two full Adopt() cycles with
// DIFFERENT models, work artefacts that were parented under cycle-1
// strategy artefacts get repointed (not orphaned) by cycle 2.
//
// Re-adoption (adopt.go:244 isReadoption=true) is triggered when a
// completed adoption exists for the subscription but the new Adopt()
// targets a different modelID. The saga's VA pre-step at stepLayers
// dispatches runReadoption (adopt_readopt.go), which:
//
//   - mints a placeholder strategy type + artefact for the workspace
//   - repoints every work artefact whose parent is an OLD strategy
//     artefact onto the placeholder artefact (preserving NOT NULL)
//   - deletes the OLD strategy artefacts and soft-archives their types
//
// TestRunReadoption_HappyPath (adopt_readopt_test.go) already covers
// the helper directly. This file proves the saga wires that helper
// into the right slot — the placeholder lands AND the cycle-1-parented
// work artefact survives cycle 2 with a non-NULL parent.
//
// Scope of the invariant assertion:
//   We seed exactly ONE tracer work artefact between cycle 1 and
//   cycle 2, parented under a real cycle-1 strategy artefact. After
//   cycle 2 we re-read THAT row by id and assert parent_artefact_id
//   is non-NULL. Workspace-wide counts are deliberately NOT used —
//   the seeded ACME workspace can carry pre-existing tenant-built
//   work artefacts whose NULL parents are a fixture concern, not a
//   re-adoption regression.
//
// Test discipline:
//   - hits live mmff_library / mmff_vector / vector_artefacts via the
//     SSH tunnel on :5435
//   - SKIPs cleanly if the workspace lookup fails (orphan-sub fixture)
//   - cleans up its own state via resetAdoptionFixture + targeted
//     deletes on artefacts/artefact_types so no cross-test bleed.
//
// The two-model requirement is satisfied by the seeded mmff_library:
//   aa01 = Vector Standard   ← seededMMFFModelID
//   bb01 = Enterprise        ← seededEnterpriseModelID (this file)
// Both rows exist in portfolio_templates (verified 2026-05-07).

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/portfolio"
)

// seededEnterpriseModelID is the second seeded library template, used
// here purely to trigger the re-adoption code path (existingState row
// has a different modelID than the new Adopt call).
const seededEnterpriseModelID = "00000000-0000-0000-0000-00000000bb01"

// TestAdoptSaga_ReadoptionPreservesParentInvariant — runs cycle 1,
// seeds a tracer work artefact under a cycle-1 strategy artefact, runs
// cycle 2 with a different model (re-adoption), then asserts the
// tracer's parent_artefact_id is still non-NULL post-cycle-2.
func TestAdoptSaga_ReadoptionPreservesParentInvariant(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()
	firstModel := uuid.MustParse(seededMMFFModelID)
	secondModel := uuid.MustParse(seededEnterpriseModelID)

	// Mirror the orchestrator's resolveWorkspaceID query (workspaces
	// plural — see adopt.go:479) so cleanup matches the real saga's
	// target row, not the singular `workspace` table.
	var workspaceID uuid.UUID
	if err := vec.QueryRow(ctx, `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY id
		 LIMIT 1`,
		user.SubscriptionID,
	).Scan(&workspaceID); err != nil {
		t.Skipf("no live master_record_workspaces row for padmin subscription %s: %v",
			user.SubscriptionID, err)
	}

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	// VA-side cleanup so a leftover row from a prior crashed run does
	// not poison subsequent runs. Artefacts are deleted before types
	// because of the FK on artefact_type_id. Note: we only delete
	// artefacts whose workspace_id matches, but leave artefact_types
	// alone — cross-workspace artefact→type references exist in dev
	// data drift and we don't want to break unrelated rows. The
	// tracer's identity is checked by id, not by count, so leftover
	// types in the workspace don't affect the assertion.
	defer func() {
		c := context.Background()
		_, _ = va.Exec(c, `DELETE FROM artefacts WHERE workspace_id = $1`, workspaceID)
	}()

	mrSvc := portfolio.NewService(va)
	o := NewOrchestrator(libRO, vec, va, mrSvc)

	// ── Cycle 1: adopt firstModel (clean slate). ──────────────────
	res1, err := o.Adopt(ctx, user.SubscriptionID, user.ID, firstModel,
		"test-req-readopt-1", AdoptOptions{})
	if err != nil {
		t.Fatalf("Adopt cycle 1: %v", err)
	}
	if res1.Status != "completed" {
		t.Fatalf("cycle 1 status: want completed, got %q", res1.Status)
	}

	// Sanity: cycle 1 produced strategy artefact_types for the workspace.
	var c1Types int
	if err := va.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefact_types
		 WHERE workspace_id = $1
		   AND scope         = 'strategy'
		   AND archived_at  IS NULL`,
		workspaceID,
	).Scan(&c1Types); err != nil {
		t.Fatalf("count cycle-1 strategy types: %v", err)
	}
	if c1Types == 0 {
		t.Fatalf("cycle 1: want >0 strategy artefact_types, got 0")
	}

	// ── Seed the tracer between cycles. ─────────────────────────
	// We need (a) a real cycle-1 leaf strategy artefact_type to hang a
	// strategy artefact off, (b) a strategy artefact under it (the
	// "OLD" target runReadoption will repoint orphans away from), and
	// (c) a tracer work artefact_type + tracer work artefact whose
	// parent points at (b). After cycle 2 the tracer's parent must be
	// repointed to the placeholder artefact (NOT NULL preserved).
	var leafStrategyTypeID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT id FROM artefact_types
		 WHERE workspace_id   = $1
		   AND scope          = 'strategy'
		   AND is_placeholder = FALSE
		   AND archived_at   IS NULL
		   AND allows_children = FALSE
		 ORDER BY sort_order
		 LIMIT 1`,
		workspaceID,
	).Scan(&leafStrategyTypeID); err != nil {
		// Fall back to any strategy type if no leaf marker is set.
		if err := va.QueryRow(ctx, `
			SELECT id FROM artefact_types
			 WHERE workspace_id   = $1
			   AND scope          = 'strategy'
			   AND is_placeholder = FALSE
			   AND archived_at   IS NULL
			 ORDER BY sort_order DESC
			 LIMIT 1`,
			workspaceID,
		).Scan(&leafStrategyTypeID); err != nil {
			t.Fatalf("locate cycle-1 strategy type: %v", err)
		}
	}

	var oldStrategyArtefactID uuid.UUID
	if err := va.QueryRow(ctx, `
		INSERT INTO artefacts (
			subscription_id, workspace_id,
			artefact_type_id, number,
			title, parent_artefact_id, position
		) VALUES ($1, $2, $3, 1, 'cycle-1 strategy tracer', NULL, 0)
		RETURNING id`,
		user.SubscriptionID, workspaceID, leafStrategyTypeID,
	).Scan(&oldStrategyArtefactID); err != nil {
		t.Fatalf("seed old strategy artefact: %v", err)
	}

	// Prefix uses a per-run random hex tail so re-runs against the
	// dev DB don't trip artefact_types_prefix_unique_live (cleanup
	// only deletes artefacts; types are left in place to avoid the
	// cross-workspace FK problem).
	tracerPrefix := "T" + uuid.New().String()[0:2]
	var workTypeID uuid.UUID
	if err := va.QueryRow(ctx, `
		INSERT INTO artefact_types (
			subscription_id, workspace_id,
			scope, source, name, prefix,
			allows_children, sort_order, is_placeholder
		) VALUES ($1, $2, 'work', 'tenant', 'TracerWork', $3,
		          FALSE, 0, FALSE)
		RETURNING id`,
		user.SubscriptionID, workspaceID, tracerPrefix,
	).Scan(&workTypeID); err != nil {
		t.Fatalf("seed work artefact_type: %v", err)
	}

	var tracerWorkID uuid.UUID
	if err := va.QueryRow(ctx, `
		INSERT INTO artefacts (
			subscription_id, workspace_id,
			artefact_type_id, number,
			title, parent_artefact_id, position
		) VALUES ($1, $2, $3, 1, 'tracer work item', $4, 0)
		RETURNING id`,
		user.SubscriptionID, workspaceID, workTypeID, oldStrategyArtefactID,
	).Scan(&tracerWorkID); err != nil {
		t.Fatalf("seed tracer work artefact: %v", err)
	}

	// ── Cycle 2: adopt secondModel — re-adoption path. ─────────────
	// adopt.go:244 sets isReadoption=true because existingState.ModelID
	// (firstModel) != modelID (secondModel). The VA pre-step at
	// stepLayers will then dispatch runReadoption before any new
	// strategy writer runs, repointing the tracer to the placeholder.
	res2, err := o.Adopt(ctx, user.SubscriptionID, user.ID, secondModel,
		"test-req-readopt-2", AdoptOptions{})
	if err != nil {
		t.Fatalf("Adopt cycle 2 (re-adoption): %v", err)
	}
	if res2.Status != "completed" {
		t.Fatalf("cycle 2 status: want completed, got %q", res2.Status)
	}

	// ── The invariant: tracer's parent_artefact_id must be non-NULL
	//    AND must point at the live placeholder artefact for this ws.
	var tracerParent *uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT parent_artefact_id FROM artefacts WHERE id = $1`,
		tracerWorkID,
	).Scan(&tracerParent); err != nil {
		t.Fatalf("read tracer parent: %v", err)
	}
	if tracerParent == nil {
		t.Fatalf("re-adoption broke parent invariant: tracer work " +
			"artefact has NULL parent_artefact_id after cycle 2")
	}

	var placeholderArtefactID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT a.id
		  FROM artefacts a
		  JOIN artefact_types t ON t.id = a.artefact_type_id
		 WHERE a.workspace_id     = $1
		   AND t.is_placeholder   = TRUE
		   AND t.archived_at     IS NULL
		   AND a.archived_at     IS NULL
		 ORDER BY a.created_at
		 LIMIT 1`,
		workspaceID,
	).Scan(&placeholderArtefactID); err != nil {
		t.Fatalf("locate placeholder artefact: %v", err)
	}
	if *tracerParent != placeholderArtefactID {
		t.Fatalf("tracer not repointed to placeholder: got parent=%v, "+
			"placeholder=%v", *tracerParent, placeholderArtefactID)
	}
}
