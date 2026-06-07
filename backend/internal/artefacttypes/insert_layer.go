package artefacttypes

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// gap holds the resolved insertion context: the chosen child type, its current
// strategy parent type, and their display names. resolveGap also enforces the
// structural bounds (cannot insert above the ladder root; cannot exceed the
// 10-layer maximum).
type gap struct {
	childID, childParentID uuid.UUID
	childName, parentName  string
}

// resolveGap validates the child type, derives its current strategy parent, and
// checks the structural bounds. A non-nil *string return is a BLOCKING
// hierarchy rejection (returned to the caller as preview-rejection / commit-422);
// a non-nil error is an infrastructure failure.
func (s *Service) resolveGap(ctx context.Context, subID, wsID uuid.UUID, childID uuid.UUID) (*gap, *string, error) {
	var g gap
	g.childID = childID
	var parentID *uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT c.artefacts_types_name, c.artefacts_types_strategy_parent_id
		FROM artefacts_types c
		WHERE c.artefacts_types_id = $1 AND c.artefacts_types_id_subscription = $2
		  AND c.artefacts_types_scope = 'strategy' AND c.artefacts_types_archived_at IS NULL`,
		childID, subID,
	).Scan(&g.childName, &parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		rej := "Chosen layer not found."
		return nil, &rej, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("resolveGap child: %w", err)
	}
	if parentID == nil {
		// Child is the ladder root — inserting above it is forbidden.
		rej := "Cannot insert above the top layer."
		return nil, &rej, nil
	}
	g.childParentID = *parentID
	if err := s.pool.QueryRow(ctx, `
		SELECT artefacts_types_name FROM artefacts_types
		WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2`,
		g.childParentID, subID,
	).Scan(&g.parentName); err != nil {
		return nil, nil, fmt.Errorf("resolveGap parent: %w", err)
	}

	// Depth cap: count the current ladder length; inserting adds one. Reject >10.
	var ladderLen int
	if err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE chain AS (
			SELECT artefacts_types_id, artefacts_types_strategy_parent_id, 1 AS n
			FROM artefacts_types
			WHERE artefacts_types_strategy_parent_id IS NULL
			  AND artefacts_types_scope='strategy' AND artefacts_types_id_subscription=$1
			  AND artefacts_types_archived_at IS NULL
			UNION ALL
			SELECT t.artefacts_types_id, t.artefacts_types_strategy_parent_id, chain.n+1
			FROM artefacts_types t JOIN chain ON t.artefacts_types_strategy_parent_id = chain.artefacts_types_id
			WHERE t.artefacts_types_scope='strategy' AND t.artefacts_types_archived_at IS NULL
		)
		SELECT COALESCE(MAX(n),0) FROM chain`, subID,
	).Scan(&ladderLen); err != nil {
		return nil, nil, fmt.Errorf("resolveGap ladder: %w", err)
	}
	if ladderLen+1 > 10 {
		rej := "Inserting here would exceed the 10-layer maximum."
		return nil, &rej, nil
	}
	return &g, nil, nil
}

// validateInsertInput checks the new type's tag/name/colour and returns any
// field violations. These are client errors (422), never preview-rejections.
func (s *Service) validateInsertInput(in InsertLayerInput) []Violation {
	var v []Violation
	p := strings.ToUpper(strings.TrimSpace(in.Tag))
	if len(p) == 0 || len(p) > 4 || !regexp.MustCompile(`^[A-Z0-9]+$`).MatchString(p) {
		v = append(v, Violation{"prefix", "Prefix must be 1–4 uppercase letters/digits."})
	}
	if n := strings.TrimSpace(in.Name); len(n) == 0 || len(n) > 64 {
		v = append(v, Violation{"name", "Name must be 1–64 characters."})
	}
	if in.Colour != nil && *in.Colour != "" && !hexColourRE.MatchString(*in.Colour) {
		v = append(v, Violation{"colour", "Colour must be a 6-digit hex value."})
	}
	return v
}

