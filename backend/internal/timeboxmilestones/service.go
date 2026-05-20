// Package timeboxmilestones is the sole writer for the
// timeboxes_milestones table in vector_artefacts. Table + column names
// follow §2.3 / §2.4 (migration 085 + 087).
package timeboxmilestones

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns all DB operations for timeboxes_milestones.
type Service struct {
	pool *pgxpool.Pool
}

// NewService creates a Service backed by the given pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Create inserts a new milestone.
func (s *Service) Create(ctx context.Context, in CreateMilestoneInput) (*Milestone, error) {
	if err := validateCreateInput(in); err != nil {
		return nil, err
	}

	row := s.pool.QueryRow(ctx, sqlInsertMilestone,
		in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
		in.MilestoneName, in.MilestoneDescription, in.MilestoneOwner,
		in.MilestoneDateTarget, in.Position,
	)
	m, err := scanMilestone(row)
	if err != nil {
		return nil, fmt.Errorf("create milestone: %w", err)
	}
	return m, nil
}

// Get returns a single milestone by ID scoped to the workspace.
func (s *Service) Get(ctx context.Context, workspaceID, milestoneID string) (*Milestone, error) {
	row := s.pool.QueryRow(ctx, sqlSelectMilestoneByID, milestoneID, workspaceID)
	m, err := scanMilestone(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get milestone: %w", err)
	}
	return m, nil
}

// List returns non-archived milestones for a workspace, ordered by target
// date then position.
func (s *Service) List(ctx context.Context, workspaceID string, f ListFilters) ([]*Milestone, error) {
	args := []any{workspaceID}
	conds := []string{
		"timeboxes_milestones_id_workspace = $1",
		"timeboxes_milestones_archived_at IS NULL",
	}
	n := 2

	if f.OrgNodeID != nil {
		conds = append(conds, fmt.Sprintf("timeboxes_milestones_id_topology_node = $%d", n))
		args = append(args, *f.OrgNodeID)
		n++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("timeboxes_milestones_status = $%d", n))
		args = append(args, *f.Status)
		n++
	}

	q := fmt.Sprintf(sqlListMilestonesTemplate, strings.Join(conds, " AND "))
	_ = n

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list milestones: %w", err)
	}
	defer rows.Close()

	var milestones []*Milestone
	for rows.Next() {
		m, err := scanMilestone(rows)
		if err != nil {
			return nil, fmt.Errorf("scan milestone row: %w", err)
		}
		milestones = append(milestones, m)
	}
	if milestones == nil {
		milestones = []*Milestone{}
	}
	return milestones, rows.Err()
}

// Update applies partial updates to a milestone.
func (s *Service) Update(ctx context.Context, workspaceID, milestoneID string, in UpdateMilestoneInput) (*Milestone, error) {
	sets := []string{}
	args := []any{}
	n := 1

	addField := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}

	if in.MilestoneName != nil {
		if strings.TrimSpace(*in.MilestoneName) == "" {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_milestones_name", *in.MilestoneName)
	}
	if in.MilestoneDescription != nil {
		addField("timeboxes_milestones_description", *in.MilestoneDescription)
	}
	if in.MilestoneOwner != nil {
		addField("timeboxes_milestones_id_user_owner", *in.MilestoneOwner)
	}
	if in.MilestoneDateTarget != nil {
		addField("timeboxes_milestones_date_target", *in.MilestoneDateTarget)
	}
	if in.Status != nil {
		if !validStatuses[*in.Status] {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_milestones_status", *in.Status)
	}
	if in.Position != nil {
		addField("timeboxes_milestones_position", *in.Position)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, milestoneID)
	}

	args = append(args, milestoneID, workspaceID)
	q := fmt.Sprintf(sqlUpdateMilestoneTemplate, strings.Join(sets, ", "), n, n+1)

	row := s.pool.QueryRow(ctx, q, args...)
	m, err := scanMilestone(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update milestone: %w", err)
	}
	return m, nil
}

// Delete archives a milestone (sets archived_at).
func (s *Service) Delete(ctx context.Context, workspaceID, milestoneID string) error {
	tag, err := s.pool.Exec(ctx, sqlArchiveMilestone, milestoneID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete milestone: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validateCreateInput(in CreateMilestoneInput) error {
	if strings.TrimSpace(in.MilestoneName) == "" {
		return fmt.Errorf("%w: timeboxes_milestones_name is required", ErrInvalidInput)
	}
	if in.MilestoneDateTarget == "" {
		return fmt.Errorf("%w: timeboxes_milestones_date_target is required", ErrInvalidInput)
	}
	if _, err := time.Parse("2006-01-02", in.MilestoneDateTarget); err != nil {
		return fmt.Errorf("%w: timeboxes_milestones_date_target must be YYYY-MM-DD", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.SubscriptionID); err != nil {
		return fmt.Errorf("%w: invalid subscription_id", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.WorkspaceID); err != nil {
		return fmt.Errorf("%w: invalid workspace_id", ErrInvalidInput)
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanMilestone(row scannable) (*Milestone, error) {
	var m Milestone
	err := row.Scan(
		&m.ID, &m.SubscriptionID, &m.WorkspaceID, &m.OrgNodeID,
		&m.MilestoneName, &m.MilestoneDescription, &m.MilestoneOwner,
		&m.MilestoneDateTarget,
		&m.Status, &m.Position,
		&m.CreatedAt, &m.UpdatedAt, &m.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}
