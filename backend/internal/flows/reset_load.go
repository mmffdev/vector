package flows

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// resetData bundles everything PreviewReset / ApplyReset need to diff
// the live default flow against its frozen snapshot.
type resetData struct {
	typeID    string
	typeName  string
	flowID    string
	flowName  string
	live      []livePill
	snap      []snapshotPill
	liveEdges []snapshotEdge
	snapEdges []snapshotEdge
}

// loadResetData gathers the live default flow + its snapshot for one artefact
// type, scoped to the caller's subscription. Returns ErrNoSnapshot when the
// type has no row in flow_defaults (seed bug or post-seed type).
func (s *Service) loadResetData(ctx context.Context, subscriptionID, artefactTypeID string) (*resetData, error) {
	out := &resetData{typeID: artefactTypeID}

	// 1. Artefact type — name + scope check (subscription gate).
	err := s.vaPool.QueryRow(ctx,
		`SELECT name FROM artefact_types
		 WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		artefactTypeID, subscriptionID,
	).Scan(&out.typeName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("flows: artefact type %s not found in subscription", artefactTypeID)
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load artefact type: %w", err)
	}

	// 2. Default flow for that type.
	err = s.vaPool.QueryRow(ctx,
		`SELECT id, name FROM flows
		 WHERE artefact_type_id = $1 AND is_default = TRUE AND archived_at IS NULL`,
		artefactTypeID,
	).Scan(&out.flowID, &out.flowName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFlowNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load default flow: %w", err)
	}

	// 3. Live pills.
	rows, err := s.vaPool.Query(ctx,
		`SELECT id, name, kind, sort_order, is_initial, is_pullable, colour
		 FROM   flow_states
		 WHERE  flow_id = $1 AND archived_at IS NULL
		 ORDER  BY sort_order`,
		out.flowID,
	)
	if err != nil {
		return nil, fmt.Errorf("flows: load live states: %w", err)
	}
	for rows.Next() {
		var p livePill
		if err := rows.Scan(&p.ID, &p.Name, &p.Kind, &p.SortOrder, &p.IsInitial, &p.IsPullable, &p.Colour); err != nil {
			rows.Close()
			return nil, err
		}
		out.live = append(out.live, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 4. Snapshot pills via flow_defaults → flow_state_defaults.
	var snapFlowID string
	err = s.vaPool.QueryRow(ctx,
		`SELECT id FROM flow_defaults WHERE artefact_type_id = $1`,
		artefactTypeID,
	).Scan(&snapFlowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoSnapshot
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load snapshot flow: %w", err)
	}

	rows, err = s.vaPool.Query(ctx,
		`SELECT id, name, kind, sort_order, is_initial, is_pullable, colour
		 FROM   flow_state_defaults
		 WHERE  flow_default_id = $1
		 ORDER  BY sort_order`,
		snapFlowID,
	)
	if err != nil {
		return nil, fmt.Errorf("flows: load snapshot states: %w", err)
	}
	for rows.Next() {
		var p snapshotPill
		if err := rows.Scan(&p.ID, &p.Name, &p.Kind, &p.SortOrder, &p.IsInitial, &p.IsPullable, &p.Colour); err != nil {
			rows.Close()
			return nil, err
		}
		out.snap = append(out.snap, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 5. Live transitions, joined to state names on both ends.
	rows, err = s.vaPool.Query(ctx,
		`SELECT ft.from_state_id, ft.to_state_id, fs_from.name, fs_to.name
		 FROM   flow_transitions ft
		 JOIN   flow_states fs_from ON fs_from.id = ft.from_state_id
		 JOIN   flow_states fs_to   ON fs_to.id   = ft.to_state_id
		 WHERE  ft.flow_id = $1`,
		out.flowID,
	)
	if err != nil {
		return nil, fmt.Errorf("flows: load live transitions: %w", err)
	}
	for rows.Next() {
		var e snapshotEdge
		if err := rows.Scan(&e.FromID, &e.ToID, &e.FromName, &e.ToName); err != nil {
			rows.Close()
			return nil, err
		}
		out.liveEdges = append(out.liveEdges, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 6. Snapshot transitions, joined to snapshot state names.
	rows, err = s.vaPool.Query(ctx,
		`SELECT ftd.from_state_id, ftd.to_state_id, fsd_from.name, fsd_to.name
		 FROM   flow_transition_defaults ftd
		 JOIN   flow_state_defaults fsd_from ON fsd_from.id = ftd.from_state_id
		 JOIN   flow_state_defaults fsd_to   ON fsd_to.id   = ftd.to_state_id
		 WHERE  ftd.flow_default_id = $1`,
		snapFlowID,
	)
	if err != nil {
		return nil, fmt.Errorf("flows: load snapshot transitions: %w", err)
	}
	for rows.Next() {
		var e snapshotEdge
		if err := rows.Scan(&e.FromID, &e.ToID, &e.FromName, &e.ToName); err != nil {
			rows.Close()
			return nil, err
		}
		out.snapEdges = append(out.snapEdges, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return out, nil
}
