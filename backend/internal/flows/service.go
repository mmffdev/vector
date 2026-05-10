package flows

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrStateNotFound = errors.New("flow state not found")
	reColour         = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

// Service reads flows and their states from vector_artefacts, scoped per
// subscription. mainPool is kept for the tenancy gate only (membership
// check); all data reads go to vaPool.
type Service struct {
	vaPool   *pgxpool.Pool
	mainPool *pgxpool.Pool
}

// New returns a Service backed by the given pools.
func New(vaPool, mainPool *pgxpool.Pool) *Service {
	return &Service{vaPool: vaPool, mainPool: mainPool}
}

// ListBySubscription returns every flow for the subscription, each with its
// states ordered by sort_order. Archived flows and states are excluded.
func (s *Service) ListBySubscription(ctx context.Context, subscriptionID string) (*ListResponse, error) {
	work, err := s.listByScope(ctx, subscriptionID, "work")
	if err != nil {
		return nil, fmt.Errorf("flows: list work scope: %w", err)
	}
	strategy, err := s.listByScope(ctx, subscriptionID, "strategy")
	if err != nil {
		return nil, fmt.Errorf("flows: list strategy scope: %w", err)
	}
	return &ListResponse{Work: work, Strategy: strategy}, nil
}

func (s *Service) listByScope(ctx context.Context, subscriptionID, scope string) ([]FlowGroup, error) {
	const q = `
		SELECT
		    f.id,
		    f.name         AS flow_name,
		    f.is_default,
		    f.artefact_type_id,
		    at.name        AS type_name,
		    at.scope       AS type_scope,
		    fs.id          AS state_id,
		    fs.name        AS state_name,
		    fs.kind        AS state_kind,
		    fs.sort_order  AS state_sort_order,
		    fs.is_initial  AS state_is_initial,
		    fs.colour      AS state_colour
		FROM flows f
		JOIN artefact_types at ON at.id = f.artefact_type_id
		JOIN flow_states    fs ON fs.flow_id = f.id AND fs.archived_at IS NULL
		WHERE at.subscription_id = $1
		  AND at.scope = $2
		  AND at.archived_at IS NULL
		  AND f.archived_at IS NULL
		ORDER BY at.name, f.is_default DESC, fs.sort_order;`

	rows, err := s.vaPool.Query(ctx, q, subscriptionID, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groupIdx := make(map[string]int)
	groups := []FlowGroup{}

	for rows.Next() {
		var (
			flowID, flowName, typeID, typeName, typeScope string
			isDefault                                     bool
			st                                            FlowState
		)
		if err := rows.Scan(
			&flowID, &flowName, &isDefault, &typeID, &typeName, &typeScope,
			&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.Colour,
		); err != nil {
			return nil, err
		}
		idx, ok := groupIdx[flowID]
		if !ok {
			idx = len(groups)
			groupIdx[flowID] = idx
			groups = append(groups, FlowGroup{
				FlowID:    flowID,
				FlowName:  flowName,
				IsDefault: isDefault,
				TypeID:    typeID,
				TypeName:  typeName,
				TypeScope: typeScope,
				States:    []FlowState{},
			})
		}
		groups[idx].States = append(groups[idx].States, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Fetch transitions for all groups in one query.
	if len(groups) > 0 {
		flowIDs := make([]string, len(groups))
		for i, g := range groups {
			flowIDs[i] = g.FlowID
		}
		if err := s.loadTransitions(ctx, groups, groupIdx, flowIDs); err != nil {
			return nil, err
		}
	}

	return groups, nil
}

func (s *Service) loadTransitions(
	ctx context.Context,
	groups []FlowGroup,
	groupIdx map[string]int,
	flowIDs []string,
) error {
	const q = `
		SELECT flow_id, from_state_id, to_state_id
		FROM   flow_transitions
		WHERE  flow_id = ANY($1)
		ORDER  BY flow_id, from_state_id, to_state_id;`

	rows, err := s.vaPool.Query(ctx, q, flowIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var flowID, from, to string
		if err := rows.Scan(&flowID, &from, &to); err != nil {
			return err
		}
		if idx, ok := groupIdx[flowID]; ok {
			groups[idx].Transitions = append(groups[idx].Transitions, FlowTransition{From: from, To: to})
		}
	}
	return rows.Err()
}

// PatchFlowState updates the colour of a single flow state, scoped to the
// caller's subscription so tenants cannot mutate each other's states.
// Returns ErrStateNotFound when the id doesn't exist in this subscription.
func (s *Service) PatchFlowState(ctx context.Context, subscriptionID, stateID string, in PatchStateInput) (*FlowState, error) {
	if in.Colour != nil && !reColour.MatchString(*in.Colour) {
		return nil, fmt.Errorf("flows: colour must be #RRGGBB or null")
	}

	const q = `
		UPDATE flow_states fs
		SET    colour = $1
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  fs.id      = $2
		  AND  fs.flow_id = f.id
		  AND  at.subscription_id = $3
		  AND  at.archived_at IS NULL
		  AND  f.archived_at  IS NULL
		  AND  fs.archived_at IS NULL
		RETURNING fs.id, fs.name, fs.kind, fs.sort_order, fs.is_initial, fs.colour`

	var st FlowState
	err := s.vaPool.QueryRow(ctx, q, in.Colour, stateID, subscriptionID).Scan(
		&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.Colour,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: patch state: %w", err)
	}
	return &st, nil
}
