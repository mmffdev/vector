package portfoliomodels

// PLA-0026 / Story 00493 (B4): adoption-saga step 3+4 rewrite — write
// flows + flows_states + flows_transitions into vector_artefacts.
//
// This file is the second VA writer in the adoption saga, paired with
// adopt_strategy_types.go (B3). The legacy writeWorkflows /
// writeTransitions (subscription_workflows / subscription_workflow_transitions
// in mmff_vector) still run; after each commits, the orchestrator opens
// a vaTx and runs the matching writer below against vector_artefacts.
// All writes are idempotent (ON CONFLICT … DO NOTHING) so a retry after
// a partial cross-DB failure converges.
//
// Saga ordering (must hold):
//   stepLayers       → writeStrategyArtefactTypes (B3, adopt_strategy_types.go)
//   stepWorkflows    → writeFlowsAndStates        (B4, this file)
//   stepTransitions  → writeFlowTransitions       (B4, this file)
//
// flows_states.flow_id depends on flows; flows_transitions.from_state_id /
// to_state_id depend on flows_states. We bundle flows + flows_states into
// the same tx (stepWorkflows) because the library has only one
// "workflow" concept and that maps to "states". Transitions get their
// own tx in stepTransitions so it can be retried independently when
// states already landed.
//
// Schema targets:
//   vector_artefacts.flows         — 004_flows.sql + 023 (library_layer_id)
//   vector_artefacts.flows_states   — 004_flows.sql + 022 (library_workflow_id)
//   vector_artefacts.flows_transitions — 004_flows.sql
//
// Idempotency keys:
//   flows:            partial unique flows_one_default_per_type
//                     (artefact_type_id) WHERE is_default=true
//                     AND archived_at IS NULL.
//   flows_states:      partial unique uq_flow_states_flow_lib_workflow
//                     (flow_id, library_workflow_id) WHERE archived_at
//                     IS NULL AND library_workflow_id IS NOT NULL
//                     (added by 022).
//   flows_transitions: full unique flow_transitions_unique_edge
//                     (flow_id, from_state_id, to_state_id).

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// writeFlowsAndStates mirrors every live library Layer into a default
// flow row (one per strategy artefact_type) and every live library
// Workflow into a flows_states row (one per workflow row). Two-phase:
//
//	Phase 1 — INSERT flows ON CONFLICT DO NOTHING for every live layer
//	          that has a strategy artefact_type mirror in this workspace.
//	          Then SELECT to capture the (artefact_type_id → flow_id) map
//	          (DO NOTHING + RETURNING is unreliable when conflict skips).
//	Phase 2 — for each live library Workflow row, look up its flow_id via
//	          (workflow.LayerID → strategy artefact_type → flow), classify
//	          its kind, and INSERT into flows_states ON CONFLICT DO NOTHING
//	          on (flow_id, library_workflow_id).
//
// Caller MUST have already run writeStrategyArtefactTypes for this
// workspace — flows.artefact_type_id is the only handle from a library
// layer to a workspace's flow row.
func writeFlowsAndStates(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID uuid.UUID,
	bundle *librarydb.Bundle,
) error {
	// Resolve library_layer_id → strategy artefact_type_id for this
	// workspace. The strategy types must exist already (B3 ran before
	// us in stepLayers).
	typeMap, err := loadStrategyTypeMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	// Phase 1a: insert one default flow per live library Layer that has
	// a corresponding strategy artefact_type in this workspace.
	for _, l := range bundle.Layers {
		if l.ArchivedAt != nil {
			continue
		}
		artefactTypeID, ok := typeMap[l.ID]
		if !ok {
			// Strategy artefact_type for this library layer was not
			// minted (e.g. its row was archived, or B3 was skipped).
			// Defensive — skip so we never violate the FK, and the
			// caller's idempotent retry will reconcile.
			continue
		}
		// Naming choice: "<LayerName> default flow" so a workspace
		// scanning flows can tell at a glance which artefact_type each
		// flow belongs to. (Documented in the package doc.)
		flowName := l.Name + " default flow"
		if _, err := vaTx.Exec(ctx, sqlInsertDefaultFlowForLayer,
			artefactTypeID, flowName, l.ID,
		); err != nil {
			return fmt.Errorf("insert default flow for layer %q: %w", l.Name, err)
		}
	}

	// Phase 1b: capture artefact_type_id → flow_id for every default
	// flow now visible in the tx. We can't use RETURNING because
	// ON CONFLICT DO NOTHING + skipped rows return zero rows.
	flowMap, err := loadDefaultFlowMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	// Phase 2: insert one flows_states row per live library Workflow.
	for _, wf := range bundle.Workflows {
		if wf.ArchivedAt != nil {
			continue
		}
		artefactTypeID, ok := typeMap[wf.LayerID]
		if !ok {
			// Workflow points at a layer with no strategy artefact_type
			// mirror. Defensive — skip; caller's retry reconciles.
			continue
		}
		flowID, ok := flowMap[artefactTypeID]
		if !ok {
			// Flow row didn't land (e.g. strategy type was archived
			// between phases). Skip — retry will reconcile.
			continue
		}
		kind := classifyWorkflowKind(wf)
		if _, err := vaTx.Exec(ctx, sqlInsertFlowStateForWorkflow,
			flowID, wf.StateLabel, kind, wf.Colour, wf.SortOrder, wf.IsInitial,
			wf.ID,
		); err != nil {
			return fmt.Errorf("insert flow_state %q: %w", wf.StateLabel, err)
		}
	}
	return nil
}

