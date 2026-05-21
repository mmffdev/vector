// Package timeboxsprints is the sole writer for the timeboxes_sprints
// table in vector_artefacts. All reads and writes must go through this
// package. Table + column names follow §2.3 (column-prefix rule) and
// §2.4 (PK/FK function-then-modifier) after RF1.4.2.timeboxes /
// migration 054.
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
	"github.com/mmffdev/vector-backend/internal/topology"
	"github.com/mmffdev/vector-backend/internal/webhooks"
)

// Service owns all DB operations for timeboxes_sprints.
type Service struct {
	pool     *pgxpool.Pool
	notifier *webhooks.Notifier
	// Slice 5B — optional topology service for ancestor-walk on List.
	// Nil = ancestor-walk disabled (back-compat path; List returns only
	// rows pinned to the requested node).
	topo *topology.Service
}

// NewService creates a Service backed by the given pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// WithNotifier attaches a webhook notifier to the service.
func (s *Service) WithNotifier(n *webhooks.Notifier) {
	s.notifier = n
}

// WithTopology attaches a topology service so List can resolve a node's
// ancestor chain for heartbeat propagation reads (slice 5B). When the
// caller supplies SubscriptionID + OrgNodeID in ListFilters AND this
// dep is non-nil, the List path returns inherited sprints from
// ancestor nodes whose scope_propagation = 'this_node_and_descendants'.
func (s *Service) WithTopology(t *topology.Service) *Service {
	s.topo = t
	return s
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

	velocity := 0
	if in.SprintVelocity != nil {
		velocity = *in.SprintVelocity
	}
	row := s.pool.QueryRow(ctx, sqlInsertSprint,
		in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
		in.SprintName, in.SprintSuffix, in.SprintOwner,
		in.SprintCadenceDays, in.SprintDateStart, in.SprintDateEnd,
		velocity,
		in.ScopePropagation, // Slice 5A — nil → COALESCE to DB default 'this_node_only'
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

	results := make([]*Sprint, 0, len(inputs))
	for _, in := range inputs {
		velocity := 0
		if in.SprintVelocity != nil {
			velocity = *in.SprintVelocity
		}
		row := tx.QueryRow(ctx, sqlInsertSprint,
			in.SubscriptionID, in.WorkspaceID, in.OrgNodeID,
			in.SprintName, in.SprintSuffix, in.SprintOwner,
			in.SprintCadenceDays, in.SprintDateStart, in.SprintDateEnd,
			velocity,
			in.ScopePropagation, // Slice 5A — nil → COALESCE to DB default 'this_node_only'
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
	row := s.pool.QueryRow(ctx, sqlSelectSprintByID, sprintID, workspaceID)
	sprint, err := scanSprint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get sprint: %w", err)
	}
	return sprint, nil
}

// List returns non-archived sprints for a workspace, ordered by start
// date ASC. Slice 5B — when SubscriptionID + OrgNodeID + s.topo are
// ALL set, the result also includes sprints pinned to STRICT ancestors
// of OrgNodeID whose scope_propagation = 'this_node_and_descendants'
// (inherited rows). Origin metadata is stamped on each result before
// return: origin="local" for rows pinned to OrgNodeID itself,
// origin="inherited" plus FromNodeID/Name for rows walked in from an
// ancestor.
func (s *Service) List(ctx context.Context, workspaceID string, f ListFilters) ([]*Sprint, error) {
	// Resolve ancestor chain when the request opts in.
	var ancestors []topology.Node
	if f.OrgNodeID != nil && f.SubscriptionID != nil && s.topo != nil {
		subUUID, perr := uuid.Parse(*f.SubscriptionID)
		nodeUUID, nerr := uuid.Parse(*f.OrgNodeID)
		if perr == nil && nerr == nil {
			chain, terr := s.topo.AncestorsOf(ctx, subUUID, nodeUUID)
			if terr == nil {
				// Drop self (depth 0 in topology's chain — last element
				// in the ORDER BY depth DESC result).
				for _, n := range chain {
					if n.ID != nodeUUID {
						ancestors = append(ancestors, n)
					}
				}
			}
			// Topology errors silently degrade — List still returns the
			// pinned-node set. Failing the read because the ancestor
			// walk hiccuped would be a regression in robustness.
		}
	}

	args := []any{workspaceID}
	conds := []string{
		"timeboxes_sprints_id_workspace = $1",
		"timeboxes_sprints_archived_at IS NULL",
	}
	n := 2

	if f.OrgNodeID != nil {
		if len(ancestors) > 0 {
			// Pinned-node rows OR ancestor rows with propagation flag.
			ancPlaceholders := make([]string, len(ancestors))
			for i, a := range ancestors {
				ancPlaceholders[i] = fmt.Sprintf("$%d", n)
				args = append(args, a.ID.String())
				n++
			}
			conds = append(conds, fmt.Sprintf(
				"(timeboxes_sprints_id_topology_node = $%d OR "+
					"(timeboxes_sprints_id_topology_node IN (%s) "+
					"AND timeboxes_sprints_scope_propagation = 'this_node_and_descendants'))",
				n, strings.Join(ancPlaceholders, ","),
			))
			args = append(args, *f.OrgNodeID)
			n++
		} else {
			conds = append(conds, fmt.Sprintf("timeboxes_sprints_id_topology_node = $%d", n))
			args = append(args, *f.OrgNodeID)
			n++
		}
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("timeboxes_sprints_status = $%d", n))
		args = append(args, *f.Status)
		n++
	}

	q := fmt.Sprintf(sqlListSprintsTemplate, strings.Join(conds, " AND "))

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

	// Slice 5B — stamp origin metadata on each row. Only meaningful
	// when the ancestor-walk was active; otherwise everything is local.
	if f.OrgNodeID != nil {
		ancestorByID := make(map[string]*topology.Node, len(ancestors))
		for i := range ancestors {
			ancestorByID[ancestors[i].ID.String()] = &ancestors[i]
		}
		for _, sp := range sprints {
			if sp.OrgNodeID == nil || *sp.OrgNodeID == *f.OrgNodeID {
				sp.Origin = "local"
				continue
			}
			if anc, ok := ancestorByID[*sp.OrgNodeID]; ok {
				sp.Origin = "inherited"
				idStr := anc.ID.String()
				name := anc.Name
				sp.FromNodeID = &idStr
				sp.FromNodeName = &name
			} else {
				// Shouldn't happen — the WHERE clause filtered to
				// pinned + matching ancestors only — but be safe.
				sp.Origin = "local"
			}
		}
	}

	return sprints, rows.Err()
}

// isInheritedRead returns true when the given sprint, viewed from
// viewingNodeID, would surface as inherited (its pinned topology node
// is an ancestor whose scope_propagation = 'this_node_and_descendants').
// Used by the write-side guards in Update/Archive/Start/Close to reject
// 409 when the caller tries to mutate a row they're only seeing via
// inheritance.
//
// Returns (true, nil) for an inherited read.
// Returns (false, nil) when the sprint is local (pinned to viewingNodeID
// or to a node not in viewingNodeID's ancestor chain).
// Returns (false, err) only on topology lookup failure — caller decides
// whether to fail closed or open; current write-side opts to fail OPEN
// (allow the write) because a topology hiccup blocking edits is worse
// than the brief inconsistency window of allowing one inherited edit.
func (s *Service) isInheritedRead(
	ctx context.Context, sprint *Sprint, subscriptionID, viewingNodeID string,
) (bool, error) {
	if s.topo == nil || sprint.OrgNodeID == nil || viewingNodeID == "" {
		return false, nil
	}
	if *sprint.OrgNodeID == viewingNodeID {
		return false, nil
	}
	if sprint.ScopePropagation != "this_node_and_descendants" {
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
		if anc.ID.String() == *sprint.OrgNodeID && anc.ID != nodeUUID {
			return true, nil
		}
	}
	return false, nil
}

// EnsureWritable rejects mutation attempts on rows the caller is only
// seeing via heartbeat inheritance. Slice 5B (2026-05-21). Handlers
// call this BEFORE Update/Delete/Start/Close; on ErrInheritedReadOnly
// the handler maps to 409. subscriptionID + viewingNodeID may be
// empty — in which case the guard is a no-op (back-compat for callers
// that haven't been plumbed yet).
func (s *Service) EnsureWritable(
	ctx context.Context, workspaceID, sprintID, subscriptionID, viewingNodeID string,
) error {
	if subscriptionID == "" || viewingNodeID == "" || s.topo == nil {
		return nil
	}
	sprint, err := s.Get(ctx, workspaceID, sprintID)
	if err != nil {
		// Let the downstream call handle NotFound semantics — we don't
		// want to leak "row exists but you can't see it" via this guard.
		return nil
	}
	inherited, ierr := s.isInheritedRead(ctx, sprint, subscriptionID, viewingNodeID)
	if ierr != nil {
		// Fail open on topology hiccups — see isInheritedRead docstring.
		return nil
	}
	if inherited {
		return ErrInheritedReadOnly
	}
	return nil
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
		addField("timeboxes_sprints_name", *in.SprintName)
	}
	if in.SprintSuffix != nil {
		addField("timeboxes_sprints_suffix", *in.SprintSuffix)
	}
	if in.SprintOwner != nil {
		addField("timeboxes_sprints_id_user_owner", *in.SprintOwner)
	}
	if in.SprintCadenceDays != nil {
		if *in.SprintCadenceDays <= 0 {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_sprints_cadence_days", *in.SprintCadenceDays)
	}
	if in.SprintDateStart != nil {
		addField("timeboxes_sprints_date_start", *in.SprintDateStart)
	}
	if in.SprintDateEnd != nil {
		addField("timeboxes_sprints_date_end", *in.SprintDateEnd)
	}
	if in.SprintScope != nil {
		addField("timeboxes_sprints_scope", *in.SprintScope)
	}
	if in.SprintVelocity != nil {
		addField("timeboxes_sprints_velocity", *in.SprintVelocity)
	}
	if in.SprintEstimate != nil {
		addField("timeboxes_sprints_estimate", *in.SprintEstimate)
	}
	if in.Status != nil {
		if !validStatuses[*in.Status] {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_sprints_status", *in.Status)
	}
	if in.ScopePropagation != nil {
		if *in.ScopePropagation != "this_node_only" && *in.ScopePropagation != "this_node_and_descendants" {
			return nil, ErrInvalidInput
		}
		addField("timeboxes_sprints_scope_propagation", *in.ScopePropagation)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, sprintID)
	}

	args = append(args, sprintID, workspaceID)
	q := fmt.Sprintf(sqlUpdateSprintTemplate, strings.Join(sets, ", "), n, n+1)

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

	tag, err := s.pool.Exec(ctx, sqlArchiveSprint, sprintID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete sprint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Start transitions a sprint from planned → active. Returns ErrStartLifecycle
// if the sprint is not in the planned state. The atomic UPDATE guards against
// concurrent transitions.
func (s *Service) Start(ctx context.Context, workspaceID, sprintID string) (*Sprint, error) {
	row := s.pool.QueryRow(ctx, sqlStartSprint, sprintID, workspaceID)
	sprint, err := scanSprint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Either not found or already active/completed — distinguish.
			existing, getErr := s.Get(ctx, workspaceID, sprintID)
			if getErr != nil {
				return nil, getErr
			}
			if existing.Status != "planned" {
				return nil, ErrStartLifecycle
			}
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("start sprint: %w", err)
	}

	if s.notifier != nil {
		wsID, _ := uuid.Parse(sprint.WorkspaceID)
		s.notifier.Fire(wsID, "sprint.started", sprint)
	}
	return sprint, nil
}

// Close transitions a sprint from active → completed. Returns ErrCloseLifecycle
// if the sprint is not active. The atomic UPDATE guards against concurrent transitions.
func (s *Service) Close(ctx context.Context, workspaceID, sprintID string) (*Sprint, error) {
	row := s.pool.QueryRow(ctx, sqlCloseSprint, sprintID, workspaceID)
	sprint, err := scanSprint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := s.Get(ctx, workspaceID, sprintID)
			if getErr != nil {
				return nil, getErr
			}
			if existing.Status != "active" {
				return nil, ErrCloseLifecycle
			}
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("close sprint: %w", err)
	}

	if s.notifier != nil {
		wsID, _ := uuid.Parse(sprint.WorkspaceID)
		s.notifier.Fire(wsID, "sprint.closed", sprint)
	}
	return sprint, nil
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
		q = sqlSelectLastSprintEndDateRoot
		args = []any{workspaceID}
	} else {
		q = sqlSelectLastSprintEndDateForNode
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
		strings.Contains(err.Error(), "timeboxes_sprints_no_overlap")
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
		// Slice 5A — column appended after archived_at in every SELECT/RETURNING
		// (see sql.go). Order MUST match the column-list there.
		&s.ScopePropagation,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
