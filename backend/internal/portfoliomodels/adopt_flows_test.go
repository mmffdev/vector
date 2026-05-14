package portfoliomodels

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// PLA-0026 / Story 00493 (B4): integration tests for the flows +
// flows_states + flows_transitions writers. Hits the live vector_artefacts
// DB via the SSH tunnel on :5435 — skips when the tunnel is down.
//
// Coverage:
//   TestWriteFlowsAndStates_HappyPath         — counts + kind + is_initial
//   TestWriteFlowsAndStates_Idempotent        — second run is a no-op
//   TestWriteFlowTransitions_HappyPath        — endpoints resolve
//   TestWriteFlowTransitions_Idempotent       — second run is a no-op
//   TestWriteFlowTransitions_OrphanStateErrors — defensive corruption probe

// flowsBundle builds a 2-layer + 2-state-per-layer + 1-transition-per-flow
// bundle. suffix keeps prefixes/names unique across runs.
//
// Layout:
//   layerA → wfA1 (initial, todo) → wfA2 (terminal, done) ; tr A1→A2
//   layerB → wfB1 (initial)       → wfB2 (terminal cancel) ; tr B1→B2
func flowsBundle(suffix string) (
	bundle *librarydb.Bundle,
	layerAID, layerBID,
	wfA1ID, wfA2ID, wfB1ID, wfB2ID,
	trA12ID, trB12ID uuid.UUID,
) {
	layerAID = uuid.New()
	layerBID = uuid.New()
	wfA1ID = uuid.New()
	wfA2ID = uuid.New()
	wfB1ID = uuid.New()
	wfB2ID = uuid.New()
	trA12ID = uuid.New()
	trB12ID = uuid.New()

	colA := strPtr("#5B8DEF")
	colB := strPtr("#A4A4A4")

	bundle = &librarydb.Bundle{
		Layers: []librarydb.Layer{
			{
				ID:             layerAID,
				Name:           "FlowLayerA_" + suffix,
				Tag:            "A" + suffix[:2],
				SortOrder:      0,
				ParentLayerID:  nil,
				AllowsChildren: true,
			},
			{
				ID:             layerBID,
				Name:           "FlowLayerB_" + suffix,
				Tag:            "B" + suffix[:2],
				SortOrder:      10,
				ParentLayerID:  nil,
				AllowsChildren: true,
			},
		},
		Workflows: []librarydb.Workflow{
			{
				ID:         wfA1ID,
				LayerID:    layerAID,
				StateKey:   "todo",
				StateLabel: "To Do",
				SortOrder:  0,
				IsInitial:  true,
				IsTerminal: false,
				Colour:     colA,
			},
			{
				ID:         wfA2ID,
				LayerID:    layerAID,
				StateKey:   "done",
				StateLabel: "Done",
				SortOrder:  100,
				IsInitial:  false,
				IsTerminal: true,
				Colour:     colA,
			},
			{
				ID:         wfB1ID,
				LayerID:    layerBID,
				StateKey:   "open",
				StateLabel: "Open",
				SortOrder:  0,
				IsInitial:  true,
				IsTerminal: false,
				Colour:     colB,
			},
			{
				ID:         wfB2ID,
				LayerID:    layerBID,
				StateKey:   "cancelled",
				StateLabel: "Cancelled",
				SortOrder:  100,
				IsInitial:  false,
				IsTerminal: true,
				Colour:     colB,
			},
		},
		Transitions: []librarydb.WorkflowTransition{
			{
				ID:          trA12ID,
				FromStateID: wfA1ID,
				ToStateID:   wfA2ID,
			},
			{
				ID:          trB12ID,
				FromStateID: wfB1ID,
				ToStateID:   wfB2ID,
			},
		},
	}
	return
}

// cleanFlowsWorkspace tears down every row produced by the writers in
// the strategy fixture for this workspace. We DELETE in dependency
// order to avoid the ON DELETE RESTRICT on flows.artefact_type_id.
func cleanFlowsWorkspace(t *testing.T, ctx context.Context, workspaceID uuid.UUID) {
	t.Helper()
	pool := vaTestPool(t)
	defer pool.Close()
	// flows_transitions cascade off flows_states; flows_states cascade off
	// flows; flows is RESTRICT off artefact_types so we delete flows
	// first, then artefact_types.
	_, _ = pool.Exec(ctx, `
		DELETE FROM flows_transitions
		 WHERE flow_id IN (
			SELECT f.id FROM flows f
			  JOIN artefact_types t ON t.id = f.artefact_type_id
			 WHERE t.workspace_id = $1)`, workspaceID)
	_, _ = pool.Exec(ctx, `
		DELETE FROM flows_states
		 WHERE flow_id IN (
			SELECT f.id FROM flows f
			  JOIN artefact_types t ON t.id = f.artefact_type_id
			 WHERE t.workspace_id = $1)`, workspaceID)
	_, _ = pool.Exec(ctx, `
		DELETE FROM flows
		 WHERE artefact_type_id IN (
			SELECT id FROM artefact_types WHERE workspace_id = $1)`,
		workspaceID)
	_, _ = pool.Exec(ctx,
		`DELETE FROM artefact_types WHERE workspace_id = $1`, workspaceID)
}

