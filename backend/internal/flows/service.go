package flows

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
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
		ORDER BY at.name, fs.sort_order;`

	rows, err := s.vaPool.Query(ctx, q, subscriptionID, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groupIdx := make(map[string]int)
	groups := []FlowGroup{}

	for rows.Next() {
		var (
			flowID, typeID, typeName, typeScope string
			st                                  FlowState
		)
		if err := rows.Scan(
			&flowID, &typeID, &typeName, &typeScope,
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
	return groups, nil
}
