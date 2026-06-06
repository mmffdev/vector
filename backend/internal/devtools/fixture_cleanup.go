package devtools

// fixture_cleanup.go — the one-time fixture-cleanup ACTION of the devtools
// framework. This is SEPARATE from flow reseed (flow_reseed.go): reseed rebuilds
// canonical flows in place; this purges two clusters of synthetic test fixtures
// that were left in the dev DB. It runs once on a throwaway dev DB and is gated
// upstream by devEnvAllowed() at the route. The caller owns the transaction so a
// failure at any step rolls the whole cleanup back atomically.
//
// All raw SQL lives in sql.go (sql-in-sqlfile-only lint); ordering + guards live
// here.
//
// ── The two clusters ───────────────────────────────────────────────────────
//
// CLUSTER A — synthetic artefact TYPES whose name matches ^FlowLayer[AB]_
//   (162 types, 162 flows, 0 live artefacts — verified). The FK chain:
//     flows.flows_id_artefact_type          → artefacts_types  ON DELETE RESTRICT
//     flows_states.flows_states_id_flow      → flows           ON DELETE CASCADE
//     flows_transitions.flows_transitions_id_flow → flows      ON DELETE CASCADE
//     artefacts.artefacts_id_flow_state      → flows_states    ON DELETE RESTRICT
//     flows_states.flows_states_id_template  → flows_states    ON DELETE RESTRICT (self-ref)
//   Because flows_id_artefact_type is RESTRICT, the type row cannot be deleted
//   while its flows exist — so flows are deleted FIRST, then the types. Before
//   that, the flows' STATES are deleted explicitly: deleting flows would cascade
//   states away, but the artefacts_id_flow_state RESTRICT FK and the self-ref
//   template RESTRICT FK both point AT flows_states, so the cascade-delete of a
//   referenced state would be rejected mid-flow-delete. Verified: 0 artefacts
//   sit on FlowLayer states, and every templating state of a FlowLayer state is
//   ITSELF a FlowLayer state (324/324), so a single DELETE covering all FlowLayer
//   flows_states leaves no surviving referrer — RESTRICT is satisfied.
//   Order: flows_states → flows → types.
//
// CLUSTER B — the live artefacts of types named exactly OldStory / OldRoot /
//   Pending re-classification, then those 3 type rows (56 artefacts live as of
//   verification — the original brief estimated 40; see the run report). FK chain
//   off artefacts:
//     artefacts_fields_values.*_id_artefact  → artefacts  ON DELETE CASCADE
//     artefacts_search_outbox.*_id_artefact  → artefacts  ON DELETE CASCADE
//     artefacts.artefacts_id_parent          → artefacts  ON DELETE SET NULL (children orphan)
//     artefact_dependency_maps.*_id_root_artefact → artefacts ON DELETE SET NULL
//     artefact_dependency_edges.*_id_from/to_artefact → artefacts ON DELETE RESTRICT
//   fields_values + search_outbox cascade; children + map-roots auto-orphan via
//   SET NULL (acceptable on a dev DB); dependency EDGES are RESTRICT and guarded
//   (verified 0). Order: artefacts → types.
//
// Both clusters' guards return an ERROR (never panic) when an unexpected non-zero
// RESTRICT referrer exists, so the caller's tx rolls back cleanly.

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// FixtureCleanupPreview is the read-only pre-flight count surfaced before the
// operator confirms. It mutates nothing.
type FixtureCleanupPreview struct {
	FlowLayerTypes      int `json:"flow_layer_types"`
	FlowLayerFlows      int `json:"flow_layer_flows"`
	OldPendingArtefacts int `json:"old_pending_artefacts"`
	OldPendingTypes     int `json:"old_pending_types"`
}

// FixtureCleanupResult counts the rows RunFixtureCleanup actually deleted, per
// cluster, in the order they were removed.
type FixtureCleanupResult struct {
	FlowLayerFlowStatesDeleted int `json:"flow_layer_flow_states_deleted"`
	FlowLayerFlowsDeleted      int `json:"flow_layer_flows_deleted"`
	FlowLayerTypesDeleted      int `json:"flow_layer_types_deleted"`
	OldPendingArtefactsDeleted int `json:"old_pending_artefacts_deleted"`
	OldPendingTypesDeleted     int `json:"old_pending_types_deleted"`
}

