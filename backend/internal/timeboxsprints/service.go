// Package timeboxsprints is the sole writer for the timebox_sprints table in
// vector_artefacts. All reads and writes must go through this package.
package timeboxsprints

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

// Service owns all DB operations for timebox_sprints.
type Service struct {
	pool *pgxpool.Pool
}

// NewService creates a Service backed by the given pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Create inserts a new sprint. Returns ErrConflict if the DB EXCLUDE
// constraint fires (overlapping dates for same workspace+org_node).
// Returns ErrAdjacency if an existing sprint's end date makes the
// requested start date non-adjacent.
func (s *Service) Create(ctx context.Context, in CreateSprintInput) (*Sprint, error) {
	if err := validateCreateInput(in); err != nil {
		return nil, err
	}
	if err := s.checkAdjacency(ctx, in.WorkspaceID, in.OrgNodeID, in.SprintDateStart, ""); err != nil {
		return nil, err
	}

	const q = `
		INSERT INTO timebox_sprints (
			subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days, sprint_date_start, sprint_date_end,
			sprint_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at`

	row := s.pool.QueryRow(ctx, q,
		in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
		in.SprintName, in.SprintSuffix, in.SprintOwner,
		in.SprintCadenceDays, in.SprintDateStart, in.SprintDateEnd,
		in.SprintVelocity,
	)
	sprint, err := scanSprint(row)
	if err != nil {
		if isOverlapErr(err) {
			return nil, ErrConflict
		}
		return nil, fmt.Errorf("create sprint: %w", err)
	}
	return sprint, nil
}

