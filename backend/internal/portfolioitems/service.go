// Package portfolioitems owns the portfolio item artefact — CRUD against the
// portfolio_items table with subscription-scoped tenant isolation.
// key_num is allocated from subscription_sequence(scope='POR') atomically
// inside the create transaction.
package portfolioitems

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("portfolio item not found")

// PortfolioItem is the wire-safe view of a portfolio_items row.
type PortfolioItem struct {
	ID             string  `json:"id"`
	SubscriptionID string  `json:"subscription_id"`
	KeyNum         int64   `json:"key_num"`
	TypeID         string  `json:"type_id"`
	HierarchyParent *string `json:"hierarchy_parent,omitempty"`

	Name               string  `json:"name"`
	Description        *string `json:"description,omitempty"`
	AcceptanceCriteria *string `json:"acceptance_criteria,omitempty"`
	Notes              *string `json:"notes,omitempty"`

	NameAuthor string  `json:"name_author"`
	NameOwner  string  `json:"name_owner"`

	FlowState              *string `json:"flow_state,omitempty"`
	FlowStateChangeUpdateDate *time.Time `json:"flow_state_change_update_date,omitempty"`
	FlowStateChangeOwner   *string `json:"flow_state_change_owner,omitempty"`
	Blocked                bool    `json:"blocked"`
	BlockedReason          *string `json:"blocked_reason,omitempty"`

	DateWorkPlannedStart *time.Time `json:"date_work_planned_start,omitempty"`
	DateWorkPlannedFinish *time.Time `json:"date_work_planned_finish,omitempty"`
	DateWorkStarted      *time.Time `json:"date_work_started,omitempty"`
	DateWorkAccepted     *time.Time `json:"date_work_accepted,omitempty"`

	EstimateInitial *string  `json:"estimate_initial,omitempty"`
	EstimateUpdated *float64 `json:"estimate_updated,omitempty"`

	RiskImpact      *string  `json:"risk_impact,omitempty"`
	RiskProbability *string  `json:"risk_probability,omitempty"`
	RiskScore       *float64 `json:"risk_score,omitempty"`

	StrategicInvestmentGroup  *string `json:"strategic_investment_group,omitempty"`
	StrategicInvestmentWeight *string `json:"strategic_investment_weight,omitempty"`
	StrategicItemType         *string `json:"strategic_item_type,omitempty"`
	ValueStreamIdentifier     *string `json:"value_stream_identifier,omitempty"`

	LidentifierColour *string   `json:"lidentifier_colour,omitempty"`
	LidentifierLabels []string  `json:"lidentifier_labels,omitempty"`
	LidentifierTags   []string  `json:"lidentifier_tags,omitempty"`

	CountChildDefects     *int     `json:"count_child_defects,omitempty"`
	CountChildUserStories *int     `json:"count_child_user_stories,omitempty"`
	CountDependants       *int     `json:"count_dependants,omitempty"`
	CountRollupDefect     *int     `json:"count_rollup_defect,omitempty"`
	CountRollupDefects    *int     `json:"count_rollup_defects,omitempty"`
	CountRollupEstimation *float64 `json:"count_rollup_estimation,omitempty"`
	CountRollupRisks      *int     `json:"count_rollup_risks,omitempty"`
	DoneByStoryCount      *float64 `json:"done_by_story_count,omitempty"`

	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

type CreateInput struct {
	TypeID      string
	Name        string
	Description *string
	NameOwner   *string
}

type PatchInput struct {
	Name                      *string
	Description               *string
	AcceptanceCriteria        *string
	Notes                     *string
	NameOwner                 *string
	FlowState                 *string
	FlowStateChangeUpdateDate *time.Time
	FlowStateChangeOwner      *string
	Blocked                   *bool
	BlockedReason             *string
	DateWorkPlannedStart      *time.Time
	DateWorkPlannedFinish     *time.Time
	DateWorkStarted           *time.Time
	DateWorkAccepted          *time.Time
	EstimateInitial           *string
	EstimateUpdated           *float64
	RiskImpact                *string
	RiskProbability           *string
	RiskScore                 *float64
	StrategicInvestmentGroup  *string
	StrategicInvestmentWeight *string
	StrategicItemType         *string
	ValueStreamIdentifier     *string
	LidentifierColour         *string
	LidentifierLabels         []string
	LidentifierTags           []string
}

type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

const sequenceScope = "POR"

func nextKeyNum(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID) (int64, error) {
	var num int64
	err := tx.QueryRow(ctx, `
		SELECT next_num FROM subscription_sequence
		WHERE subscription_id = $1 AND scope = $2
		FOR UPDATE`, subscriptionID, sequenceScope).Scan(&num)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			INSERT INTO subscription_sequence (subscription_id, scope, next_num)
			VALUES ($1, $2, 2)`, subscriptionID, sequenceScope)
		if err != nil {
			return 0, err
		}
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE subscription_sequence
		SET next_num = next_num + 1
		WHERE subscription_id = $1 AND scope = $2`, subscriptionID, sequenceScope)
	return num, err
}

