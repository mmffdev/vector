package flows

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SeedDefaultFlowForType creates a default flow for newTypeID inside the
// caller's transaction, cloning the source type's live default flow (states +
// transitions). If the source has no live default flow, it seeds the standard
// spine so the type is never flowless. Also writes the flows_defaults snapshot
// rows so "reset to default" works later.
//
// The seeder runs raw SQL on the passed tx — flows.Service's other methods are
// NOT tx-aware (they use s.vaPool directly), so they must not be called here.
func (s *Service) SeedDefaultFlowForType(ctx context.Context, tx pgx.Tx, sourceTypeID, newTypeID uuid.UUID, newTypeName string) error {
	// 1. Insert the new default flow.
	var newFlowID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO flows (flows_id_artefact_type, flows_name, flows_is_default)
		VALUES ($1, $2, TRUE)
		RETURNING flows_id`,
		newTypeID, newTypeName+" default flow",
	).Scan(&newFlowID); err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType insert flow: %w", err)
	}

	// 2. Find the source's live default flow.
	var srcFlowID uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT flows_id FROM flows
		WHERE flows_id_artefact_type = $1 AND flows_is_default = TRUE AND flows_archived_at IS NULL
		LIMIT 1`, sourceTypeID,
	).Scan(&srcFlowID)

	if errors.Is(err, pgx.ErrNoRows) {
		// 3a. Fallback: seed the standard spine.
		return s.seedSpineStates(ctx, tx, newFlowID, newTypeID, standardSpine)
	}
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType find source: %w", err)
	}

	// 3b. Clone source states, capturing old→new id map.
	rows, err := tx.Query(ctx, `
		SELECT flows_states_id, flows_states_name, flows_states_kind, flows_states_colour,
		       flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable
		FROM flows_states
		WHERE flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
		ORDER BY flows_states_sort_order`, srcFlowID)
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType read states: %w", err)
	}
	type stateRow struct {
		oldID                 uuid.UUID
		name, kind            string
		colour                *string
		sortOrder             int
		isInitial, isPullable bool
	}
	var srcStates []stateRow
	for rows.Next() {
		var r stateRow
		if err := rows.Scan(&r.oldID, &r.name, &r.kind, &r.colour, &r.sortOrder, &r.isInitial, &r.isPullable); err != nil {
			rows.Close()
			return fmt.Errorf("flows.SeedDefaultFlowForType scan state: %w", err)
		}
		srcStates = append(srcStates, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	idMap := make(map[uuid.UUID]uuid.UUID, len(srcStates))
	for _, st := range srcStates {
		var newID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
				flows_states_colour, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flows_states_id`,
			newFlowID, st.name, st.kind, st.colour, st.sortOrder, st.isInitial, st.isPullable,
		).Scan(&newID); err != nil {
			return fmt.Errorf("flows.SeedDefaultFlowForType insert state: %w", err)
		}
		idMap[st.oldID] = newID
	}

	// 3c. Clone transitions, remapping from/to ids.
	trows, err := tx.Query(ctx, `
		SELECT flows_transitions_id_state_from, flows_transitions_id_state_to
		FROM flows_transitions WHERE flows_transitions_id_flow = $1`, srcFlowID)
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType read transitions: %w", err)
	}
	type tr struct{ from, to uuid.UUID }
	var trs []tr
	for trows.Next() {
		var x tr
		if err := trows.Scan(&x.from, &x.to); err != nil {
			trows.Close()
			return err
		}
		trs = append(trs, x)
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return err
	}
	for _, x := range trs {
		nf, okf := idMap[x.from]
		nt, okt := idMap[x.to]
		if !okf || !okt {
			continue // skip transitions referencing archived/absent states
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
			VALUES ($1,$2,$3)
			ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING`,
			newFlowID, nf, nt,
		); err != nil {
			return fmt.Errorf("flows.SeedDefaultFlowForType insert transition: %w", err)
		}
	}

	return s.writeFlowDefaults(ctx, tx, newTypeID, newFlowID, newTypeName)
}

