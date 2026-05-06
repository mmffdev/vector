package flows

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the sole writer to obj_flow_tenant. All queries are scoped by
// subscription_id at the SQL boundary — callers pass the caller's
// SubscriptionID and the service refuses to leak across tenants.
type Service struct {
	pool *pgxpool.Pool
}

// New returns a Service backed by the given pool.
func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ListBySubscription returns every flow row for the subscription, grouped by
// target (system / tenant / portfolio). Each group's states are ordered by
// flow_position. Archived rows are excluded.
//
// We do three small queries rather than one big polymorphic UNION because
// each target type joins to a different label table and the query plans
// stay obvious.
func (s *Service) ListBySubscription(ctx context.Context, subscriptionID string) (*ListResponse, error) {
	system, err := s.listSystem(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("flows: list system: %w", err)
	}
	tenant, err := s.listTenant(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("flows: list tenant: %w", err)
	}
	portfolio, err := s.listPortfolio(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("flows: list portfolio: %w", err)
	}
	return &ListResponse{System: system, Tenant: tenant, Portfolio: portfolio}, nil
}

func (s *Service) listSystem(ctx context.Context, subID string) ([]FlowGroup, error) {
	const q = `
		SELECT
		    f.id, f.subscription_id, f.flow_position, f.name, f.canonical_code, f.description,
		    f.system_artefact_type_id, f.tenant_artefact_type_id, f.portfolio_item_type_id,
		    f.created_at, f.updated_at,
		    t.id AS target_id, t.display_label_plural AS target_label
		FROM obj_flow_tenant f
		JOIN obj_execution_types t ON t.id = f.system_artefact_type_id
		WHERE f.subscription_id = $1
		  AND f.system_artefact_type_id IS NOT NULL
		  AND f.archived_at IS NULL
		ORDER BY t.display_label_plural, f.flow_position;`
	return s.scanGroups(ctx, q, subID, "system")
}

func (s *Service) listTenant(ctx context.Context, subID string) ([]FlowGroup, error) {
	const q = `
		SELECT
		    f.id, f.subscription_id, f.flow_position, f.name, f.canonical_code, f.description,
		    f.system_artefact_type_id, f.tenant_artefact_type_id, f.portfolio_item_type_id,
		    f.created_at, f.updated_at,
		    t.id AS target_id, t.display_label_plural AS target_label
		FROM obj_flow_tenant f
		JOIN obj_execution_types_tenant t ON t.id = f.tenant_artefact_type_id
		WHERE f.subscription_id = $1
		  AND f.tenant_artefact_type_id IS NOT NULL
		  AND f.archived_at IS NULL
		  AND t.archived_at IS NULL
		ORDER BY t.display_label_plural, f.flow_position;`
	return s.scanGroups(ctx, q, subID, "tenant")
}

func (s *Service) listPortfolio(ctx context.Context, subID string) ([]FlowGroup, error) {
	const q = `
		SELECT
		    f.id, f.subscription_id, f.flow_position, f.name, f.canonical_code, f.description,
		    f.system_artefact_type_id, f.tenant_artefact_type_id, f.portfolio_item_type_id,
		    f.created_at, f.updated_at,
		    p.id AS target_id, p.name AS target_label
		FROM obj_flow_tenant f
		JOIN obj_strategy_types p ON p.id = f.portfolio_item_type_id
		WHERE f.subscription_id = $1
		  AND f.portfolio_item_type_id IS NOT NULL
		  AND f.archived_at IS NULL
		  AND p.archived_at IS NULL
		ORDER BY p.name, f.flow_position;`
	return s.scanGroups(ctx, q, subID, "portfolio")
}

// scanGroups reads rows from any of the three list queries and bins them
// by target_id while preserving target order.
func (s *Service) scanGroups(ctx context.Context, query, subID, kind string) ([]FlowGroup, error) {
	rows, err := s.pool.Query(ctx, query, subID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groupIdx := make(map[string]int)
	groups := []FlowGroup{}

	for rows.Next() {
		var (
			st          FlowState
			targetID    string
			targetLabel string
		)
		if err := rows.Scan(
			&st.ID, &st.SubscriptionID, &st.Position, &st.Name, &st.CanonicalCode, &st.Description,
			&st.SystemTypeID, &st.TenantTypeID, &st.PortfolioTypeID,
			&st.CreatedAt, &st.UpdatedAt,
			&targetID, &targetLabel,
		); err != nil {
			return nil, err
		}
		idx, ok := groupIdx[targetID]
		if !ok {
			idx = len(groups)
			groupIdx[targetID] = idx
			groups = append(groups, FlowGroup{
				TargetKind:  kind,
				TargetID:    targetID,
				TargetLabel: targetLabel,
				States:      []FlowState{},
			})
		}
		groups[idx].States = append(groups[idx].States, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return groups, nil
}
