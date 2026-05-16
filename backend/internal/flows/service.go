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
	ErrExitRuleNotFound   = errors.New("flow state exit rule not found")
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
	rows, err := s.vaPool.Query(ctx, sqlListFlowsByScope, subscriptionID, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groupIdx := make(map[string]int)
	groups := []FlowGroup{}
	stateIDs := []string{}

	for rows.Next() {
		var (
			flowID, flowName, typeID, typeName, typeScope string
			isDefault                                     bool
			st                                            FlowState
		)
		if err := rows.Scan(
			&flowID, &flowName, &isDefault, &typeID, &typeName, &typeScope,
			&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour, &st.Description,
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
		stateIDs = append(stateIDs, st.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Hydrate exit rules across every state in one query.
	if len(stateIDs) > 0 {
		if err := s.hydrateExitRules(ctx, groups, stateIDs); err != nil {
			return nil, err
		}
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

// hydrateExitRules attaches active exit rules to every state in groups in a
// single query. Each state's ExitRules slice is sorted by sort_order ASC, and
// ExitRuleCount mirrors len(ExitRules).
func (s *Service) hydrateExitRules(ctx context.Context, groups []FlowGroup, stateIDs []string) error {
	rows, err := s.vaPool.Query(ctx, sqlListExitRulesForStates, stateIDs)
	if err != nil {
		return fmt.Errorf("flows: hydrate exit rules: %w", err)
	}
	defer rows.Close()

	rulesByState := make(map[string][]FlowExitRule)
	for rows.Next() {
		var (
			stateID string
			r       FlowExitRule
		)
		if err := rows.Scan(&r.ID, &stateID, &r.SortOrder, &r.Name, &r.Colour); err != nil {
			return err
		}
		rulesByState[stateID] = append(rulesByState[stateID], r)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for gi := range groups {
		for si := range groups[gi].States {
			st := &groups[gi].States[si]
			if rs, ok := rulesByState[st.ID]; ok {
				st.ExitRules = rs
				st.ExitRuleCount = len(rs)
			}
		}
	}
	return nil
}

func (s *Service) loadTransitions(
	ctx context.Context,
	groups []FlowGroup,
	groupIdx map[string]int,
	flowIDs []string,
) error {
	rows, err := s.vaPool.Query(ctx, sqlListTransitionsForFlows, flowIDs)
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

	// Description handling: nil = no change; pointer to "" = clear to NULL;
	// pointer to non-empty = set. Encoded as ($9 is_set_flag, $10 value).
	var descSet bool
	var descVal *string
	if in.Description != nil {
		descSet = true
		v := *in.Description
		if v == "" {
			descVal = nil
		} else {
			descVal = &v
		}
	}

	// Colour is the only nullable-to-clear field via legacy convention; the
	// others use COALESCE. Pass nil colour as a signal to keep current colour;
	// for other fields nil = no change.
	var st FlowState
	err := s.vaPool.QueryRow(ctx, sqlPatchFlowState,
		in.Colour, stateID, subscriptionID, in.Name, in.SortOrder, in.IsInitial, in.Kind, in.IsPullable,
		descSet, descVal,
	).Scan(
		&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour, &st.Description,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: patch state: %w", err)
	}
	return &st, nil
}

// ListExitRules returns the active exit rules for a flow state, ordered by
// sort_order. Returns ErrStateNotFound if the state doesn't exist or isn't
// reachable from the caller's subscription.
func (s *Service) ListExitRules(ctx context.Context, subscriptionID, stateID string) ([]FlowExitRule, error) {
	// Tenancy gate: confirm the state belongs to this subscription.
	var exists bool
	err := s.vaPool.QueryRow(ctx, sqlExistsFlowStateInTenant, stateID, subscriptionID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("flows: list exit rules: tenancy check: %w", err)
	}
	if !exists {
		return nil, ErrStateNotFound
	}

	rows, err := s.vaPool.Query(ctx, sqlListExitRulesForState, stateID)
	if err != nil {
		return nil, fmt.Errorf("flows: list exit rules: %w", err)
	}
	defer rows.Close()

	out := []FlowExitRule{}
	for rows.Next() {
		var r FlowExitRule
		if err := rows.Scan(&r.ID, &r.SortOrder, &r.Name, &r.Colour); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateExitRule appends a new exit rule to a flow state at max(sort_order)+10.
func (s *Service) CreateExitRule(ctx context.Context, subscriptionID, stateID string, in CreateExitRuleInput) (*FlowExitRule, error) {
	if in.Name == "" {
		return nil, fmt.Errorf("flows: exit rule name is required")
	}
	if in.Colour != nil && *in.Colour != "" && !reColour.MatchString(*in.Colour) {
		return nil, fmt.Errorf("flows: colour must be #RRGGBB or null")
	}

	// Tenancy gate + compute next sort_order in one round-trip-safe block.
	var r FlowExitRule
	err := s.vaPool.QueryRow(ctx, sqlInsertExitRuleAppend, stateID, subscriptionID, in.Name, in.Colour).Scan(
		&r.ID, &r.SortOrder, &r.Name, &r.Colour,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStateNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: create exit rule: %w", err)
	}
	return &r, nil
}

// PatchExitRule updates mutable fields on one exit rule, scoped to subscription.
// For Colour: nil = no change; "" = clear to NULL; otherwise must match #RRGGBB.
func (s *Service) PatchExitRule(ctx context.Context, subscriptionID, ruleID string, in PatchExitRuleInput) (*FlowExitRule, error) {
	if in.Name != nil && *in.Name == "" {
		return nil, fmt.Errorf("flows: exit rule name must not be empty")
	}

	var colourSet bool
	var colourVal *string
	if in.Colour != nil {
		colourSet = true
		v := *in.Colour
		if v == "" {
			colourVal = nil
		} else {
			if !reColour.MatchString(v) {
				return nil, fmt.Errorf("flows: colour must be #RRGGBB, empty, or null")
			}
			colourVal = &v
		}
	}

	var out FlowExitRule
	err := s.vaPool.QueryRow(ctx, sqlPatchExitRule, in.Name, in.SortOrder, colourSet, colourVal, ruleID, subscriptionID).Scan(
		&out.ID, &out.SortOrder, &out.Name, &out.Colour,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrExitRuleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("flows: patch exit rule: %w", err)
	}
	return &out, nil
}

// DeleteExitRule soft-archives one exit rule, scoped to subscription.
func (s *Service) DeleteExitRule(ctx context.Context, subscriptionID, ruleID string) error {
	tag, err := s.vaPool.Exec(ctx, sqlArchiveExitRule, ruleID, subscriptionID)
	if err != nil {
		return fmt.Errorf("flows: delete exit rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrExitRuleNotFound
	}
	return nil
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
		_ = s.vaPool.QueryRow(ctx, sqlSelectMaxFlowStateSortOrder, flowID).Scan(&max)
		in.SortOrder = max + 10
	}

	var st FlowState
	err := s.vaPool.QueryRow(ctx, sqlInsertFlowState, flowID, subscriptionID, in.Name, in.Kind, in.SortOrder, in.IsInitial, in.IsPullable).Scan(
		&st.ID, &st.Name, &st.Kind, &st.SortOrder, &st.IsInitial, &st.IsPullable, &st.Colour, &st.Description,
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
	tag, err := s.vaPool.Exec(ctx, sqlArchiveFlowState, stateID, subscriptionID)
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
	var tr FlowTransition
	err := s.vaPool.QueryRow(ctx, sqlInsertTransition, flowID, subscriptionID, in.FromStateID, in.ToStateID).Scan(&tr.From, &tr.To)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either conflict (already exists) or flow not found — check which.
		var exists bool
		_ = s.vaPool.QueryRow(ctx, sqlExistsTransition,
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
	tag, err := s.vaPool.Exec(ctx, sqlDeleteTransition, flowID, subscriptionID, in.FromStateID, in.ToStateID)
	if err != nil {
		return fmt.Errorf("flows: delete transition: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTransitionNotFound
	}
	return nil
}