// listImpacted returns the live artefacts of the child type within the clamp,
// for the non-mutating preview path.
func (s *Service) listImpacted(ctx context.Context, subID, wsID, childTypeID uuid.UUID) ([]ImpactedArtefact, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.artefacts_id, a.artefacts_title, p.artefacts_title
		FROM artefacts a
		LEFT JOIN artefacts p ON p.artefacts_id = a.artefacts_id_parent
		WHERE a.artefacts_id_artefact_type = $1
		  AND a.artefacts_id_subscription = $2
		  AND a.artefacts_id_workspace = $3
		  AND a.artefacts_archived_at IS NULL
		ORDER BY a.artefacts_number`,
		childTypeID, subID, wsID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImpactedArtefact
	for rows.Next() {
		var ia ImpactedArtefact
		if err := rows.Scan(&ia.ID, &ia.Name, &ia.CurrentParentName); err != nil {
			return nil, err
		}
		out = append(out, ia)
	}
	return out, rows.Err()
}

// PreviewInsertLayer: per spec §9, malformed INPUT (bad tag/name/colour) still
// returns 422 (it's a client error, not a hierarchy condition). BLOCKING
// hierarchy conditions (bounds, depth cap) return 200 with `rejection` set so
// the flyout can explain why Confirm is disabled. The commit path re-checks all
// of it and is the authoritative gate.
func (s *Service) PreviewInsertLayer(ctx context.Context, subID, wsID uuid.UUID, in InsertLayerInput) (*InsertLayerPreview, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	if viols := s.validateInsertInput(in); len(viols) > 0 {
		return nil, &ValidationError{Violations: viols}
	}
	g, rej, err := s.resolveGap(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, err
	}
	if rej != nil {
		return &InsertLayerPreview{Rejection: rej}, nil
	}
	impacted, err := s.listImpacted(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, fmt.Errorf("PreviewInsertLayer impacted: %w", err)
	}
	return &InsertLayerPreview{
		ParentLayer:      LayerRef{ID: g.childParentID, Name: g.parentName},
		ChildLayer:       LayerRef{ID: g.childID, Name: g.childName},
		Impacted:         impacted,
		PassthroughCount: len(impacted),
	}, nil
}

// InsertLayer commits the insertion in a single transaction: insert N under P,
// reparent the child type under N, backfill one pass-through wrapper per live
// child instance (reparenting each instance under its wrapper), and recompute
// the derived layer_depth mirror. Partial state is impossible — any error
// rolls the whole thing back.
func (s *Service) InsertLayer(ctx context.Context, subID, wsID uuid.UUID, in InsertLayerInput) (*InsertLayerResult, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	if viols := s.validateInsertInput(in); len(viols) > 0 {
		return nil, &ValidationError{Violations: viols}
	}
	g, rej, err := s.resolveGap(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, err
	}
	if rej != nil {
		return nil, &ValidationError{Violations: []Violation{{"child_type_id", *rej}}}
	}

	// Resolve the workspace default priority ONCE — it is workspace-scoped and
	// identical for every wrapper. artefacts_id_priority is NOT NULL with no DB
	// default, so a pass-through must carry it. Mirrors
	// sqlSelectDefaultPriorityForWorkspace (artefactitems/sql.go); inlined here
	// because artefacttypes cannot cleanly import artefactitems internals.
	var defaultPriorityID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		SELECT artefact_priorities_id FROM artefact_priorities
		 WHERE artefact_priorities_id_workspace = $1
		   AND artefact_priorities_archived_at IS NULL
		 ORDER BY (artefact_priorities_slot = 'pri_medium') DESC, artefact_priorities_sort_order ASC
		 LIMIT 1`, wsID,
	).Scan(&defaultPriorityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("InsertLayer: no default priority configured for workspace %s — cannot backfill pass-through artefacts", wsID)
	}
	if err != nil {
		return nil, fmt.Errorf("InsertLayer resolve default priority: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	prefix := strings.ToUpper(strings.TrimSpace(in.Tag))
	name := strings.TrimSpace(in.Name)

	// 1. Insert N under P.
	var newType ArtefactType
	err = tx.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_sort_order)
		VALUES ($1,$2,'strategy','tenant',$3,$4,$5,$6,$7,TRUE,
			COALESCE((SELECT MAX(artefacts_types_sort_order) FROM artefacts_types
				WHERE artefacts_types_id_subscription=$1 AND artefacts_types_scope='strategy'
				  AND artefacts_types_archived_at IS NULL),0)+10)
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_slot, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at,
			artefacts_types_created_at, artefacts_types_updated_at,
			artefacts_types_execution_parent_slots`,
		subID, wsID, name, prefix, in.Description, in.Colour, g.childParentID,
	).Scan(
		&newType.ID, &newType.Scope, &newType.Source, &newType.Name, &newType.Prefix,
		&newType.Description, &newType.Colour, &newType.Slot, &newType.ParentTypeID,
		&newType.AllowsChildren, &newType.LayerDepth, &newType.SortOrder,
		&newType.ArchivedAt, &newType.CreatedAt, &newType.UpdatedAt, &newType.ExecutionParentSlots,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, &ValidationError{Violations: []Violation{{"prefix", "A live type with that prefix already exists in this scope."}}}
		}
		return nil, fmt.Errorf("InsertLayer insert type: %w", err)
	}

	// 2. Re-parent the child type under N.
	if _, err := tx.Exec(ctx, `
		UPDATE artefacts_types SET artefacts_types_strategy_parent_id = $1, artefacts_types_updated_at = now()
		WHERE artefacts_types_id = $2 AND artefacts_types_id_subscription = $3`,
		newType.ID, g.childID, subID,
	); err != nil {
		return nil, fmt.Errorf("InsertLayer reparent type: %w", err)
	}

	// 3. Backfill pass-through instances: one wrapper per live child instance.
	impacted, err := s.listImpactedTx(ctx, tx, subID, wsID, g.childID)
	if err != nil {
		return nil, fmt.Errorf("InsertLayer list impacted: %w", err)
	}
	created := 0
	for _, c := range impacted {
		// Resolve the child instance's current parent (may be NULL).
		var curParent *uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT artefacts_id_parent FROM artefacts WHERE artefacts_id = $1`, c.ID,
		).Scan(&curParent); err != nil {
			return nil, fmt.Errorf("InsertLayer read parent: %w", err)
		}
		newWrapperID, err := s.insertPassThroughArtefact(ctx, tx, subID, wsID, newType.ID, c.Name, curParent, defaultPriorityID)
		if err != nil {
			return nil, fmt.Errorf("InsertLayer wrapper: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE artefacts SET artefacts_id_parent = $1 WHERE artefacts_id = $2`,
			newWrapperID, c.ID,
		); err != nil {
			return nil, fmt.Errorf("InsertLayer reparent instance: %w", err)
		}
		created++
	}

	// 4. Recompute layer_depth as the derived mirror (distance from root).
	if err := s.recomputeStrategyDepthsTx(ctx, tx, subID); err != nil {
		return nil, fmt.Errorf("InsertLayer recompute depth: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("InsertLayer commit: %w", err)
	}
	return &InsertLayerResult{NewType: &newType, CreatedCount: created}, nil
}

