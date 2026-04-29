// Package userstories owns the user story artefact — CRUD against the
// user_stories table with subscription-scoped tenant isolation.
// key_num is allocated from subscription_sequence(scope='US') atomically
// inside the create transaction.
package userstories

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("user story not found")

// UserStory is the wire-safe view of a user_stories row.
type UserStory struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	KeyNum         int64      `json:"key_num"`
	TypeID         string     `json:"type_id"`
	HierarchyParent *string   `json:"hierarchy_parent,omitempty"`

	Name               string  `json:"name"`
	Description        *string `json:"description,omitempty"`
	AcceptanceCriteria *string `json:"acceptance_criteria,omitempty"`
	Notes              *string `json:"notes,omitempty"`

	NameAuthor string  `json:"name_author"`
	NameOwner  *string `json:"name_owner,omitempty"`

	ScheduleState string  `json:"schedule_state"`
	Blocked       bool    `json:"blocked"`
	BlockedReason *string `json:"blocked_reason,omitempty"`
	Ready         bool    `json:"ready"`
	Expedite      bool    `json:"expedite"`
	AffectsDoc    bool    `json:"affects_doc"`

	Sprint  *string `json:"sprint,omitempty"`
	Release *string `json:"release,omitempty"`

	EstimatePoints    *float64 `json:"estimate_points,omitempty"`
	EstimateHours     *float64 `json:"estimate_hours,omitempty"`
	EstimateRemaining *float64 `json:"estimate_remaining,omitempty"`
	Rank              string   `json:"rank"`

	RiskScore       *float64 `json:"risk_score,omitempty"`
	RiskImpact      *string  `json:"risk_impact,omitempty"`
	RiskProbability *string  `json:"risk_probability,omitempty"`

	LidentifierColour *string `json:"lidentifier_colour,omitempty"`
	LidentifierType   *string `json:"lidentifier_type,omitempty"`

	CountChildTasks     int `json:"count_child_tasks"`
	CountChildDefects   int `json:"count_child_defects"`
	CountChildTestCases int `json:"count_child_test_cases"`

	TestCaseStatus *string `json:"test_case_status,omitempty"`
	DefectStatus   *string `json:"defect_status,omitempty"`

	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
}

// CreateInput holds the fields required to create a user story.
type CreateInput struct {
	TypeID      string
	Name        string
	Description *string
	NameOwner   *string
}

// PatchInput holds the optional fields that can be updated. A nil
// pointer means "leave unchanged".
type PatchInput struct {
	Name               *string
	Description        *string
	AcceptanceCriteria *string
	Notes              *string
	NameOwner          *string
	ScheduleState      *string
	Blocked            *bool
	BlockedReason      *string
	Ready              *bool
	Expedite           *bool
	AffectsDoc         *bool
	Sprint             *string
	Release            *string
	EstimatePoints     *float64
	EstimateHours      *float64
	EstimateRemaining  *float64
	Rank               *string
	RiskScore          *float64
	RiskImpact         *string
	RiskProbability    *string
	LidentifierColour  *string
	LidentifierType    *string
}

// Service is the business layer for user stories.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

const sequenceScope = "US"

