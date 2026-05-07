package portfoliomodels

// PLA-0026 / Story 00492 (B3): adoption-saga step 2 rewrite — write
// strategy-scope artefact_types into vector_artefacts.
//
// This file is the first VA writer in the adoption saga. The legacy
// writeLayers (obj_strategy_types_layers in mmff_vector) still runs;
// after it commits, the orchestrator opens a vaTx and runs this writer
// against vector_artefacts.artefact_types. Both writes are idempotent
// (ON CONFLICT … DO NOTHING) so a retry after a partial cross-DB
// failure converges.
//
// Schema target: vector_artefacts.artefact_types (M1–M4)
//   subscription_id   — soft FK mmff_vector.subscriptions
//   workspace_id      — soft FK mmff_vector.workspaces  (NOT NULL)
//   scope             — 'strategy' here
//   source            — 'tenant'    (every adopted-from-library row is tenant-built)
//   name              — library Layer.Name
//   prefix            — library Layer.Tag (3-letter)
//   description       — library Layer.DescriptionMD (raw markdown, may be NULL)
//   parent_type_id    — self-FK; resolved via two-phase pattern
//   allows_children   — library Layer.AllowsChildren
//   sort_order        — library Layer.SortOrder
//   library_layer_id  — provenance: library Layer.ID
//   library_layer_tag — denormalised library Layer.Tag (fast re-adoption check)
//
// Idempotency key: UNIQUE (workspace_id, scope, prefix) WHERE archived_at IS NULL
// (uq_artefact_types_ws_scope_prefix from M4 / migration 019).

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// writeStrategyArtefactTypes mirrors every live library Layer into
// vector_artefacts.artefact_types as a strategy-scope tenant row.
// Two-phase topological insert handles the parent self-FK without
// requiring a deterministic ordering of bundle.Layers.
func writeStrategyArtefactTypes(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID uuid.UUID,
	bundle *librarydb.Bundle,
) error {
	// Phase 1: insert every live layer with parent_type_id=NULL.
	for _, l := range bundle.Layers {
		if l.ArchivedAt != nil {
			continue
		}
		if _, err := vaTx.Exec(ctx, `
			INSERT INTO artefact_types (
				subscription_id, workspace_id,
				scope, source,
				name, prefix, description,
				parent_type_id, allows_children, sort_order,
				library_layer_id, library_layer_tag
			) VALUES (
				$1, $2,
				'strategy', 'tenant',
				$3, $4, $5,
				NULL, $6, $7,
				$8, $9
			)
			ON CONFLICT (workspace_id, scope, prefix)
				WHERE archived_at IS NULL
				DO NOTHING`,
			subscriptionID, workspaceID,
			l.Name, l.Tag, l.DescriptionMD,
			l.AllowsChildren, l.SortOrder,
			l.ID, l.Tag,
		); err != nil {
			return fmt.Errorf("insert strategy artefact_type %q: %w", l.Name, err)
		}
	}

	// Phase 2: for every layer with a library parent, UPDATE its mirror's
	// parent_type_id to the mirror id of that parent. The map is loaded
	// once after Phase 1 commits in-tx (rows are visible to the same tx).
	typeMap, err := loadStrategyTypeMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	for _, l := range bundle.Layers {
		if l.ArchivedAt != nil || l.ParentLayerID == nil {
			continue
		}
		mirParent, ok := typeMap[*l.ParentLayerID]
		if !ok {
			return fmt.Errorf("strategy layer %q references unknown parent_layer_id %s",
				l.Name, l.ParentLayerID)
		}
		mirSelf, ok := typeMap[l.ID]
		if !ok {
			// ON CONFLICT DO NOTHING silently skipped this row — it
			// already existed in a prior run, parent should already
			// be set; nothing to do.
			continue
		}
		if _, err := vaTx.Exec(ctx, `
			UPDATE artefact_types
			   SET parent_type_id = $1
			 WHERE id = $2
			   AND workspace_id = $3
			   AND scope = 'strategy'
			   AND archived_at IS NULL`,
			mirParent, mirSelf, workspaceID,
		); err != nil {
			return fmt.Errorf("set parent for strategy artefact_type %q: %w", l.Name, err)
		}
	}
	return nil
}

// loadStrategyTypeMap returns library_layer_id → artefact_type_id for
// every live strategy-scope row in this workspace. Used by Phase 2 to
// resolve parent_type_id and by future re-adoption checks ("do we
// already have this layer?").
func loadStrategyTypeMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, `
		SELECT library_layer_id, id
		  FROM artefact_types
		 WHERE workspace_id = $1
		   AND scope = 'strategy'
		   AND archived_at IS NULL
		   AND library_layer_id IS NOT NULL`,
		workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("load strategy artefact_type map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var libID, mirID uuid.UUID
		if err := rows.Scan(&libID, &mirID); err != nil {
			return nil, fmt.Errorf("scan strategy artefact_type map: %w", err)
		}
		m[libID] = mirID
	}
	return m, rows.Err()
}