// seedStrategyAndRun is the common setup: open a SERIALIZABLE va tx,
// write strategy artefact_types (B3), then run the caller-provided
// flows writer (B4) — all in the same tx so the strategy types are
// visible to writeFlowsAndStates.
func seedStrategyAndRun(
	t *testing.T,
	ctx context.Context,
	subscriptionID, workspaceID uuid.UUID,
	bundle *librarydb.Bundle,
	fn func(pgx.Tx) error,
) {
	t.Helper()
	pool := vaTestPool(t)
	defer pool.Close()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin va tx: %v", err)
	}
	defer tx.Rollback(ctx)
	if err := writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
		t.Fatalf("seed strategy types: %v", err)
	}
	if err := fn(tx); err != nil {
		t.Fatalf("writer: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit va tx: %v", err)
	}
}

func TestWriteFlowsAndStates_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, layerAID, _, _, _, _, wfB2ID, _, _ := flowsBundle(suffix)

	defer cleanFlowsWorkspace(t, ctx, workspaceID)

	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		return writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// 2 flows (one per strategy artefact_type)
	var nFlows int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows f
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND f.archived_at IS NULL`,
		workspaceID).Scan(&nFlows); err != nil {
		t.Fatalf("count flows: %v", err)
	}
	if nFlows != 2 {
		t.Fatalf("flows count: want 2, got %d", nFlows)
	}

	// 4 flows_states (2 per flow)
	var nStates int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_states fs
		  JOIN flows f ON f.id = fs.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND fs.archived_at IS NULL`,
		workspaceID).Scan(&nStates); err != nil {
		t.Fatalf("count flows_states: %v", err)
	}
	if nStates != 4 {
		t.Fatalf("flows_states count: want 4, got %d", nStates)
	}

	// flows.library_layer_id is populated for layerA's flow
	var libLayer uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT f.library_layer_id
		  FROM flows f
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND t.library_layer_id = $2
		   AND f.is_default = TRUE`,
		workspaceID, layerAID).Scan(&libLayer); err != nil {
		t.Fatalf("load layerA flow: %v", err)
	}
	if libLayer != layerAID {
		t.Errorf("flows.library_layer_id: want %s, got %s", layerAID, libLayer)
	}

	// The B-layer's terminal "cancelled" state must classify as 'cancelled'.
	var kind string
	var isInitial bool
	if err := pool.QueryRow(ctx, `
		SELECT fs.kind, fs.is_initial
		  FROM flows_states fs
		 WHERE fs.library_workflow_id = $1`,
		wfB2ID).Scan(&kind, &isInitial); err != nil {
		t.Fatalf("load wfB2 state: %v", err)
	}
	if kind != "cancelled" {
		t.Errorf("wfB2 kind: want cancelled, got %q", kind)
	}
	if isInitial {
		t.Errorf("wfB2 is_initial: want false, got true")
	}

	// One initial state per flow
	var nInitial int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_states fs
		  JOIN flows f ON f.id = fs.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND fs.is_initial = TRUE
		   AND fs.archived_at IS NULL`,
		workspaceID).Scan(&nInitial); err != nil {
		t.Fatalf("count initial states: %v", err)
	}
	if nInitial != 2 {
		t.Errorf("initial states: want 2 (one per flow), got %d", nInitial)
	}

	// 'todo' bucket count: both initial states classify as todo.
	var nTodo int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_states fs
		  JOIN flows f ON f.id = fs.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND fs.kind = 'todo'
		   AND fs.archived_at IS NULL`,
		workspaceID).Scan(&nTodo); err != nil {
		t.Fatalf("count todo states: %v", err)
	}
	if nTodo != 2 {
		t.Errorf("todo states: want 2, got %d", nTodo)
	}
}

func TestWriteFlowsAndStates_Idempotent(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, _, _, _, _, _, _, _ := flowsBundle(suffix)

	defer cleanFlowsWorkspace(t, ctx, workspaceID)

	// First run.
	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		return writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// Second run in a fresh tx — strategy types now already exist, so
	// re-running writeStrategyArtefactTypes is a no-op too. Both writers
	// share the seedStrategyAndRun harness.
	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		return writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	var nFlows, nStates int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows f
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND f.archived_at IS NULL`,
		workspaceID).Scan(&nFlows); err != nil {
		t.Fatalf("count flows: %v", err)
	}
	if nFlows != 2 {
		t.Errorf("flows after 2× run: want 2, got %d", nFlows)
	}
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_states fs
		  JOIN flows f ON f.id = fs.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND fs.archived_at IS NULL`,
		workspaceID).Scan(&nStates); err != nil {
		t.Fatalf("count flows_states: %v", err)
	}
	if nStates != 4 {
		t.Errorf("flows_states after 2× run: want 4, got %d", nStates)
	}
}

func TestWriteFlowTransitions_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, _, wfA1ID, wfA2ID, _, _, _, _ := flowsBundle(suffix)

	defer cleanFlowsWorkspace(t, ctx, workspaceID)

	// Seed strategy types + flows + states + transitions all in one tx.
	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		if err := writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
			return err
		}
		return writeFlowTransitions(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// 2 transitions
	var nTr int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_transitions tr
		  JOIN flows f ON f.id = tr.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1`,
		workspaceID).Scan(&nTr); err != nil {
		t.Fatalf("count transitions: %v", err)
	}
	if nTr != 2 {
		t.Fatalf("transitions count: want 2, got %d", nTr)
	}

	// Resolve the A1→A2 edge endpoints and verify both states belong to
	// the same flow.
	var (
		fromState, toState, flowID, fsAFlow, fsBFlow uuid.UUID
	)
	if err := pool.QueryRow(ctx, `
		SELECT tr.from_state_id, tr.to_state_id, tr.flow_id
		  FROM flows_transitions tr
		  JOIN flows_states fs_from ON fs_from.id = tr.from_state_id
		 WHERE fs_from.library_workflow_id = $1`,
		wfA1ID).Scan(&fromState, &toState, &flowID); err != nil {
		t.Fatalf("load A1→A2 transition: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT flow_id FROM flows_states WHERE id = $1`, fromState).Scan(&fsAFlow); err != nil {
		t.Fatalf("load A1 flow: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT flow_id FROM flows_states WHERE id = $1`, toState).Scan(&fsBFlow); err != nil {
		t.Fatalf("load A2 flow: %v", err)
	}
	if fsAFlow != flowID || fsBFlow != flowID {
		t.Errorf("transition flow_id mismatch: tr=%s, A1=%s, A2=%s", flowID, fsAFlow, fsBFlow)
	}

	// from_state must be the A1 flow_state (look it up via library_workflow_id).
	var fromLibID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT library_workflow_id FROM flows_states WHERE id = $1`,
		fromState).Scan(&fromLibID); err != nil {
		t.Fatalf("load from-state library_workflow_id: %v", err)
	}
	if fromLibID != wfA1ID {
		t.Errorf("from_state library_workflow_id: want %s, got %s", wfA1ID, fromLibID)
	}
	var toLibID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT library_workflow_id FROM flows_states WHERE id = $1`,
		toState).Scan(&toLibID); err != nil {
		t.Fatalf("load to-state library_workflow_id: %v", err)
	}
	if toLibID != wfA2ID {
		t.Errorf("to_state library_workflow_id: want %s, got %s", wfA2ID, toLibID)
	}
}