// writeFlowTransitions mirrors every live library WorkflowTransition
// into a flows_transitions row. Resolves from_state_id / to_state_id
// via library_workflow_id → flow_state_id map. Idempotent on
// (flow_id, from_state_id, to_state_id).
//
// Caller MUST have already run writeFlowsAndStates for this workspace —
// flows_transitions.flow_id and *_state_id all chase rows from there.
func writeFlowTransitions(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID uuid.UUID,
	bundle *librarydb.Bundle,
) error {
	stateMap, err := loadFlowStateMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}
	// We also need to know the flow_id for each state so we can fail
	// fast when a transition crosses flows (would be a library bug).
	stateFlowMap, err := loadFlowStateFlowMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	for _, tr := range bundle.Transitions {
		if tr.ArchivedAt != nil {
			continue
		}
		fromStateID, ok := stateMap[tr.FromStateID]
		if !ok {
			return fmt.Errorf("transition references unknown library workflow (from) %s", tr.FromStateID)
		}
		toStateID, ok := stateMap[tr.ToStateID]
		if !ok {
			return fmt.Errorf("transition references unknown library workflow (to) %s", tr.ToStateID)
		}
		fromFlow, ok := stateFlowMap[fromStateID]
		if !ok {
			return fmt.Errorf("flow_state %s missing from flow map", fromStateID)
		}
		toFlow, ok := stateFlowMap[toStateID]
		if !ok {
			return fmt.Errorf("flow_state %s missing from flow map", toStateID)
		}
		if fromFlow != toFlow {
			return fmt.Errorf("cross-flow transition %s→%s (flows %s vs %s)",
				fromStateID, toStateID, fromFlow, toFlow)
		}
		if _, err := vaTx.Exec(ctx, sqlInsertFlowTransitionForLibrary,
			fromFlow, fromStateID, toStateID,
		); err != nil {
			return fmt.Errorf("insert flow_transition %s→%s: %w", fromStateID, toStateID, err)
		}
	}
	return nil
}

// loadFlowStateMap returns library_workflow_id → flow_state_id for every
// live flow_state in this workspace's strategy flows. Used by
// writeFlowTransitions to translate library uuids into VA uuids.
//
// Joins flows_states → flows → artefact_types so the workspace_id filter
// can be applied. flows_states itself is workspace-agnostic (its parent
// flow scopes it).
func loadFlowStateMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, sqlSelectFlowStateLibMap, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load flow_state map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var libID, fsID uuid.UUID
		if err := rows.Scan(&libID, &fsID); err != nil {
			return nil, fmt.Errorf("scan flow_state map: %w", err)
		}
		m[libID] = fsID
	}
	return m, rows.Err()
}

// loadDefaultFlowMap returns artefact_type_id → flow_id for every live
// default flow in this workspace's strategy artefact_types. Used by
// writeFlowsAndStates Phase 2 to resolve flow_id from
// (workflow.LayerID → artefact_type_id).
func loadDefaultFlowMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, sqlSelectDefaultFlowMap, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load default flow map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var atID, fID uuid.UUID
		if err := rows.Scan(&atID, &fID); err != nil {
			return nil, fmt.Errorf("scan default flow map: %w", err)
		}
		m[atID] = fID
	}
	return m, rows.Err()
}

// loadFlowStateFlowMap returns flow_state_id → flow_id for every live
// flow_state in this workspace's strategy flows. writeFlowTransitions
// uses it to assert that a transition's two endpoints belong to the
// same flow (defensive — a cross-flow transition is a library bug).
func loadFlowStateFlowMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, sqlSelectFlowStateFlowMap, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load flow_state→flow map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var fsID, fID uuid.UUID
		if err := rows.Scan(&fsID, &fID); err != nil {
			return nil, fmt.Errorf("scan flow_state→flow map: %w", err)
		}
		m[fsID] = fID
	}
	return m, rows.Err()
}

// classifyWorkflowKind picks the flows_states.kind bucket for one
// library Workflow row. Rules per the card spec:
//
//	IsInitial  → 'todo'
//	IsTerminal AND state_key contains 'cancel' → 'cancelled'
//	IsTerminal → 'done'
//	otherwise  → 'in_progress'
func classifyWorkflowKind(wf librarydb.Workflow) string {
	if wf.IsInitial {
		return "todo"
	}
	if wf.IsTerminal {
		if strings.Contains(strings.ToLower(wf.StateKey), "cancel") {
			return "cancelled"
		}
		return "done"
	}
	return "in_progress"
}