// nextKeyNum acquires the next key_num for the subscription inside the
// given transaction using a SELECT … FOR UPDATE lock to prevent races.
// If no sequence row exists yet it is seeded at 1.
func nextKeyNum(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID) (int64, error) {
	var num int64
	err := tx.QueryRow(ctx, `
		SELECT next_num FROM subscription_sequence
		WHERE subscription_id = $1 AND scope = $2
		FOR UPDATE`, subscriptionID, sequenceScope).Scan(&num)
	if errors.Is(err, pgx.ErrNoRows) {
		// First user story for this subscription — seed the sequence.
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

// Create inserts a new user story and returns the created row.
func (s *Service) Create(ctx context.Context, subscriptionID, authorID uuid.UUID, in CreateInput) (*UserStory, error) {
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
		INSERT INTO user_stories (
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

// Get returns a single user story belonging to the subscription.
// Returns ErrNotFound for missing or cross-tenant rows.
func (s *Service) Get(ctx context.Context, subscriptionID, id uuid.UUID) (*UserStory, error) {
	var us UserStory
	var rawID, subID, typeID, authorID uuid.UUID
	var ownerID, hierarchyParent, sprint, release *uuid.UUID
	err := s.Pool.QueryRow(ctx, `
		SELECT
			id, subscription_id, key_num, type_id,
			hierarchy_parent,
			name, description, acceptance_criteria, notes,
			name_author, name_owner,
			schedule_state,
			blocked, blocked_reason, ready, expedite, affects_doc,
			sprint, release,
			estimate_points, estimate_hours, estimate_remaining, rank,
			risk_score, risk_impact, risk_probability,
			lidentifier_colour, lidentifier_type,
			count_child_tasks, count_child_defects, count_child_test_cases,
			test_case_status, defect_status,
			created_at, updated_at, archived_at
		FROM user_stories
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	).Scan(
		&rawID, &subID, &us.KeyNum, &typeID,
		&hierarchyParent,
		&us.Name, &us.Description, &us.AcceptanceCriteria, &us.Notes,
		&authorID, &ownerID,
		&us.ScheduleState,
		&us.Blocked, &us.BlockedReason, &us.Ready, &us.Expedite, &us.AffectsDoc,
		&sprint, &release,
		&us.EstimatePoints, &us.EstimateHours, &us.EstimateRemaining, &us.Rank,
		&us.RiskScore, &us.RiskImpact, &us.RiskProbability,
		&us.LidentifierColour, &us.LidentifierType,
		&us.CountChildTasks, &us.CountChildDefects, &us.CountChildTestCases,
		&us.TestCaseStatus, &us.DefectStatus,
		&us.CreatedAt, &us.UpdatedAt, &us.ArchivedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	us.ID = rawID.String()
	us.SubscriptionID = subID.String()
	us.TypeID = typeID.String()
	us.NameAuthor = authorID.String()
	if ownerID != nil {
		s := ownerID.String(); us.NameOwner = &s
	}
	if hierarchyParent != nil {
		s := hierarchyParent.String(); us.HierarchyParent = &s
	}
	if sprint != nil {
		s := sprint.String(); us.Sprint = &s
	}
	if release != nil {
		s := release.String(); us.Release = &s
	}
	return &us, nil
}

// Patch applies non-nil fields to the story. Returns ErrNotFound if the
// story doesn't exist or belongs to another subscription.
func (s *Service) Patch(ctx context.Context, subscriptionID, id uuid.UUID, in PatchInput) (*UserStory, error) {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE user_stories SET
			name                 = COALESCE($3,  name),
			description          = COALESCE($4,  description),
			acceptance_criteria  = COALESCE($5,  acceptance_criteria),
			notes                = COALESCE($6,  notes),
			name_owner           = COALESCE($7::uuid, name_owner),
			schedule_state       = COALESCE($8,  schedule_state),
			blocked              = COALESCE($9,  blocked),
			blocked_reason       = COALESCE($10, blocked_reason),
			ready                = COALESCE($11, ready),
			expedite             = COALESCE($12, expedite),
			affects_doc          = COALESCE($13, affects_doc),
			sprint               = COALESCE($14::uuid, sprint),
			release              = COALESCE($15::uuid, release),
			estimate_points      = COALESCE($16, estimate_points),
			estimate_hours       = COALESCE($17, estimate_hours),
			estimate_remaining   = COALESCE($18, estimate_remaining),
			rank                 = COALESCE($19, rank),
			risk_score           = COALESCE($20, risk_score),
			risk_impact          = COALESCE($21, risk_impact),
			risk_probability     = COALESCE($22, risk_probability),
			lidentifier_colour   = COALESCE($23, lidentifier_colour),
			lidentifier_type     = COALESCE($24, lidentifier_type)
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
		in.Name, in.Description, in.AcceptanceCriteria, in.Notes,
		in.NameOwner,
		in.ScheduleState,
		in.Blocked, in.BlockedReason,
		in.Ready, in.Expedite, in.AffectsDoc,
		in.Sprint, in.Release,
		in.EstimatePoints, in.EstimateHours, in.EstimateRemaining, in.Rank,
		in.RiskScore, in.RiskImpact, in.RiskProbability,
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

// Archive soft-deletes by setting archived_at = NOW(). Returns ErrNotFound
// if the story is already archived or belongs to another subscription.
func (s *Service) Archive(ctx context.Context, subscriptionID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE user_stories
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