// PreviewFixtureCleanup returns the read-only counts of what RunFixtureCleanup
// would remove. No mutations.
func PreviewFixtureCleanup(ctx context.Context, tx pgx.Tx) (FixtureCleanupPreview, error) {
	var p FixtureCleanupPreview

	if err := tx.QueryRow(ctx, sqlCountFlowLayerTypes).Scan(&p.FlowLayerTypes); err != nil {
		return p, fmt.Errorf("devtools: count FlowLayer types: %w", err)
	}
	if err := tx.QueryRow(ctx, sqlCountFlowLayerFlows).Scan(&p.FlowLayerFlows); err != nil {
		return p, fmt.Errorf("devtools: count FlowLayer flows: %w", err)
	}
	if err := tx.QueryRow(ctx, sqlCountOldPendingArtefacts).Scan(&p.OldPendingArtefacts); err != nil {
		return p, fmt.Errorf("devtools: count OldStory/OldRoot/Pending artefacts: %w", err)
	}
	if err := tx.QueryRow(ctx, sqlCountOldPendingTypes).Scan(&p.OldPendingTypes); err != nil {
		return p, fmt.Errorf("devtools: count OldStory/OldRoot/Pending types: %w", err)
	}
	return p, nil
}

// RunFixtureCleanup deletes both fixture clusters in FK-safe order, guarding the
// RESTRICT references that were verified empty. Any guard tripping (an
// unexpected non-zero referrer) returns an error so the caller's transaction
// rolls back rather than the run blindly hitting a Postgres RESTRICT mid-flight.
func RunFixtureCleanup(ctx context.Context, tx pgx.Tx) (FixtureCleanupResult, error) {
	var res FixtureCleanupResult

	// ── Guards (read-only) ──────────────────────────────────────────────────
	// A: no artefact may reference a FlowLayer flow_state (artefacts_id_flow_state
	//    is RESTRICT). The whole premise is "these types have 0 live artefacts".
	var flowLayerArtefacts int
	if err := tx.QueryRow(ctx, sqlCountFlowLayerArtefacts).Scan(&flowLayerArtefacts); err != nil {
		return res, fmt.Errorf("devtools: guard count FlowLayer artefacts: %w", err)
	}
	if flowLayerArtefacts != 0 {
		return res, fmt.Errorf("devtools: aborting fixture cleanup — %d artefact(s) reference FlowLayer types; "+
			"deleting their states would trip the artefacts_id_flow_state RESTRICT FK", flowLayerArtefacts)
	}

	// B: no dependency EDGE may touch an OldStory/OldRoot/Pending artefact
	//    (artefact_dependency_edges is RESTRICT, both directions).
	var oldPendingDepEdges int
	if err := tx.QueryRow(ctx, sqlCountOldPendingDepEdges).Scan(&oldPendingDepEdges); err != nil {
		return res, fmt.Errorf("devtools: guard count OldStory/OldRoot/Pending dependency edges: %w", err)
	}
	if oldPendingDepEdges != 0 {
		return res, fmt.Errorf("devtools: aborting fixture cleanup — %d dependency edge(s) reference "+
			"OldStory/OldRoot/Pending artefacts; deleting the artefacts would trip the "+
			"artefact_dependency_edges RESTRICT FK", oldPendingDepEdges)
	}

	// ── Cluster A: FlowLayer types ──────────────────────────────────────────
	// 1. flows_states first (clears the artefacts_id_flow_state RESTRICT and the
	//    self-ref template RESTRICT in one statement; flows_transitions cascade).
	tag, err := tx.Exec(ctx, sqlDeleteFlowLayerFlowStates)
	if err != nil {
		return res, fmt.Errorf("devtools: delete FlowLayer flow states: %w", err)
	}
	res.FlowLayerFlowStatesDeleted = int(tag.RowsAffected())

	// 2. flows (clears flows_id_artefact_type RESTRICT before the type delete).
	tag, err = tx.Exec(ctx, sqlDeleteFlowLayerFlows)
	if err != nil {
		return res, fmt.Errorf("devtools: delete FlowLayer flows: %w", err)
	}
	res.FlowLayerFlowsDeleted = int(tag.RowsAffected())

	// 3. the type rows (now flow-free).
	tag, err = tx.Exec(ctx, sqlDeleteFlowLayerTypes)
	if err != nil {
		return res, fmt.Errorf("devtools: delete FlowLayer types: %w", err)
	}
	res.FlowLayerTypesDeleted = int(tag.RowsAffected())

	// ── Cluster B: OldStory / OldRoot / Pending re-classification ────────────
	// 1. artefacts (fields_values + search_outbox cascade; children + map-roots
	//    auto-orphan via SET NULL).
	tag, err = tx.Exec(ctx, sqlDeleteOldPendingArtefacts)
	if err != nil {
		return res, fmt.Errorf("devtools: delete OldStory/OldRoot/Pending artefacts: %w", err)
	}
	res.OldPendingArtefactsDeleted = int(tag.RowsAffected())

	// 2. the 3 type rows (now artefact-free).
	tag, err = tx.Exec(ctx, sqlDeleteOldPendingTypes)
	if err != nil {
		return res, fmt.Errorf("devtools: delete OldStory/OldRoot/Pending types: %w", err)
	}
	res.OldPendingTypesDeleted = int(tag.RowsAffected())

	return res, nil
}