func TestWriteFlowTransitions_Idempotent(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, _, _, _, _, _, _, _ := flowsBundle(suffix)

	defer cleanFlowsWorkspace(t, ctx, workspaceID)

	// First run.
	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		if err := writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
			return err
		}
		return writeFlowTransitions(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// Second run.
	seedStrategyAndRun(t, ctx, subscriptionID, workspaceID, bundle, func(tx pgx.Tx) error {
		if err := writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
			return err
		}
		return writeFlowTransitions(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	var nTr int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows_transitions tr
		  JOIN flows f ON f.id = tr.flow_id
		  JOIN artefact_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1`,
		workspaceID).Scan(&nTr); err != nil {
		t.Fatalf("count transitions: %v", err)
	}
	if nTr != 2 {
		t.Errorf("transitions after 2× run: want 2, got %d", nTr)
	}
}

func TestWriteFlowTransitions_OrphanStateErrors(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, _, _, _, _, _, _, _ := flowsBundle(suffix)

	// Inject a transition pointing at a library workflow that isn't in
	// bundle.Workflows — defensive corruption probe.
	missing := uuid.New()
	bundle.Transitions = append(bundle.Transitions, librarydb.WorkflowTransition{
		ID:          uuid.New(),
		FromStateID: missing,
		ToStateID:   bundle.Workflows[0].ID,
	})

	defer cleanFlowsWorkspace(t, ctx, workspaceID)

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)
	if err := writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
		t.Fatalf("seed strategy types: %v", err)
	}
	if err := writeFlowsAndStates(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
		t.Fatalf("seed flows/states: %v", err)
	}
	err = writeFlowTransitions(ctx, tx, subscriptionID, workspaceID, bundle)
	if err == nil {
		t.Fatalf("orphan from_state: want error, got nil")
	}
}