// seedSpineStates inserts the standard spine states + adjacent-bidirectional
// transitions for a flow, then writes the defaults snapshot.
func (s *Service) seedSpineStates(ctx context.Context, tx pgx.Tx, flowID, typeID uuid.UUID, spine []SpineState) error {
	ids := make([]uuid.UUID, len(spine))
	for i, st := range spine {
		var colour *string
		if st.Colour != "" {
			colour = &st.Colour
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
				flows_states_colour, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flows_states_id`,
			flowID, st.Name, st.Kind, colour, st.SortOrder, st.IsInitial, st.IsPullable,
		).Scan(&ids[i]); err != nil {
			return fmt.Errorf("flows.seedSpineStates insert state: %w", err)
		}
	}
	// adjacent bidirectional transitions
	for i := 0; i+1 < len(ids); i++ {
		for _, pair := range [][2]uuid.UUID{{ids[i], ids[i+1]}, {ids[i+1], ids[i]}} {
			if _, err := tx.Exec(ctx, `
				INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
				VALUES ($1,$2,$3)
				ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING`,
				flowID, pair[0], pair[1],
			); err != nil {
				return fmt.Errorf("flows.seedSpineStates insert transition: %w", err)
			}
		}
	}
	return s.writeFlowDefaultsFromFlow(ctx, tx, typeID, flowID)
}

// writeFlowDefaults snapshots the just-created flow into the *_defaults tables.
// Thin wrapper over writeFlowDefaultsFromFlow (newTypeName is unused — the
// defaults row name is the canonical literal 'default' so the reset path is
// name-agnostic).
func (s *Service) writeFlowDefaults(ctx context.Context, tx pgx.Tx, typeID, flowID uuid.UUID, _ string) error {
	return s.writeFlowDefaultsFromFlow(ctx, tx, typeID, flowID)
}

// writeFlowDefaultsFromFlow snapshots a live flow's states + transitions into
// flows_defaults / flows_states_defaults / flows_transitions_defaults, so a
// later "reset to default" can rebuild the live flow from the snapshot. Runs on
// the caller's tx so the snapshot is atomic with the live flow it mirrors.
func (s *Service) writeFlowDefaultsFromFlow(ctx context.Context, tx pgx.Tx, typeID, flowID uuid.UUID) error {
	// 1. flows_defaults row (one per artefact type). Re-select on conflict so a
	//    re-seed of the same type reuses the existing defaults row.
	var defaultFlowID uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO flows_defaults (flows_defaults_id_artefact_type, flows_defaults_name)
		VALUES ($1, 'default')
		ON CONFLICT (flows_defaults_id_artefact_type) DO NOTHING
		RETURNING flows_defaults_id`, typeID,
	).Scan(&defaultFlowID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Conflict path — the row already exists; re-select its id.
		if err := tx.QueryRow(ctx, `
			SELECT flows_defaults_id FROM flows_defaults
			WHERE flows_defaults_id_artefact_type = $1`, typeID,
		).Scan(&defaultFlowID); err != nil {
			return fmt.Errorf("flows.writeFlowDefaults reselect default: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("flows.writeFlowDefaults insert default: %w", err)
	}

	// 2. Copy the live flow's states into flows_states_defaults, capturing a
	//    live-state-id → default-state-id map for the transition remap.
	rows, err := tx.Query(ctx, `
		SELECT flows_states_id, flows_states_name, flows_states_kind, flows_states_colour,
		       flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable
		FROM flows_states
		WHERE flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
		ORDER BY flows_states_sort_order`, flowID)
	if err != nil {
		return fmt.Errorf("flows.writeFlowDefaults read states: %w", err)
	}
	type liveState struct {
		id                    uuid.UUID
		name, kind            string
		colour                *string
		sortOrder             int
		isInitial, isPullable bool
	}
	var live []liveState
	for rows.Next() {
		var r liveState
		if err := rows.Scan(&r.id, &r.name, &r.kind, &r.colour, &r.sortOrder, &r.isInitial, &r.isPullable); err != nil {
			rows.Close()
			return fmt.Errorf("flows.writeFlowDefaults scan state: %w", err)
		}
		live = append(live, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	defStateMap := make(map[uuid.UUID]uuid.UUID, len(live))
	for _, st := range live {
		var defStateID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO flows_states_defaults (flows_states_defaults_id_flow_default,
				flows_states_defaults_name, flows_states_defaults_kind, flows_states_defaults_colour,
				flows_states_defaults_sort_order, flows_states_defaults_is_initial, flows_states_defaults_is_pullable)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flows_states_defaults_id`,
			defaultFlowID, st.name, st.kind, st.colour, st.sortOrder, st.isInitial, st.isPullable,
		).Scan(&defStateID); err != nil {
			return fmt.Errorf("flows.writeFlowDefaults insert state default: %w", err)
		}
		defStateMap[st.id] = defStateID
	}

	// 3. Copy the live flow's transitions into flows_transitions_defaults,
	//    remapping the from/to ids to the defaults' state ids.
	trows, err := tx.Query(ctx, `
		SELECT flows_transitions_id_state_from, flows_transitions_id_state_to
		FROM flows_transitions WHERE flows_transitions_id_flow = $1`, flowID)
	if err != nil {
		return fmt.Errorf("flows.writeFlowDefaults read transitions: %w", err)
	}
	type edge struct{ from, to uuid.UUID }
	var edges []edge
	for trows.Next() {
		var e edge
		if err := trows.Scan(&e.from, &e.to); err != nil {
			trows.Close()
			return err
		}
		edges = append(edges, e)
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return err
	}
	for _, e := range edges {
		df, okf := defStateMap[e.from]
		dt, okt := defStateMap[e.to]
		if !okf || !okt {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO flows_transitions_defaults (flows_transitions_defaults_id_flow_default,
				flows_transitions_defaults_id_state_from, flows_transitions_defaults_id_state_to)
			VALUES ($1,$2,$3)
			ON CONFLICT (flows_transitions_defaults_id_flow_default, flows_transitions_defaults_id_state_from, flows_transitions_defaults_id_state_to) DO NOTHING`,
			defaultFlowID, df, dt,
		); err != nil {
			return fmt.Errorf("flows.writeFlowDefaults insert transition default: %w", err)
		}
	}
	return nil
}
