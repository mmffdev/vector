// Package timeboxreleases is the sole writer for the timebox_releases table in
// vector_artefacts. All reads and writes must go through this package.
package timeboxreleases

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

// Service owns all DB operations for timebox_releases.
type Service struct {
	pool *pgxpool.Pool
}

// NewService creates a Service backed by the given pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Create inserts a new release. Returns ErrConflict if the DB EXCLUDE
// constraint fires (overlapping dates for same workspace+org_node).
func (s *Service) Create(ctx context.Context, in CreateReleaseInput) (*Release, error) {
	if err := validateCreateInput(in); err != nil {
		return nil, err
	}

	const q = `
		INSERT INTO timebox_releases (
			subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days, release_date_start, release_date_end,
			release_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at`

	row := s.pool.QueryRow(ctx, q,
		in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
		in.ReleaseName, in.ReleaseSuffix, in.ReleaseOwner,
		in.ReleaseCadenceDays, in.ReleaseDateStart, in.ReleaseDateEnd,
		in.ReleaseVelocity,
	)
	release, err := scanRelease(row)
	if err != nil {
		if isOverlapErr(err) {
			return nil, ErrConflict
		}
		return nil, fmt.Errorf("create release: %w", err)
	}
	return release, nil
}

// BulkCreate inserts multiple releases in a single transaction.
func (s *Service) BulkCreate(ctx context.Context, inputs []CreateReleaseInput) ([]*Release, error) {
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
		INSERT INTO timebox_releases (
			subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days, release_date_start, release_date_end,
			release_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at`

	results := make([]*Release, 0, len(inputs))
	for _, in := range inputs {
		row := tx.QueryRow(ctx, q,
			in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
			in.ReleaseName, in.ReleaseSuffix, in.ReleaseOwner,
			in.ReleaseCadenceDays, in.ReleaseDateStart, in.ReleaseDateEnd,
			in.ReleaseVelocity,
		)
		release, err := scanRelease(row)
		if err != nil {
			if isOverlapErr(err) {
				return nil, ErrConflict
			}
			return nil, fmt.Errorf("bulk-create release %q: %w", in.ReleaseName, err)
		}
		results = append(results, release)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit bulk-create: %w", err)
	}
	return results, nil
}

// Get returns a single release by ID scoped to the workspace.
func (s *Service) Get(ctx context.Context, workspaceID, releaseID string) (*Release, error) {
	const q = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
		FROM timebox_releases
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`

	row := s.pool.QueryRow(ctx, q, releaseID, workspaceID)
	release, err := scanRelease(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get release: %w", err)
	}
	return release, nil
}

// List returns non-archived releases for a workspace, ordered by start date ASC.
func (s *Service) List(ctx context.Context, workspaceID string, f ListFilters) ([]*Release, error) {
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
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
		FROM timebox_releases
		WHERE %s
		ORDER BY release_date_start ASC`, strings.Join(conds, " AND "))

	_ = n
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list releases: %w", err)
	}
	defer rows.Close()

	var releases []*Release
	for rows.Next() {
		release, err := scanRelease(rows)
		if err != nil {
			return nil, fmt.Errorf("scan release row: %w", err)
		}
		releases = append(releases, release)
	}
	if releases == nil {
		releases = []*Release{}
	}
	return releases, rows.Err()
}

// Update applies partial updates to a release.
func (s *Service) Update(ctx context.Context, workspaceID, releaseID string, in UpdateReleaseInput) (*Release, error) {
	sets := []string{}
	args := []any{}
	n := 1

	addField := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, val)
		n++
	}

	if in.ReleaseName != nil {
		if strings.TrimSpace(*in.ReleaseName) == "" {
			return nil, ErrInvalidInput
		}
		addField("release_name", *in.ReleaseName)
	}
	if in.ReleaseSuffix != nil {
		addField("release_suffix", *in.ReleaseSuffix)
	}
	if in.ReleaseOwner != nil {
		addField("release_owner", *in.ReleaseOwner)
	}
	if in.ReleaseCadenceDays != nil {
		if *in.ReleaseCadenceDays < 0 {
			return nil, ErrInvalidInput
		}
		addField("release_cadence_days", *in.ReleaseCadenceDays)
	}
	if in.ReleaseDateStart != nil {
		addField("release_date_start", *in.ReleaseDateStart)
	}
	if in.ReleaseDateEnd != nil {
		addField("release_date_end", *in.ReleaseDateEnd)
	}
	if in.ReleaseScope != nil {
		addField("release_scope", *in.ReleaseScope)
	}
	if in.ReleaseVelocity != nil {
		addField("release_velocity", *in.ReleaseVelocity)
	}
	if in.ReleaseEstimate != nil {
		addField("release_estimate", *in.ReleaseEstimate)
	}
	if in.Status != nil {
		if !validStatuses[*in.Status] {
			return nil, ErrInvalidInput
		}
		addField("status", *in.Status)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, releaseID)
	}

	args = append(args, releaseID, workspaceID)
	q := fmt.Sprintf(`
		UPDATE timebox_releases
		SET %s
		WHERE id = $%d AND workspace_id = $%d AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at`,
		strings.Join(sets, ", "), n, n+1)

	row := s.pool.QueryRow(ctx, q, args...)
	release, err := scanRelease(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if isOverlapErr(err) {
			return nil, ErrConflict
		}
		return nil, fmt.Errorf("update release: %w", err)
	}
	return release, nil
}

// Delete archives a release (sets archived_at). Returns ErrLifecycle if
// the release is active or completed.
func (s *Service) Delete(ctx context.Context, workspaceID, releaseID string) error {
	release, err := s.Get(ctx, workspaceID, releaseID)
	if err != nil {
		return err
	}
	if release.Status == "active" || release.Status == "completed" {
		return ErrLifecycle
	}

	const q = `
		UPDATE timebox_releases
		SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`

	tag, err := s.pool.Exec(ctx, q, releaseID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete release: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validateCreateInput(in CreateReleaseInput) error {
	if strings.TrimSpace(in.ReleaseName) == "" {
		return fmt.Errorf("%w: release_name is required", ErrInvalidInput)
	}
	if in.ReleaseCadenceDays < 0 {
		return fmt.Errorf("%w: release_cadence_days must be non-negative", ErrInvalidInput)
	}
	if in.ReleaseDateStart == "" || in.ReleaseDateEnd == "" {
		return fmt.Errorf("%w: release_date_start and release_date_end are required", ErrInvalidInput)
	}
	start, err := time.Parse("2006-01-02", in.ReleaseDateStart)
	if err != nil {
		return fmt.Errorf("%w: release_date_start must be YYYY-MM-DD", ErrInvalidInput)
	}
	end, err := time.Parse("2006-01-02", in.ReleaseDateEnd)
	if err != nil {
		return fmt.Errorf("%w: release_date_end must be YYYY-MM-DD", ErrInvalidInput)
	}
	if end.Before(start) {
		return fmt.Errorf("%w: release_date_end must be >= release_date_start", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.SubscriptionID); err != nil {
		return fmt.Errorf("%w: invalid subscription_id", ErrInvalidInput)
	}
	if _, err := uuid.Parse(in.WorkspaceID); err != nil {
		return fmt.Errorf("%w: invalid workspace_id", ErrInvalidInput)
	}
	return nil
}

func isOverlapErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "23P01") ||
		strings.Contains(err.Error(), "timebox_releases_no_overlap")
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRelease(row scannable) (*Release, error) {
	var r Release
	err := row.Scan(
		&r.ID, &r.SubscriptionID, &r.WorkspaceID, &r.OrgNodeID,
		&r.ReleaseName, &r.ReleaseSuffix, &r.ReleaseOwner,
		&r.ReleaseCadenceDays,
		&r.ReleaseDateStart, &r.ReleaseDateEnd,
		&r.ReleaseScope, &r.ReleaseVelocity, &r.ReleaseEstimate,
		&r.ReleaseCreepByCount, &r.ReleaseCreepByEstimate,
		&r.Status, &r.ReleaseDateAdded, &r.ReleaseDateUpdated, &r.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