func (s *Service) Create(ctx context.Context, subscriptionID, authorID uuid.UUID, in CreateInput) (*PortfolioItem, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, errors.New("name cannot be empty")
	}
	typeID, err := uuid.Parse(in.TypeID)
	if err != nil {
		return nil, errors.New("invalid type_id")
	}
	var ownerID *uuid.UUID
	if in.NameOwner != nil {
		id, err := uuid.Parse(*in.NameOwner)
		if err != nil {
			return nil, errors.New("invalid name_owner")
		}
		ownerID = &id
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	keyNum, err := nextKeyNum(ctx, tx, subscriptionID)
	if err != nil {
		return nil, err
	}

	id := uuid.New()
	_, err = tx.Exec(ctx, `
		INSERT INTO portfolio_items (
			id, subscription_id, key_num, type_id,
			name, description,
			name_author, name_owner
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, subscriptionID, keyNum, typeID,
		name, in.Description,
		authorID, ownerID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.Get(ctx, subscriptionID, id)
}

func (s *Service) Get(ctx context.Context, subscriptionID, id uuid.UUID) (*PortfolioItem, error) {
	var p PortfolioItem
	var rawID, subID, typeID, authorID uuid.UUID
	var ownerID, hierarchyParent, flowState, flowStateChangeOwner *uuid.UUID
	var flowStateChangeUpdateDate *time.Time

	err := s.Pool.QueryRow(ctx, `
		SELECT
			id, subscription_id, key_num, type_id,
			hierarchy_parent, flow_state,
			flow_state_change_update_date, flow_state_change_owner,
			name, description, acceptance_criteria, notes,
			name_author, name_owner,
			blocked, blocked_reason,
			date_work_planned_start, date_work_planned_finish, date_work_started, date_work_accepted,
			estimate_initial, estimate_updated,
			risk_impact, risk_probability, risk_score,
			strategic_investment_group, strategic_investment_weight, strategic_item_type, value_stream_identifier,
			lidentifier_colour, lidentifier_labels, lidentifier_tags,
			count_child_defects, count_child_user_stories, count_dependants,
			count_rollup_defect, count_rollup_defects, count_rollup_estimation, count_rollup_risks, done_by_story_count,
			created_at, updated_at, archived_at
		FROM portfolio_items
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	).Scan(
		&rawID, &subID, &p.KeyNum, &typeID,
		&hierarchyParent, &flowState,
		&flowStateChangeUpdateDate, &flowStateChangeOwner,
		&p.Name, &p.Description, &p.AcceptanceCriteria, &p.Notes,
		&authorID, &ownerID,
		&p.Blocked, &p.BlockedReason,
		&p.DateWorkPlannedStart, &p.DateWorkPlannedFinish, &p.DateWorkStarted, &p.DateWorkAccepted,
		&p.EstimateInitial, &p.EstimateUpdated,
		&p.RiskImpact, &p.RiskProbability, &p.RiskScore,
		&p.StrategicInvestmentGroup, &p.StrategicInvestmentWeight, &p.StrategicItemType, &p.ValueStreamIdentifier,
		&p.LidentifierColour, &p.LidentifierLabels, &p.LidentifierTags,
		&p.CountChildDefects, &p.CountChildUserStories, &p.CountDependants,
		&p.CountRollupDefect, &p.CountRollupDefects, &p.CountRollupEstimation, &p.CountRollupRisks, &p.DoneByStoryCount,
		&p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.ID = rawID.String()
	p.SubscriptionID = subID.String()
	p.TypeID = typeID.String()
	p.NameAuthor = authorID.String()
	if ownerID != nil {
		p.NameOwner = ownerID.String()
	}
	if hierarchyParent != nil {
		s := hierarchyParent.String()
		p.HierarchyParent = &s
	}
	if flowState != nil {
		s := flowState.String()
		p.FlowState = &s
	}
	if flowStateChangeUpdateDate != nil {
		p.FlowStateChangeUpdateDate = flowStateChangeUpdateDate
	}
	if flowStateChangeOwner != nil {
		s := flowStateChangeOwner.String()
		p.FlowStateChangeOwner = &s
	}
	return &p, nil
}

func (s *Service) Patch(ctx context.Context, subscriptionID, id uuid.UUID, in PatchInput) (*PortfolioItem, error) {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE portfolio_items SET
			name                          = COALESCE($3,  name),
			description                   = COALESCE($4,  description),
			acceptance_criteria           = COALESCE($5,  acceptance_criteria),
			notes                         = COALESCE($6,  notes),
			name_owner                    = COALESCE($7::uuid, name_owner),
			flow_state                    = CASE WHEN $8::uuid IS NOT NULL THEN $8::uuid ELSE flow_state END,
			flow_state_change_update_date = CASE WHEN $9::timestamptz IS NOT NULL THEN $9 ELSE flow_state_change_update_date END,
			flow_state_change_owner       = COALESCE($10::uuid, flow_state_change_owner),
			blocked                       = COALESCE($11, blocked),
			blocked_reason                = COALESCE($12, blocked_reason),
			date_work_planned_start       = CASE WHEN $13::date IS NOT NULL THEN $13 ELSE date_work_planned_start END,
			date_work_planned_finish      = CASE WHEN $14::date IS NOT NULL THEN $14 ELSE date_work_planned_finish END,
			date_work_started             = CASE WHEN $15::timestamptz IS NOT NULL THEN $15 ELSE date_work_started END,
			date_work_accepted            = CASE WHEN $16::timestamptz IS NOT NULL THEN $16 ELSE date_work_accepted END,
			estimate_initial              = COALESCE($17, estimate_initial),
			estimate_updated              = COALESCE($18, estimate_updated),
			risk_impact                   = COALESCE($19, risk_impact),
			risk_probability              = COALESCE($20, risk_probability),
			risk_score                    = COALESCE($21, risk_score),
			strategic_investment_group    = COALESCE($22, strategic_investment_group),
			strategic_investment_weight   = COALESCE($23, strategic_investment_weight),
			strategic_item_type           = COALESCE($24, strategic_item_type),
			value_stream_identifier       = COALESCE($25, value_stream_identifier),
			lidentifier_colour            = COALESCE($26, lidentifier_colour),
			lidentifier_labels            = CASE WHEN $27::text[] IS NOT NULL THEN $27 ELSE lidentifier_labels END,
			lidentifier_tags              = CASE WHEN $28::text[] IS NOT NULL THEN $28 ELSE lidentifier_tags END
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
		in.Name, in.Description, in.AcceptanceCriteria, in.Notes,
		in.NameOwner,
		in.FlowState, in.FlowStateChangeUpdateDate, in.FlowStateChangeOwner,
		in.Blocked, in.BlockedReason,
		in.DateWorkPlannedStart, in.DateWorkPlannedFinish, in.DateWorkStarted, in.DateWorkAccepted,
		in.EstimateInitial, in.EstimateUpdated,
		in.RiskImpact, in.RiskProbability, in.RiskScore,
		in.StrategicInvestmentGroup, in.StrategicInvestmentWeight, in.StrategicItemType, in.ValueStreamIdentifier,
		in.LidentifierColour, in.LidentifierLabels, in.LidentifierTags,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, subscriptionID, id)
}

func (s *Service) Archive(ctx context.Context, subscriptionID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE portfolio_items
		SET archived_at = NOW()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
