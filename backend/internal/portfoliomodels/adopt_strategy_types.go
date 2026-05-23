package portfoliomodels

// PLA-0026 / Story 00492 (B3): adoption-saga step 2 rewrite — write
// strategy-scope artefacts_types into vector_artefacts.
//
// This file is the first VA writer in the adoption saga. The legacy
// writeLayers (obj_strategy_types_layers in mmff_vector) still runs;
// after it commits, the orchestrator opens a vaTx and runs this writer
// against vector_artefacts.artefacts_types. Both writes are idempotent
// (ON CONFLICT … DO NOTHING) so a retry after a partial cross-DB
// failure converges.
//
// Schema target: vector_artefacts.artefacts_types (M1–M4)
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
// vector_artefacts.artefacts_types as a strategy-scope tenant row.
// Two-phase topological insert handles the parent self-FK without
// requiring a deterministic ordering of bundle.Layers.
//
// layer_depth is derived from the rank position (not SortOrder directly)
// of each live layer when sorted by SortOrder ASC. This keeps depths in
// the 0..9 CHECK range regardless of how the upstream bundle spaces its
// sort values (libraries commonly use 10/20/30/… for editable gaps).
func writeStrategyArtefactTypes(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID uuid.UUID,
	bundle *librarydb.Bundle,
) error {
	// Build the rank-ordered list of live layers. Depth = index in this
	// list (0 = top-of-ladder), capped at 9 to honour the CHECK
	// constraint. Bundles with more than 10 layers pile the deepest
	// ones at depth=9 — the frontend's "allowed parents = smaller
	// depth" rule still works correctly within the unclipped prefix
	// of the ladder.
	//
	// Ordering rule: prefer the bundle's NATIVE array order when present
	// (library production data emits layers top-down — Theme first,
	// Feature last). Fall back to SortOrder ASCENDING for callers that
	// build bundles directly (test fixtures use Root=SortOrder=0 with
	// children at higher orders). The two conventions DISAGREE in the
	// library production path because librarydb/fetch.go assigns
	// SortOrder=(n-1-i)*10 — Feature (the last layer in the JSONB)
	// ends up with SortOrder=0 even though it's the BOTTOM of the
	// ladder. By preserving array order we honour the human-authored
	// JSONB intent and remain compatible with the SortOrder=0 = root
	// fixtures (the array order matches in both cases — root sits at
	// index 0).
	live := make([]*librarydb.Layer, 0, len(bundle.Layers))
	for i := range bundle.Layers {
		l := &bundle.Layers[i]
		if l.ArchivedAt != nil {
			continue
		}
		live = append(live, l)
	}
	// No sort — preserve bundle order.
	depthByLayerID := make(map[uuid.UUID]int, len(live))
	for i, l := range live {
		d := i
		if d > 9 {
			d = 9
		}
		depthByLayerID[l.ID] = d
	}

	// Load the existing tag map BEFORE Phase 1 so we can skip inserts
	// for layers whose tag is already present in the workspace under a
	// possibly-renamed prefix. The unique-prefix index would let us
	// insert a duplicate row if the user renamed the original (the
	// prefix shifted), creating two Feature rows for the same library
	// layer — one stale, one fresh. Dedup on tag prevents that.
	preTagMap, err := loadStrategyTypeTagMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	// Phase 1: insert every live layer with parent_type_id=NULL — but
	// SKIP layers whose tag already has a mirror row in this workspace
	// (re-sync against an existing adoption that may have user renames).
	for _, l := range live {
		if _, exists := preTagMap[l.Tag]; exists {
			continue
		}
		if _, err := vaTx.Exec(ctx, sqlInsertStrategyArtefactType,
			subscriptionID, workspaceID,
			l.Name, l.Tag, l.DescriptionMD,
			l.AllowsChildren, l.SortOrder,
			depthByLayerID[l.ID], // layer_depth
			l.ID, l.Tag,
		); err != nil {
			return fmt.Errorf("insert strategy artefact_type %q: %w", l.Name, err)
		}
	}

	// Phase 2: for every layer with a library parent, UPDATE its mirror's
	// parent_type_id to the mirror id of that parent. Both maps are
	// loaded after Phase 1 commits in-tx so any freshly-inserted rows
	// are visible. The tag map is the re-sync fallback for tenants whose
	// stored library_layer_id no longer matches the current bundle's
	// Layer.ID (library rebuilt post-adoption) — Layer.Tag stays stable.
	typeMap, err := loadStrategyTypeMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}
	tagMap, err := loadStrategyTypeTagMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	// resolveMirror returns the workspace's mirror artefact_type id for
	// a library Layer, preferring the library_layer_id match and
	// falling back to library_layer_tag.
	resolveMirror := func(l *librarydb.Layer) (uuid.UUID, bool) {
		if id, ok := typeMap[l.ID]; ok {
			return id, true
		}
		if id, ok := tagMap[l.Tag]; ok {
			return id, true
		}
		return uuid.Nil, false
	}

	// Parent-chain fallback: when library Layer.ParentLayerID is null
	// (bundles that don't model parents), derive the chain by stepping
	// one position back in the SortOrder ranking. Rank 0 (the top of
	// the ladder) stays parent_type_id=NULL.
	//
	// strictParent: explicit ParentLayerID means the bundle declared
	// the relationship — a missing parent in `live` is a bundle bug,
	// not a normal re-sync situation, so we surface it as an error to
	// match the legacy contract (the orphan-parent test pins this).
	// SortOrder-derived parents are inferred; missing mirrors there
	// are tolerated because the workspace may have custom renames.
	for i, l := range live {
		var parentLayer *librarydb.Layer
		strictParent := false
		if l.ParentLayerID != nil {
			strictParent = true
			for _, cand := range live {
				if cand.ID == *l.ParentLayerID {
					parentLayer = cand
					break
				}
			}
			if parentLayer == nil {
				return fmt.Errorf("strategy layer %q references unknown parent_layer_id %s",
					l.Name, *l.ParentLayerID)
			}
		} else if i > 0 {
			parentLayer = live[i-1]
		}
		if parentLayer == nil {
			// Rank-0 layer (top of ladder): make sure the mirror's
			// parent_type_id is NULL. Re-sync may run against rows that
			// previously had a (now-stale) parent value from an older
			// adoption — clear it so the ladder root is unambiguous.
			mirSelf, selfOk := resolveMirror(l)
			if selfOk {
				if _, err := vaTx.Exec(ctx, sqlUpdateStrategyArtefactTypeParent,
					nil, mirSelf, workspaceID,
				); err != nil {
					return fmt.Errorf("clear parent for strategy artefact_type %q: %w", l.Name, err)
				}
			}
		}
		if parentLayer != nil {
			mirParent, parentOk := resolveMirror(parentLayer)
			mirSelf, selfOk := resolveMirror(l)
			if parentOk && selfOk {
				if _, err := vaTx.Exec(ctx, sqlUpdateStrategyArtefactTypeParent,
					mirParent, mirSelf, workspaceID,
				); err != nil {
					return fmt.Errorf("set parent for strategy artefact_type %q: %w", l.Name, err)
				}
			} else if strictParent {
				// Explicit bundle parent that we can't resolve in the
				// workspace's mirrors — this should be impossible after
				// Phase 1 (every live layer either inserts or already
				// exists). Treat as a bundle-vs-workspace consistency
				// error to surface mis-adopted state early.
				if !parentOk {
					return fmt.Errorf("strategy layer %q: mirror missing for explicit parent %q",
						l.Name, parentLayer.Tag)
				}
				if !selfOk {
					return fmt.Errorf("strategy layer %q: own mirror missing", l.Name)
				}
			}
			// SortOrder-fallback path: soft-skip when either side fails
			// to resolve. Leaves parent_type_id untouched; the admin can
			// fix manually via the artefact-types page.
		}

		// Idempotently bring layer_depth up to date on rows that survived
		// ON CONFLICT DO NOTHING in Phase 1. Applies to top-of-ladder too
		// (depth=0 still needs landing on legacy rows).
		mirSelf, ok := resolveMirror(l)
		if !ok {
			continue
		}
		if _, err := vaTx.Exec(ctx, sqlUpdateStrategyArtefactTypeLayerDepth,
			depthByLayerID[l.ID], mirSelf, workspaceID,
		); err != nil {
			return fmt.Errorf("set layer_depth for strategy artefact_type %q: %w", l.Name, err)
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
	rows, err := vaTx.Query(ctx, sqlSelectStrategyArtefactTypeMap, workspaceID)
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

// loadStrategyTypeTagMap returns library_layer_tag → artefact_type_id
// for every live strategy-scope row in this workspace. Used as a
// re-sync fallback when the current bundle's Layer.ID no longer
// matches the id stored at first-adoption time (library rebuilt
// between adoption and resync), but the tag (= Layer.Tag) is stable.
func loadStrategyTypeTagMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[string]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, sqlSelectStrategyArtefactTypeTagMap, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load strategy artefact_type tag map: %w", err)
	}
	defer rows.Close()
	m := make(map[string]uuid.UUID)
	for rows.Next() {
		var tag string
		var mirID uuid.UUID
		if err := rows.Scan(&tag, &mirID); err != nil {
			return nil, fmt.Errorf("scan strategy artefact_type tag map: %w", err)
		}
		m[tag] = mirID
	}
	return m, rows.Err()
}
