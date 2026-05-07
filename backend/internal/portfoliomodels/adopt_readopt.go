package portfoliomodels

// PLA-0026 / Story 00497 (B8): re-adoption flow.
//
// Re-adoption is the case where a workspace already has a model (a row
// exists in master_record_portfolio) and the operator picks a different
// model. R047 §8 specifies the hard correctness invariant:
//
//   Existing work artefacts must survive the cutover with their parent
//   relationships intact, even though the strategy chain underneath is
//   replaced.
//
// The schema makes this delicate: artefacts.parent_artefact_id is
// `REFERENCES artefacts(id) ON DELETE SET NULL`. If we naively delete
// the old strategy chain, every work artefact rolling up to a now-
// removed strategy artefact gets parent_artefact_id flipped to NULL
// — and the application invariant ("a work item always has a parent")
// is broken.
//
// The placeholder pattern preserves the invariant:
//
//   1. Insert one synthetic strategy artefact_type marked
//      is_placeholder=TRUE for this workspace (migration 024).
//      This is the "Pending re-classification" bin.
//   2. Insert one strategy artefact whose artefact_type_id points at
//      the placeholder type. This is the row work items will be
//      re-parented onto.
//   3. UPDATE every work artefact whose parent points at any OLD
//      strategy artefact → repoint at the placeholder artefact.
//      After this UPDATE, no work artefact references any old
//      strategy artefact.
//   4. DELETE every old strategy artefact (zero references now).
//   5. Soft-archive every old strategy artefact_type row (the
//      ON DELETE RESTRICT FK on parent_type_id makes hard-delete
//      brittle in topo order; soft-archive is sufficient because
//      the rest of the saga reads `archived_at IS NULL`).
//
// The new strategy chain is then minted by the standard saga step
// (writeStrategyArtefactTypes). It does not touch the placeholder.
// The frontend (F-series) surfaces the placeholder so the workspace
// owner can manually move work items into the new model and, when the
// bin is empty, the placeholder type can be archived by an explicit
// admin action (out of scope here).
//
// Sole writer: this file is the only writer that touches artefact_types
// or artefacts during the re-adoption transition. It runs in its own
// vector_artefacts tx so a partial failure is rolled back atomically.

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// runReadoption performs steps 1–5 above in a single vector_artefacts
// tx. Idempotency: each statement is safe to retry — INSERTs use
// ON CONFLICT (placeholder uniqueness is per-workspace via the partial
// index from migration 024), the UPDATE is a no-op once orphans have
// been repointed, the DELETE/UPDATE archive is a no-op once the rows
// are gone / archived. So a saga retry after a partial failure
// converges.
//
// Inputs:
//   subscriptionID, workspaceID — the workspace being re-adopted.
//   adoptedByUserID             — passed through to created_by_user_id
//                                 on the placeholder artefact for audit.
//
// Returns the placeholder type id and artefact id so the caller can
// log them or expose them to the SSE stream.
func runReadoption(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID, adoptedByUserID uuid.UUID,
) (placeholderTypeID, placeholderArtefactID uuid.UUID, err error) {
	if workspaceID == uuid.Nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: workspace_id is required")
	}
	if subscriptionID == uuid.Nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: subscription_id is required")
	}

	// 1. Insert (or fetch) the placeholder artefact_type. Prefix uses a
	//    sentinel that cannot collide with any 3-letter library tag
	//    ("__P" — library prefix is 3 alpha-numeric chars per
	//    librarydb.Bundle). The partial unique index on
	//    (workspace_id) WHERE is_placeholder=TRUE guarantees one row.
	if err := vaTx.QueryRow(ctx, `
		INSERT INTO artefact_types (
			subscription_id, workspace_id,
			scope, source,
			name, prefix, description,
			parent_type_id, allows_children, sort_order,
			library_layer_id, library_layer_tag,
			is_placeholder
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			'Pending re-classification', '__P',
			'Re-adoption placeholder. Move every work item into the new model, then archive this bin.',
			NULL, FALSE, 9999,
			NULL, NULL,
			TRUE
		)
		ON CONFLICT (workspace_id) WHERE is_placeholder = TRUE AND archived_at IS NULL
			DO UPDATE SET updated_at = now()
		RETURNING id`,
		subscriptionID, workspaceID,
	).Scan(&placeholderTypeID); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: upsert placeholder artefact_type: %w", err)
	}

	// 2. Insert the placeholder artefact (the row work items will hang
	//    off). Number is reserved deterministically as 1 because the
	//    placeholder type is fresh per re-adoption and has no other
	//    rows. ON CONFLICT on the (subscription, type, number) unique
	//    index makes this idempotent.
	var createdBy interface{} = adoptedByUserID
	if adoptedByUserID == uuid.Nil {
		createdBy = nil
	}
	if err := vaTx.QueryRow(ctx, `
		INSERT INTO artefacts (
			subscription_id, workspace_id,
			artefact_type_id,
			number,
			title, description,
			parent_artefact_id, flow_state_id,
			created_by_user_id, owned_by_user_id,
			position
		) VALUES (
			$1, $2,
			$3,
			1,
			'Pending re-classification',
			'These work items were attached to the previous portfolio model. Move each into a layer of the new model, then archive this bin.',
			NULL, NULL,
			$4, $4,
			0
		)
		ON CONFLICT (subscription_id, artefact_type_id, number) DO UPDATE
			SET updated_at = now()
		RETURNING id`,
		subscriptionID, workspaceID, placeholderTypeID, createdBy,
	).Scan(&placeholderArtefactID); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: upsert placeholder artefact: %w", err)
	}

	// 3. Repoint every work artefact whose parent is an OLD strategy
	//    artefact (any live strategy row in this workspace whose type
	//    is NOT the placeholder we just inserted) onto the placeholder
	//    artefact. Scoped to this workspace so a multi-workspace tenant
	//    is isolated.
	if _, err := vaTx.Exec(ctx, `
		UPDATE artefacts AS a
		   SET parent_artefact_id = $1,
		       updated_at = now()
		  FROM artefacts AS p
		  JOIN artefact_types AS pt ON pt.id = p.artefact_type_id
		 WHERE a.parent_artefact_id = p.id
		   AND a.workspace_id = $2
		   AND a.archived_at IS NULL
		   AND pt.scope = 'strategy'
		   AND pt.is_placeholder = FALSE
		   AND pt.workspace_id = $2`,
		placeholderArtefactID, workspaceID,
	); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: repoint orphan work artefacts: %w", err)
	}

	// 4. Delete every OLD strategy artefact in this workspace. After
	//    step 3 these rows have zero referencing work artefacts. The
	//    placeholder artefact is excluded by the is_placeholder=FALSE
	//    join filter; the placeholder type is excluded the same way.
	if _, err := vaTx.Exec(ctx, `
		DELETE FROM artefacts AS a
		 USING artefact_types AS t
		 WHERE a.artefact_type_id = t.id
		   AND a.workspace_id = $1
		   AND t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND t.is_placeholder = FALSE`,
		workspaceID,
	); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: delete old strategy artefacts: %w", err)
	}

	// 5. Soft-archive every OLD strategy artefact_type row. We do NOT
	//    hard-delete because parent_type_id has ON DELETE RESTRICT and
	//    a topo-order delete is fragile in the presence of partial
	//    failures. The next saga step (writeStrategyArtefactTypes)
	//    reads `archived_at IS NULL` so the new chain mints cleanly.
	if _, err := vaTx.Exec(ctx, `
		UPDATE artefact_types
		   SET archived_at = now(),
		       updated_at  = now()
		 WHERE workspace_id = $1
		   AND scope = 'strategy'
		   AND is_placeholder = FALSE
		   AND archived_at IS NULL`,
		workspaceID,
	); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("readopt: archive old strategy artefact_types: %w", err)
	}

	return placeholderTypeID, placeholderArtefactID, nil
}
