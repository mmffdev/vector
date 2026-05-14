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
	err := s.vaPool.QueryRow(ctx, sqlSelectArtefactTypeNameInTenant,
		artefactTypeID, subscriptionID,
	).Scan(&out.typeName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("flows: artefact type %s not found in subscription", artefactTypeID)
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load artefact type: %w", err)
	}

	// 2. Default flow for that type.
	err = s.vaPool.QueryRow(ctx, sqlSelectDefaultFlowForArtefactType, artefactTypeID).
		Scan(&out.flowID, &out.flowName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFlowNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load default flow: %w", err)
	}

	// 3. Live pills.
	rows, err := s.vaPool.Query(ctx, sqlListLiveFlowStateRows, out.flowID)
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
	err = s.vaPool.QueryRow(ctx, sqlSelectFlowDefaultID, artefactTypeID).Scan(&snapFlowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoSnapshot
	}
	if err != nil {
		return nil, fmt.Errorf("flows: load snapshot flow: %w", err)
	}

	rows, err = s.vaPool.Query(ctx, sqlListSnapshotFlowStateRows, snapFlowID)
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
	rows, err = s.vaPool.Query(ctx, sqlListLiveTransitionsWithNames, out.flowID)
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
	rows, err = s.vaPool.Query(ctx, sqlListSnapshotTransitionsWithNames, snapFlowID)
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