// insertPassThroughArtefact creates a minimal artefact of the given type, named
// after the child it wraps. Deliberately NOT the full CreateWorkItem path — a
// pass-through needs only identity, type, parent, clamp, a number, and the
// workspace default priority (artefacts_id_priority is NOT NULL with no DB
// default). The number is allocated as max+1 within the workspace.
func (s *Service) insertPassThroughArtefact(ctx context.Context, tx pgx.Tx, subID, wsID, typeID uuid.UUID, title string, parent *uuid.UUID, priorityID uuid.UUID) (uuid.UUID, error) {
	var newID uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO artefacts (
			artefacts_id_subscription, artefacts_id_workspace,
			artefacts_id_artefact_type, artefacts_number, artefacts_title,
			artefacts_id_parent, artefacts_id_priority)
		VALUES ($1,$2,$3,
			COALESCE((SELECT MAX(artefacts_number)+1 FROM artefacts
				WHERE artefacts_id_workspace=$2),1),
			$4,$5,$6)
		RETURNING artefacts_id`,
		subID, wsID, typeID, title, parent, priorityID,
	).Scan(&newID)
	return newID, err
}

// listImpactedTx is the in-transaction sibling of listImpacted: the live child
// instances within the clamp (no parent-name join — the commit path resolves
// each instance's parent directly).
func (s *Service) listImpactedTx(ctx context.Context, tx pgx.Tx, subID, wsID, childTypeID uuid.UUID) ([]ImpactedArtefact, error) {
	rows, err := tx.Query(ctx, `
		SELECT a.artefacts_id, a.artefacts_title
		FROM artefacts a
		WHERE a.artefacts_id_artefact_type = $1 AND a.artefacts_id_subscription = $2
		  AND a.artefacts_id_workspace = $3 AND a.artefacts_archived_at IS NULL
		ORDER BY a.artefacts_number`,
		childTypeID, subID, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImpactedArtefact
	for rows.Next() {
		var ia ImpactedArtefact
		if err := rows.Scan(&ia.ID, &ia.Name); err != nil {
			return nil, err
		}
		out = append(out, ia)
	}
	return out, rows.Err()
}

// recomputeStrategyDepthsTx sets layer_depth = distance-from-root along the
// strategy_parent_id chain for every live strategy type in the subscription.
func (s *Service) recomputeStrategyDepthsTx(ctx context.Context, tx pgx.Tx, subID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		WITH RECURSIVE chain AS (
			SELECT artefacts_types_id, 0 AS depth
			FROM artefacts_types
			WHERE artefacts_types_strategy_parent_id IS NULL
			  AND artefacts_types_scope='strategy' AND artefacts_types_id_subscription=$1
			  AND artefacts_types_archived_at IS NULL
			UNION ALL
			SELECT t.artefacts_types_id, chain.depth+1
			FROM artefacts_types t JOIN chain ON t.artefacts_types_strategy_parent_id = chain.artefacts_types_id
			WHERE t.artefacts_types_scope='strategy' AND t.artefacts_types_archived_at IS NULL
		)
		UPDATE artefacts_types u SET artefacts_types_layer_depth = chain.depth
		FROM chain WHERE u.artefacts_types_id = chain.artefacts_types_id`, subID)
	return err
}
