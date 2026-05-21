// Package timeboxreleases is the sole writer for the timeboxes_releases
// table in vector_artefacts. All reads and writes must go through this
// package. Table + column names follow §2.3 / §2.4 after
// RF1.4.2.timeboxes / migration 054.
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
	"github.com/mmffdev/vector-backend/internal/topology"
)

// Service owns all DB operations for timeboxes_releases.
type Service struct {
	pool *pgxpool.Pool
	// Slice 5B — see timeboxsprints.Service for the contract.
	topo *topology.Service
}

// NewService creates a Service backed by the given pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// WithTopology attaches a topology service so List can resolve a node's
// ancestor chain for heartbeat propagation reads (slice 5B). Mirror of
// timeboxsprints.Service.WithTopology.
func (s *Service) WithTopology(t *topology.Service) *Service {
	s.topo = t
	return s
}

// Create inserts a new release. Returns ErrConflict if the DB EXCLUDE
// constraint fires (overlapping dates for same workspace+org_node).
func (s *Service) Create(ctx context.Context, in CreateReleaseInput) (*Release, error) {
	if err := validateCreateInput(in); err != nil {
		return nil, err
	}

	row := s.pool.QueryRow(ctx, sqlInsertRelease,
		in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
		in.ReleaseName, in.ReleaseSuffix, in.ReleaseOwner,
		in.ReleaseCadenceDays, in.ReleaseDateStart, in.ReleaseDateEnd,
		in.ReleaseVelocity,
		in.ScopePropagation,
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

	results := make([]*Release, 0, len(inputs))
	for _, in := range inputs {
		row := tx.QueryRow(ctx, sqlInsertRelease,
			in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
			in.ReleaseName, in.ReleaseSuffix, in.ReleaseOwner,
			in.ReleaseCadenceDays, in.ReleaseDateStart, in.ReleaseDateEnd,
			in.ReleaseVelocity,
			in.ScopePropagation,
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
	row := s.pool.QueryRow(ctx, sqlSelectReleaseByID, releaseID, workspaceID)
	release, err := scanRelease(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get release: %w", err)
	}
	return release, nil
}

// List returns non-archived releases for a workspace, ordered by start
// date ASC. Slice 5B — same opt-in ancestor-walk as timeboxsprints.List.
func (s *Service) List(ctx context.Context, workspaceID string, f ListFilters) ([]*Release, error) {
	var ancestors []topology.Node
	if f.OrgNodeID != nil && f.SubscriptionID != nil && s.topo != nil {
		subUUID, perr := uuid.Parse(*f.SubscriptionID)
		nodeUUID, nerr := uuid.Parse(*f.OrgNodeID)
		if perr == nil && nerr == nil {
			chain, terr := s.topo.AncestorsOf(ctx, subUUID, nodeUUID)
			if terr == nil {
				for _, n := range chain {
					if n.ID != nodeUUID {
						ancestors = append(ancestors, n)
					}
				}
			}
		}
	}

	args := []any{workspaceID}
	conds := []string{
		"timeboxes_releases_id_workspace = $1",
		"timeboxes_releases_archived_at IS NULL",
	}
	n := 2

	if f.OrgNodeID != nil {
		if len(ancestors) > 0 {
			ancPlaceholders := make([]string, len(ancestors))
			for i, a := range ancestors {
				ancPlaceholders[i] = fmt.Sprintf("$%d", n)
				args = append(args, a.ID.String())
				n++
			}
			conds = append(conds, fmt.Sprintf(
				"(timeboxes_releases_id_topology_node = $%d OR "+
					"(timeboxes_releases_id_topology_node IN (%s) "+
					"AND timeboxes_releases_scope_propagation = 'this_node_and_descendants'))",
				n, strings.Join(ancPlaceholders, ","),
			))
			args = append(args, *f.OrgNodeID)
			n++
		} else {
			conds = append(conds, fmt.Sprintf("timeboxes_releases_id_topology_node = $%d", n))
			args = append(args, *f.OrgNodeID)
			n++
		}
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("timeboxes_releases_status = $%d", n))
		args = append(args, *f.Status)
		n++
	}

	q := fmt.Sprintf(sqlListReleasesTemplate, strings.Join(conds, " AND "))

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

	if f.OrgNodeID != nil {
		ancestorByID := make(map[string]*topology.Node, len(ancestors))
		for i := range ancestors {
			ancestorByID[ancestors[i].ID.String()] = &ancestors[i]
		}
		for _, rl := range releases {
			if rl.OrgNodeID == nil || *rl.OrgNodeID == *f.OrgNodeID {
				rl.Origin = "local"
				continue
			}
			if anc, ok := ancestorByID[*rl.OrgNodeID]; ok {
				rl.Origin = "inherited"
				idStr := anc.ID.String()
				name := anc.Name
				rl.FromNodeID = &idStr
				rl.FromNodeName = &name
			} else {
				rl.Origin = "local"
			}
		}
	}

	return releases, rows.Err()
}

// isInheritedRead — mirror of timeboxsprints.isInheritedRead.
func (s *Service) isInheritedRead(
	ctx context.Context, release *Release, subscriptionID, viewingNodeID string,
) (bool, error) {
	if s.topo == nil || release.OrgNodeID == nil || viewingNodeID == "" {
		return false, nil
	}
	if *release.OrgNodeID == viewingNodeID {
		return false, nil
	}
	if release.ScopePropagation != "this_node_and_descendants" {
		return false, nil
	}
	subUUID, perr := uuid.Parse(subscriptionID)
	nodeUUID, nerr := uuid.Parse(viewingNodeID)
	if perr != nil || nerr != nil {
		return false, nil
	}
	chain, err := s.topo.AncestorsOf(ctx, subUUID, nodeUUID)
	if err != nil {
		return false, err
	}
	for _, anc := range chain {
		if anc.ID.String() == *release.OrgNodeID && anc.ID != nodeUUID {
			return true, nil
		}
	}
	return false, nil
}

// EnsureWritable rejects mutation attempts on rows the caller is only
// seeing via heartbeat inheritance. Slice 5B — mirror of
// timeboxsprints.Service.EnsureWritable.
func (s *Service) EnsureWritable(
	ctx context.Context, workspaceID, releaseID, subscriptionID, viewingNodeID string,
) error {
	if subscriptionID == "" || viewingNodeID == "" || s.topo == nil {
		return nil
	}
	release, err := s.Get(ctx, workspaceID, releaseID)
	if err != nil {
		return nil
	}
	inherited, ierr := s.isInheritedRead(ctx, release, subscriptionID, viewingNodeID)
	if ierr != nil {
		return nil
	}
	if inherited {
		return ErrInheritedReadOnly
	}
	return nil
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
		addField("timeboxes_releases_name", *in.ReleaseName)
	}
	if in.ReleaseSuffix != nil {
		addField("timeboxes_releases_suffix", *in.ReleaseSuffix)
	}
	if in.ReleaseOwner != nil {
		addField("timeboxes_releases_id_user_owner", *in.ReleaseOwner)
	}
	if in.ReleaseCadenceDays != nil {
		if *in.ReleaseCadenceDays < 0 {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_releases_cadence_days", *in.ReleaseCadenceDays)
	}
	if in.ReleaseDateStart != nil {
		addField("timeboxes_releases_date_start", *in.ReleaseDateStart)
	}
	if in.ReleaseDateEnd != nil {
		addField("timeboxes_releases_date_end", *in.ReleaseDateEnd)
	}
	if in.ReleaseScope != nil {
		addField("timeboxes_releases_scope", *in.ReleaseScope)
	}
	if in.ReleaseVelocity != nil {
		addField("timeboxes_releases_velocity", *in.ReleaseVelocity)
	}
	if in.ReleaseEstimate != nil {
		addField("timeboxes_releases_estimate", *in.ReleaseEstimate)
	}
	if in.Status != nil {
		if !validStatuses[*in.Status] {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_releases_status", *in.Status)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, releaseID)
	}

	args = append(args, releaseID, workspaceID)
	q := fmt.Sprintf(sqlUpdateReleaseTemplate, strings.Join(sets, ", "), n, n+1)

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

	tag, err := s.pool.Exec(ctx, sqlArchiveRelease, releaseID, workspaceID)
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
		strings.Contains(err.Error(), "timeboxes_releases_no_overlap")
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
		&r.ScopePropagation,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