// BulkCreate inserts multiple sprints in a single transaction. If any
// sprint fails validation or the DB rejects it, all inserts are rolled back.
func (s *Service) BulkCreate(ctx context.Context, inputs []CreateSprintInput) ([]*Sprint, error) {
	if len(inputs) == 0 {
		return nil, ErrInvalidInput
	}
	for _, in := range inputs {
		if err := validateCreateInput(in); err != nil {
			return nil, err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin bulk-create transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const q = `
		INSERT INTO timebox_sprints (
			subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days, sprint_date_start, sprint_date_end,
			sprint_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at`

	results := make([]*Sprint, 0, len(inputs))
	for _, in := range inputs {
		row := tx.QueryRow(ctx, q,
			in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
			in.SprintName, in.SprintSuffix, in.SprintOwner,
			in.SprintCadenceDays, in.SprintDateStart, in.SprintDateEnd,
			in.SprintVelocity,
		)
		sprint, err := scanSprint(row)
		if err != nil {
			if isOverlapErr(err) {
				return nil, ErrConflict
			}
			return nil, fmt.Errorf("bulk-create sprint %q: %w", in.SprintName, err)
		}
		results = append(results, sprint)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit bulk-create: %w", err)
	}
	return results, nil
}

// Get returns a single sprint by ID scoped to the workspace.
func (s *Service) Get(ctx context.Context, workspaceID, sprintID string) (*Sprint, error) {
	const q = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
		FROM timebox_sprints
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`

	row := s.pool.QueryRow(ctx, q, sprintID, workspaceID)
	sprint, err := scanSprint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get sprint: %w", err)
	}
	return sprint, nil
}

// List returns non-archived sprints for a workspace, ordered by start date ASC.
func (s *Service) List(ctx context.Context, workspaceID string, f ListFilters) ([]*Sprint, error) {
	args := []any{workspaceID}
	conds := []string{"workspace_id = $1", "archived_at IS NULL"}
	n := 2

	if f.OrgNodeID != nil {
		conds = append(conds, fmt.Sprintf("org_node_id = $%d", n))
		args = append(args, *f.OrgNodeID)
		n++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("status = $%d", n))
		args = append(args, *f.Status)
		n++
	}

	q := fmt.Sprintf(`
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
		FROM timebox_sprints
		WHERE %s
		ORDER BY sprint_date_start ASC`, strings.Join(conds, " AND "))

	_ = n // used for param counting
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list sprints: %w", err)
	}
	defer rows.Close()

	var sprints []*Sprint
	for rows.Next() {
		sprint, err := scanSprint(rows)
		if err != nil {
			return nil, fmt.Errorf("scan sprint row: %w", err)
		}
		sprints = append(sprints, sprint)
	}
	if sprints == nil {
		sprints = []*Sprint{}
	}
	return sprints, rows.Err()
}

// Update applies partial updates to a sprint. Returns ErrNotFound if
// the sprint doesn't exist in the workspace, ErrConflict on date overlap.
func (s *Service) Update(ctx context.Context, workspaceID, sprintID string, in UpdateSprintInput) (*Sprint, error) {
	sets := []string{}
	args := []any{}
	n := 1

	addField := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}

	if in.SprintName != nil {
		if strings.TrimSpace(*in.SprintName) == "" {
			return nil, ErrInvalidInput
		}
		addField("sprint_name", *in.SprintName)
	}
	if in.SprintSuffix != nil {
		addField("sprint_suffix", *in.SprintSuffix)
	}
	if in.SprintOwner != nil {
		addField("sprint_owner", *in.SprintOwner)
	}
	if in.SprintCadenceDays != nil {
		if *in.SprintCadenceDays <= 0 {
			return nil, ErrInvalidInput
		}
		addField("sprint_cadence_days", *in.SprintCadenceDays)
	}
	if in.SprintDateStart != nil {
		addField("sprint_date_start", *in.SprintDateStart)
	}
	if in.SprintDateEnd != nil {
		addField("sprint_date_end", *in.SprintDateEnd)
	}
	if in.SprintScope != nil {
		addField("sprint_scope", *in.SprintScope)
	}
	if in.SprintVelocity != nil {
		addField("sprint_velocity", *in.SprintVelocity)
	}
	if in.SprintEstimate != nil {
		addField("sprint_estimate", *in.SprintEstimate)
	}
	if in.Status != nil {
		if !validStatuses[*in.Status] {
			return nil, ErrInvalidInput
		}
		addField("status", *in.Status)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, sprintID)
	}

	args = append(args, sprintID, workspaceID)
	q := fmt.Sprintf(`
		UPDATE timebox_sprints
		SET %s
		WHERE id = $%d AND workspace_id = $%d AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at`,
		strings.Join(sets, ", "), n, n+1)

	row := s.pool.QueryRow(ctx, q, args...)
	sprint, err := scanSprint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if isOverlapErr(err) {
			return nil, ErrConflict
		}
		return nil, fmt.Errorf("update sprint: %w", err)
	}
	return sprint, nil
}

// Delete archives a sprint (sets archived_at). Returns ErrLifecycle if
// the sprint is active or completed, ErrNotFound if not in workspace.
func (s *Service) Delete(ctx context.Context, workspaceID, sprintID string) error {
	// Check lifecycle before archiving.
	sprint, err := s.Get(ctx, workspaceID, sprintID)
	if err != nil {
		return err
	}
	if sprint.Status == "active" || sprint.Status == "completed" {
		return ErrLifecycle
	}

	const q = `
		UPDATE timebox_sprints
		SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`

	tag, err := s.pool.Exec(ctx, q, sprintID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete sprint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// checkAdjacency verifies that the proposed start date is exactly one day
// after the most recent sprint's end date for the same workspace+org_node
// combination. If there are no existing sprints the check passes.
// excludeID (if non-empty) is excluded from the query — used by Update.
func (s *Service) checkAdjacency(ctx context.Context, workspaceID string, orgNodeID *string, proposedStart, excludeID string) error {
	var q string
	var args []any

	if orgNodeID == nil {
		// No org_node — only check workspace-level sprints with no org_node.
		q = `
			SELECT sprint_date_end::text
			FROM timebox_sprints
			WHERE workspace_id = $1 AND org_node_id IS NULL AND archived_at IS NULL
			ORDER BY sprint_date_end DESC LIMIT 1`
		args = []any{workspaceID}
	} else {
		q = `
			SELECT sprint_date_end::text
			FROM timebox_sprints
			WHERE workspace_id = $1 AND org_node_id = $2 AND archived_at IS NULL
			ORDER BY sprint_date_end DESC LIMIT 1`
		args = []any{workspaceID, *orgNodeID}
	}

	var lastEndDate string
	err := s.pool.QueryRow(ctx, q, args...).Scan(&lastEndDate)
	if errors.Is(err, pgx.ErrNoRows) {
		// No existing sprints — adjacency check passes.
		return nil
	}
	if err != nil {
		return fmt.Errorf("adjacency check query: %w", err)
	}

	lastEnd, err := time.Parse("2006-01-02", lastEndDate)
	if err != nil {
		return fmt.Errorf("parse last sprint end date: %w", err)
	}
	proposed, err := time.Parse("2006-01-02", proposedStart)
	if err != nil {
		return fmt.Errorf("parse proposed start date: %w", err)
	}

	expected := lastEnd.AddDate(0, 0, 1)
	if !proposed.Equal(expected) {
		return fmt.Errorf("%w: expected %s, got %s",
			ErrAdjacency, expected.Format("2006-01-02"), proposedStart)
	}
	return nil
}

// validateCreateInput checks required fields and basic constraints.
func validateCreateInput(in CreateSprintInput) error {
	if strings.TrimSpace(in.SprintName) == "" {
		return fmt.Errorf("%w: sprint_name is required", ErrInvalidInput)
	}
	if in.SprintCadenceDays <= 0 {
		return fmt.Errorf("%w: sprint_cadence_days must be positive", ErrInvalidInput)
	}
	if in.SprintDateStart == "" || in.SprintDateEnd == "" {
		return fmt.Errorf("%w: sprint_date_start and sprint_date_end are required", ErrInvalidInput)
	}
	start, err := time.Parse("2006-01-02", in.SprintDateStart)
	if err != nil {
		return fmt.Errorf("%w: sprint_date_start must be YYYY-MM-DD", ErrInvalidInput)
	}
	end, err := time.Parse("2006-01-02", in.SprintDateEnd)
	if err != nil {
		return fmt.Errorf("%w: sprint_date_end must be YYYY-MM-DD", ErrInvalidInput)
	}
	if !end.After(start) && !end.Equal(start) {
		return fmt.Errorf("%w: sprint_date_end must be >= sprint_date_start", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.SubscriptionID); err != nil {
		return fmt.Errorf("%w: invalid subscription_id", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.WorkspaceID); err != nil {
		return fmt.Errorf("%w: invalid workspace_id", ErrInvalidInput)
	}
	return nil
}

// isOverlapErr reports whether the pgx error is a Postgres exclusion
// constraint violation (SQLSTATE 23P01).
func isOverlapErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "23P01") ||
		strings.Contains(err.Error(), "timebox_sprints_no_overlap")
}

// scannable is the interface satisfied by both pgx.Row and pgx.Rows.
type scannable interface {
	Scan(dest ...any) error
}

func scanSprint(row scannable) (*Sprint, error) {
	var s Sprint
	err := row.Scan(
		&s.ID, &s.SubscriptionID, &s.WorkspaceID, &s.OrgNodeID,
		&s.SprintName, &s.SprintSuffix, &s.SprintOwner,
		&s.SprintCadenceDays,
		&s.SprintDateStart, &s.SprintDateEnd,
		&s.SprintScope, &s.SprintVelocity, &s.SprintEstimate,
		&s.SprintCreepByCount, &s.SprintCreepByEstimate,
		&s.Status, &s.SprintDateAdded, &s.SprintDateUpdated, &s.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
