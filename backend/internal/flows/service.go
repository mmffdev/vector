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
	ErrStateNotFound      = errors.New("flow state not found")
	ErrFlowNotFound       = errors.New("flow not found")
	ErrTransitionNotFound = errors.New("flow transition not found")
	ErrTransitionExists   = errors.New("transition already exists")
	reColour              = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	validKinds            = map[string]bool{
		"backlog": true, "todo": true, "in_progress": true, "done": true,
		"accepted": true, "cancelled": true,
	}
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
		    fs.is_pullable AS state_is_pullable,
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
			&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour,
		); err != nil {
			return nil, err
		}
		idx, ok := groupIdx[flowID]
		if !ok {
			idx = len(groups)
			groupIdx[flowID] = idx
			groups = append(groups, FlowGroup{
				FlowID:      flowID,
				FlowName:    flowName,
				IsDefault:   isDefault,
				TypeID:      typeID,
				TypeName:    typeName,
				TypeScope:   typeScope,
				States:      []FlowState{},
				Transitions: []FlowTransition{},
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

// PatchFlowState updates mutable fields on a single flow state, scoped to the
// caller's subscription. Returns ErrStateNotFound when the id doesn't exist.
func (s *Service) PatchFlowState(ctx context.Context, subscriptionID, stateID string, in PatchStateInput) (*FlowState, error) {
	if in.Colour != nil && !reColour.MatchString(*in.Colour) {
		return nil, fmt.Errorf("flows: colour must be #RRGGBB or null")
	}
	if in.Name != nil && *in.Name == "" {
		return nil, fmt.Errorf("flows: name must not be empty")
	}
	if in.Kind != nil && !validKinds[*in.Kind] {
		return nil, fmt.Errorf("flows: invalid kind %q", *in.Kind)
	}

	const q = `
		UPDATE flow_states fs
		SET    colour      = COALESCE($1, fs.colour),
		       name        = COALESCE($4, fs.name),
		       sort_order  = COALESCE($5, fs.sort_order),
		       is_initial  = COALESCE($6, fs.is_initial),
		       kind        = COALESCE($7, fs.kind),
		       is_pullable = COALESCE($8, fs.is_pullable)
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  fs.id      = $2
		  AND  fs.flow_id = f.id
		  AND  at.subscription_id = $3
		  AND  at.archived_at IS NULL
		  AND  f.archived_at  IS NULL
		  AND  fs.archived_at IS NULL
		RETURNING fs.id, fs.name, fs.kind, fs.sort_order, fs.is_initial, fs.is_pullable, fs.colour`

	// Colour is the only nullable-to-clear field; the others use COALESCE.
	// Pass nil colour as a signal to clear it; for other fields nil = no change.
	var st FlowState
	err := s.vaPool.QueryRow(ctx, q, in.Colour, stateID, subscriptionID, in.Name, in.SortOrder, in.IsInitial, in.Kind, in.IsPullable).Scan(
		&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: patch state: %w", err)
	}
	return &st, nil
}

// CreateState adds a new state to the given flow, scoped to subscription.
func (s *Service) CreateState(ctx context.Context, subscriptionID, flowID string, in CreateStateInput) (*FlowState, error) {
	if in.Name == "" {
		return nil, fmt.Errorf("flows: name is required")
	}
	if !validKinds[in.Kind] {
		return nil, fmt.Errorf("flows: invalid kind %q", in.Kind)
	}

	// If sort_order not supplied, append after the current max.
	if in.SortOrder == 0 {
		var max int
		_ = s.vaPool.QueryRow(ctx,
			`SELECT COALESCE(MAX(sort_order), 0) FROM flow_states WHERE flow_id = $1 AND archived_at IS NULL`,
			flowID).Scan(&max)
		in.SortOrder = max + 10
	}

	const q = `
		INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
		SELECT f.id, $3, $4, $5, $6, $7
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  f.id = $1
		  AND  at.subscription_id = $2
		  AND  f.archived_at IS NULL
		  AND  at.archived_at IS NULL
		RETURNING id, name, kind, sort_order, is_initial, is_pullable, colour`

	var st FlowState
	err := s.vaPool.QueryRow(ctx, q, flowID, subscriptionID, in.Name, in.Kind, in.SortOrder, in.IsInitial, in.IsPullable).Scan(
		&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFlowNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: create state: %w", err)
	}
	return &st, nil
}

// DeleteState soft-archives a flow state, scoped to subscription.
func (s *Service) DeleteState(ctx context.Context, subscriptionID, stateID string) error {
	const q = `
		UPDATE flow_states fs
		SET    archived_at = NOW()
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  fs.id = $1
		  AND  fs.flow_id = f.id
		  AND  at.subscription_id = $2
		  AND  fs.archived_at IS NULL`

	tag, err := s.vaPool.Exec(ctx, q, stateID, subscriptionID)
	if err != nil {
		return fmt.Errorf("flows: delete state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrStateNotFound
	}
	return nil
}

// CreateTransition adds an allowed edge to a flow, scoped to subscription.
func (s *Service) CreateTransition(ctx context.Context, subscriptionID, flowID string, in CreateTransitionInput) (*FlowTransition, error) {
	const q = `
		INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id)
		SELECT f.id, $3, $4
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  f.id = $1
		  AND  at.subscription_id = $2
		  AND  f.archived_at IS NULL
		  AND  at.archived_at IS NULL
		ON CONFLICT (flow_id, from_state_id, to_state_id) DO NOTHING
		RETURNING from_state_id, to_state_id`

	var tr FlowTransition
	err := s.vaPool.QueryRow(ctx, q, flowID, subscriptionID, in.FromStateID, in.ToStateID).Scan(&tr.From, &tr.To)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either conflict (already exists) or flow not found — check which.
		var exists bool
		_ = s.vaPool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM flow_transitions WHERE flow_id=$1 AND from_state_id=$2 AND to_state_id=$3)`,
			flowID, in.FromStateID, in.ToStateID).Scan(&exists)
		if exists {
			return nil, ErrTransitionExists
		}
		return nil, ErrFlowNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: create transition: %w", err)
	}
	return &tr, nil
}

// DeleteTransition removes an allowed edge from a flow, scoped to subscription.
func (s *Service) DeleteTransition(ctx context.Context, subscriptionID, flowID string, in DeleteTransitionInput) error {
	const q = `
		DELETE FROM flow_transitions ft
		USING  flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  ft.flow_id      = f.id
		  AND  f.id            = $1
		  AND  at.subscription_id = $2
		  AND  ft.from_state_id   = $3
		  AND  ft.to_state_id     = $4`

	tag, err := s.vaPool.Exec(ctx, q, flowID, subscriptionID, in.FromStateID, in.ToStateID)
	if err != nil {
		return fmt.Errorf("flows: delete transition: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTransitionNotFound
	}
	return nil
}
