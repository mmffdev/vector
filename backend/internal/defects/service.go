// Package defects owns the defect artefact — CRUD against the defects
// table with subscription-scoped tenant isolation.
// key_num is allocated from subscription_sequence(scope='DF') atomically
// inside the create transaction.
package defects

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound        = errors.New("defect not found")
	ErrInvalidSeverity = errors.New("severity must be low, medium, high, or critical")
)

var validSeverities = map[string]bool{
	"low": true, "medium": true, "high": true, "critical": true,
}

// Defect is the wire-safe view of a defects row.
type Defect struct {
	ID             string  `json:"id"`
	SubscriptionID string  `json:"subscription_id"`
	KeyNum         int64   `json:"key_num"`
	TypeID         string  `json:"type_id"`
	HierarchyParent *string `json:"hierarchy_parent,omitempty"`
	LinkedStory     *string `json:"linked_story,omitempty"`

	Name               string  `json:"name"`
	Description        *string `json:"description,omitempty"`
	AcceptanceCriteria *string `json:"acceptance_criteria,omitempty"`
	Notes              *string `json:"notes,omitempty"`

	Severity          string  `json:"severity"`
	StepsToReproduce  *string `json:"steps_to_reproduce,omitempty"`
	Environment       *string `json:"environment,omitempty"`
	Browser           *string `json:"browser,omitempty"`
	Regression        bool    `json:"regression"`

	NameAuthor string  `json:"name_author"`
	NameOwner  *string `json:"name_owner,omitempty"`

	ScheduleState string  `json:"schedule_state"`
	Blocked       bool    `json:"blocked"`
	BlockedReason *string `json:"blocked_reason,omitempty"`
	Ready         bool    `json:"ready"`
	Expedite      bool    `json:"expedite"`

	Sprint  *string `json:"sprint,omitempty"`
	Release *string `json:"release,omitempty"`

	EstimateHours     *float64 `json:"estimate_hours,omitempty"`
	EstimateRemaining *float64 `json:"estimate_remaining,omitempty"`
	Rank              string   `json:"rank"`

	RiskScore  *float64 `json:"risk_score,omitempty"`
	RiskImpact *string  `json:"risk_impact,omitempty"`

	LidentifierColour *string `json:"lidentifier_colour,omitempty"`
	LidentifierType   *string `json:"lidentifier_type,omitempty"`

	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

// CreateInput holds the fields required to create a defect.
type CreateInput struct {
	TypeID           string
	Name             string
	Severity         string
	Description      *string
	LinkedStory      *string
	StepsToReproduce *string
	Environment      *string
	Browser          *string
	NameOwner        *string
}

// PatchInput holds the optional fields that can be updated.
type PatchInput struct {
	Name               *string
	Description        *string
	AcceptanceCriteria *string
	Notes              *string
	Severity           *string
	StepsToReproduce   *string
	Environment        *string
	Browser            *string
	Regression         *bool
	NameOwner          *string
	LinkedStory        *string
	ScheduleState      *string
	Blocked            *bool
	BlockedReason      *string
	Ready              *bool
	Expedite           *bool
	Sprint             *string
	Release            *string
	EstimateHours      *float64
	EstimateRemaining  *float64
	Rank               *string
	RiskScore          *float64
	RiskImpact         *string
	LidentifierColour  *string
	LidentifierType    *string
}

// Service is the business layer for defects.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

const sequenceScope = "DF"

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

// Create inserts a new defect and returns the created row.
func (s *Service) Create(ctx context.Context, subscriptionID, authorID uuid.UUID, in CreateInput) (*Defect, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, errors.New("name cannot be empty")
	}
	if !validSeverities[in.Severity] {
		return nil, ErrInvalidSeverity
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
	var linkedStory *uuid.UUID
	if in.LinkedStory != nil {
		id, err := uuid.Parse(*in.LinkedStory)
		if err != nil {
			return nil, errors.New("invalid linked_story")
		}
		linkedStory = &id
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
		INSERT INTO defects (
			id, subscription_id, key_num, type_id,
			linked_story,
			name, description, severity,
			steps_to_reproduce, environment, browser,
			name_author, name_owner
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::defect_severity,$9,$10,$11,$12,$13)`,
		id, subscriptionID, keyNum, typeID,
		linkedStory,
		name, in.Description, in.Severity,
		in.StepsToReproduce, in.Environment, in.Browser,
		authorID, ownerID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.Get(ctx, subscriptionID, id)
}

// Get returns a single defect belonging to the subscription.
// Returns ErrNotFound for missing or cross-tenant rows.
func (s *Service) Get(ctx context.Context, subscriptionID, id uuid.UUID) (*Defect, error) {
	var d Defect
	var rawID, subID, typeID, authorID uuid.UUID
	var ownerID, hierarchyParent, linkedStory, sprint, release *uuid.UUID
	var severity string
	err := s.Pool.QueryRow(ctx, `
		SELECT
			id, subscription_id, key_num, type_id,
			hierarchy_parent, linked_story,
			name, description, acceptance_criteria, notes,
			severity::text,
			steps_to_reproduce, environment, browser, regression,
			name_author, name_owner,
			schedule_state,
			blocked, blocked_reason, ready, expedite,
			sprint, release,
			estimate_hours, estimate_remaining, rank,
			risk_score, risk_impact,
			lidentifier_colour, lidentifier_type,
			created_at, updated_at, archived_at
		FROM defects
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	).Scan(
		&rawID, &subID, &d.KeyNum, &typeID,
		&hierarchyParent, &linkedStory,
		&d.Name, &d.Description, &d.AcceptanceCriteria, &d.Notes,
		&severity,
		&d.StepsToReproduce, &d.Environment, &d.Browser, &d.Regression,
		&authorID, &ownerID,
		&d.ScheduleState,
		&d.Blocked, &d.BlockedReason, &d.Ready, &d.Expedite,
		&sprint, &release,
		&d.EstimateHours, &d.EstimateRemaining, &d.Rank,
		&d.RiskScore, &d.RiskImpact,
		&d.LidentifierColour, &d.LidentifierType,
		&d.CreatedAt, &d.UpdatedAt, &d.ArchivedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.ID = rawID.String()
	d.SubscriptionID = subID.String()
	d.TypeID = typeID.String()
	d.NameAuthor = authorID.String()
	d.Severity = severity
	if ownerID != nil {
		s := ownerID.String(); d.NameOwner = &s
	}
	if hierarchyParent != nil {
		s := hierarchyParent.String(); d.HierarchyParent = &s
	}
	if linkedStory != nil {
		s := linkedStory.String(); d.LinkedStory = &s
	}
	if sprint != nil {
		s := sprint.String(); d.Sprint = &s
	}
	if release != nil {
		s := release.String(); d.Release = &s
	}
	return &d, nil
}

// Patch applies non-nil fields. Returns ErrNotFound or ErrInvalidSeverity.
func (s *Service) Patch(ctx context.Context, subscriptionID, id uuid.UUID, in PatchInput) (*Defect, error) {
	if in.Severity != nil && !validSeverities[*in.Severity] {
		return nil, ErrInvalidSeverity
	}
	tag, err := s.Pool.Exec(ctx, `
		UPDATE defects SET
			name                = COALESCE($3,  name),
			description         = COALESCE($4,  description),
			acceptance_criteria = COALESCE($5,  acceptance_criteria),
			notes               = COALESCE($6,  notes),
			severity            = COALESCE($7::defect_severity, severity),
			steps_to_reproduce  = COALESCE($8,  steps_to_reproduce),
			environment         = COALESCE($9,  environment),
			browser             = COALESCE($10, browser),
			regression          = COALESCE($11, regression),
			name_owner          = COALESCE($12::uuid, name_owner),
			linked_story        = COALESCE($13::uuid, linked_story),
			schedule_state      = COALESCE($14, schedule_state),
			blocked             = COALESCE($15, blocked),
			blocked_reason      = COALESCE($16, blocked_reason),
			ready               = COALESCE($17, ready),
			expedite            = COALESCE($18, expedite),
			sprint              = COALESCE($19::uuid, sprint),
			release             = COALESCE($20::uuid, release),
			estimate_hours      = COALESCE($21, estimate_hours),
			estimate_remaining  = COALESCE($22, estimate_remaining),
			rank                = COALESCE($23, rank),
			risk_score          = COALESCE($24, risk_score),
			risk_impact         = COALESCE($25, risk_impact),
			lidentifier_colour  = COALESCE($26, lidentifier_colour),
			lidentifier_type    = COALESCE($27, lidentifier_type)
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
		in.Name, in.Description, in.AcceptanceCriteria, in.Notes,
		in.Severity,
		in.StepsToReproduce, in.Environment, in.Browser, in.Regression,
		in.NameOwner, in.LinkedStory,
		in.ScheduleState,
		in.Blocked, in.BlockedReason,
		in.Ready, in.Expedite,
		in.Sprint, in.Release,
		in.EstimateHours, in.EstimateRemaining, in.Rank,
		in.RiskScore, in.RiskImpact,
		in.LidentifierColour, in.LidentifierType,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, subscriptionID, id)
}

// Archive soft-deletes by setting archived_at = NOW().
func (s *Service) Archive(ctx context.Context, subscriptionID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE defects
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
