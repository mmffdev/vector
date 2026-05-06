package workitems

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns all DB operations for the work items domain.
type Service struct {
	pool *pgxpool.Pool
}

// New creates a Service backed by the given pool.
func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// rollupPointsExpr is a correlated subquery producing the sum of
// story_points across the descendant subtree of work item `wi`. NULL when
// the row has no non-archived children, so the wire field stays absent and
// the UI falls back to the manually-entered value.
//
// The recursive CTE walks parent_id from the row's children downward,
// excluding archived rows at every step. The outer COALESCE collapses an
// all-NULL sum (all descendants have NULL points) to 0 only when at least
// one descendant exists; the EXISTS guard ensures childless items return
// NULL so the frontend keeps showing the manual value.
const rollupPointsExpr = `(
	CASE WHEN EXISTS (
		SELECT 1 FROM o_artefacts_execution_work_items c
		WHERE c.parent_id = wi.id AND c.archived_at IS NULL
	) THEN (
		WITH RECURSIVE descendants AS (
			SELECT id, story_points
			FROM o_artefacts_execution_work_items
			WHERE parent_id = wi.id AND archived_at IS NULL
			UNION ALL
			SELECT child.id, child.story_points
			FROM o_artefacts_execution_work_items child
			JOIN descendants d ON child.parent_id = d.id
			WHERE child.archived_at IS NULL
		)
		SELECT COALESCE(SUM(story_points), 0) FROM descendants
	) ELSE NULL END
)`

// ─── Work Items ───────────────────────────────────────────────────────────────

// ListWorkItems returns a flat page of work items for the subscription,
// filtered by optional params. Archived rows are excluded.
func (s *Service) ListWorkItems(ctx context.Context, subscriptionID string, f ListWorkItemsFilter) ([]WorkItem, error) {
	if f.Limit <= 0 {
		f.Limit = 50
	} else if f.Limit > 5000 {
		f.Limit = 5000
	}

	args := []any{subscriptionID}
	conds := []string{"wi.subscription_id = $1", "wi.archived_at IS NULL"}
	n := 2

	if f.ParentID != nil {
		conds = append(conds, fmt.Sprintf("wi.parent_id = $%d", n))
		args = append(args, *f.ParentID)
		n++
	} else if f.ItemType == nil {
		// If no parent filter and no type filter, default to top-level items
		conds = append(conds, "wi.parent_id IS NULL")
	}
	if f.ItemType != nil {
		conds = append(conds, fmt.Sprintf("wi.item_type = $%d", n))
		args = append(args, *f.ItemType)
		n++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("wi.status = $%d", n))
		args = append(args, *f.Status)
		n++
	}
	if f.Priority != nil {
		conds = append(conds, fmt.Sprintf("wi.priority = $%d", n))
		args = append(args, *f.Priority)
		n++
	}
	if f.SprintID != nil {
		conds = append(conds, fmt.Sprintf("wi.sprint_id = $%d", n))
		args = append(args, *f.SprintID)
		n++
	}
	if f.OwnerID != nil {
		conds = append(conds, fmt.Sprintf("wi.owner_id = $%d", n))
		args = append(args, *f.OwnerID)
		n++
	}

	args = append(args, f.Limit, f.Offset)
	// Order by the active scope's position column. coalesce(sprint_position,
	// backlog_position) collapses both into one orderable value because the
	// table CHECK guarantees exactly one is non-NULL per row. NULLS LAST
	// covers any pre-backfill row; key_num is the stable tiebreaker.
	//
	// When the caller sets f.Sort = "id", we instead order tier-first
	// (epic → story → task → defect) and then by key_num. This keeps the
	// tree-shaped hierarchy intact across paginated windows so users see
	// every epic before any orphan story, regardless of raw key_num.
	orderBy := "coalesce(wi.sprint_position, wi.backlog_position) NULLS LAST, wi.key_num ASC"
	if f.Sort == "id" {
		dir := "ASC"
		if f.Dir == "desc" {
			dir = "DESC"
		}
		orderBy = `CASE wi.item_type
			WHEN 'epic' THEN 1
			WHEN 'story' THEN 2
			WHEN 'task' THEN 3
			WHEN 'defect' THEN 4
			ELSE 99 END ASC, wi.key_num ` + dir
	}
	q := fmt.Sprintf(`
		SELECT wi.id, wi.subscription_id, wi.key_num, wi.item_type, wi.title, wi.description,
		       wi.status, coalesce(wi.flow_state_id::text, ''), coalesce(fs.name, ''), coalesce(fs.canonical_code, ''),
		       wi.priority, wi.story_points, wi.sprint_id, wi.parent_id, wi.root_feature_id,
		       wi.owner_id, wi.created_by, wi.created_at, wi.updated_at, wi.archived_at,
		       (SELECT COUNT(*) FROM o_artefacts_execution_work_items c
		        WHERE c.parent_id = wi.id AND c.archived_at IS NULL) AS children_count,
		       %s AS rollup_points
		FROM o_artefacts_execution_work_items wi
		LEFT JOIN o_flow_tenant fs ON fs.id = wi.flow_state_id
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`,
		rollupPointsExpr, strings.Join(conds, " AND "), orderBy, n, n+1,
	)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWorkItems(rows)
}

// CountWorkItems returns the total number of rows that ListWorkItems would
// return for the same filter, ignoring Limit/Offset. Used by the lazy-load
// pagination UX so the frontend knows total page count without loading every
// row up front.
func (s *Service) CountWorkItems(ctx context.Context, subscriptionID string, f ListWorkItemsFilter) (int, error) {
	args := []any{subscriptionID}
	conds := []string{"subscription_id = $1", "archived_at IS NULL"}
	n := 2

	if f.ParentID != nil {
		conds = append(conds, fmt.Sprintf("parent_id = $%d", n))
		args = append(args, *f.ParentID)
		n++
	} else if f.ItemType == nil {
		conds = append(conds, "parent_id IS NULL")
	}
	if f.ItemType != nil {
		conds = append(conds, fmt.Sprintf("item_type = $%d", n))
		args = append(args, *f.ItemType)
		n++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("status = $%d", n))
		args = append(args, *f.Status)
		n++
	}
	if f.Priority != nil {
		conds = append(conds, fmt.Sprintf("priority = $%d", n))
		args = append(args, *f.Priority)
		n++
	}
	if f.SprintID != nil {
		conds = append(conds, fmt.Sprintf("sprint_id = $%d", n))
		args = append(args, *f.SprintID)
		n++
	}
	if f.OwnerID != nil {
		conds = append(conds, fmt.Sprintf("owner_id = $%d", n))
		args = append(args, *f.OwnerID)
		n++
	}
	q := fmt.Sprintf(`SELECT COUNT(*) FROM o_artefacts_execution_work_items WHERE %s`,
		strings.Join(conds, " AND "))
	var total int
	if err := s.pool.QueryRow(ctx, q, args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

// WorkItemsSummary is the count payload backing the Page Summary Header
// strip on /work-items. Counts span the full subscription tree (including
// every descendant level) so the strip reflects "what exists" rather than
// "what's currently expanded in the tree".
//
// Blocked is heuristic: open items that have not been updated in 14 days.
// The schema does not (yet) carry an explicit blocked flag.
type WorkItemsSummary struct {
	Total   int `json:"total"`
	Epics   int `json:"epics"`
	Tasks   int `json:"tasks"`
	Defects int `json:"defects"`
	Stories int `json:"stories"`
	Blocked int `json:"blocked"`
}

// SummariseWorkItems returns full-subscription counts by item_type plus a
// blocked count. Subscription scope is always enforced; archived rows are
// always excluded. Optional filters (sprintID) further narrow the set so
// the strip can reflect a filtered view when the user is in a sprint.
//
// item_type filter is intentionally NOT honoured: a user filtering the
// table to "tasks only" still wants to see the whole-tree shape.
func (s *Service) SummariseWorkItems(ctx context.Context, subscriptionID string, sprintID *string) (WorkItemsSummary, error) {
	args := []any{subscriptionID}
	conds := []string{"subscription_id = $1", "archived_at IS NULL"}
	n := 2
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("sprint_id = $%d", n))
		args = append(args, *sprintID)
		n++
	}
	q := fmt.Sprintf(`
		SELECT
			COUNT(*)                                               AS total,
			COUNT(*) FILTER (WHERE item_type = 'epic')             AS epics,
			COUNT(*) FILTER (WHERE item_type = 'story')            AS stories,
			COUNT(*) FILTER (WHERE item_type = 'task')             AS tasks,
			COUNT(*) FILTER (WHERE item_type = 'defect')           AS defects,
			COUNT(*) FILTER (
				WHERE status = 'open' AND updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM o_artefacts_execution_work_items
		WHERE %s`,
		strings.Join(conds, " AND "),
	)
	var out WorkItemsSummary
	if err := s.pool.QueryRow(ctx, q, args...).Scan(
		&out.Total, &out.Epics, &out.Stories, &out.Tasks, &out.Defects, &out.Blocked,
	); err != nil {
		return WorkItemsSummary{}, err
	}
	return out, nil
}

// GetWorkItem returns a single work item by ID, enforcing subscription isolation.
func (s *Service) GetWorkItem(ctx context.Context, subscriptionID string, id uuid.UUID) (*WorkItem, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT wi.id, wi.subscription_id, wi.key_num, wi.item_type, wi.title, wi.description,
		       wi.status, coalesce(wi.flow_state_id::text, ''), coalesce(fs.name, ''), coalesce(fs.canonical_code, ''),
		       wi.priority, wi.story_points, wi.sprint_id, wi.parent_id, wi.root_feature_id,
		       wi.owner_id, wi.created_by, wi.created_at, wi.updated_at, wi.archived_at,
		       (SELECT COUNT(*) FROM o_artefacts_execution_work_items c
		        WHERE c.parent_id = wi.id AND c.archived_at IS NULL) AS children_count,
		       `+rollupPointsExpr+` AS rollup_points
		FROM o_artefacts_execution_work_items wi
		LEFT JOIN o_flow_tenant fs ON fs.id = wi.flow_state_id
		WHERE wi.id = $1 AND wi.subscription_id = $2 AND wi.archived_at IS NULL`,
		id, subscriptionID,
	)
	wi, err := scanWorkItem(row)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return wi, err
}

// CreateWorkItem inserts a new work item row. key_num is allocated via sequence.
func (s *Service) CreateWorkItem(ctx context.Context, subscriptionID string, in CreateWorkItemInput) (*WorkItem, error) {
	if !validItemTypes[in.ItemType] {
		return nil, fmt.Errorf("%w: item_type must be epic, story, task, or defect", ErrInvalidInput)
	}
	if in.StoryPoints != nil && !canHaveManualPoints(in.ItemType) {
		return nil, fmt.Errorf("%w: story_points cannot be set on %s items", ErrInvalidInput, in.ItemType)
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	status := in.Status
	if status == "" {
		status = "open"
	}
	if !validStatuses[status] {
		return nil, fmt.Errorf("%w: invalid status", ErrInvalidInput)
	}
	if in.Priority != nil && !validPriorities[*in.Priority] {
		return nil, fmt.Errorf("%w: invalid priority", ErrInvalidInput)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Allocate key_num atomically.
	var keyNum int64
	err = tx.QueryRow(ctx, `
		INSERT INTO subscription_sequence (subscription_id, scope, next_num)
		VALUES ($1, 'work_item', 2)
		ON CONFLICT (subscription_id, scope) DO UPDATE
			SET next_num = subscription_sequence.next_num + 1
		RETURNING next_num - 1`,
		subscriptionID,
	).Scan(&keyNum)
	if err != nil {
		return nil, err
	}

	// Resolve root_feature_id: if parent is set, inherit from parent; else self.
	var rootFeatureID *string
	if in.ParentID != nil {
		var rfID *string
		_ = tx.QueryRow(ctx,
			`SELECT root_feature_id FROM o_artefacts_execution_work_items WHERE id = $1`,
			*in.ParentID,
		).Scan(&rfID)
		rootFeatureID = rfID
	}

	// Initial position: append to whichever scope this row lands in.
	// Append (MAX+gap) rather than prepend so brand-new items appear
	// at the bottom of the existing order.
	var backlogPos, sprintPos *int
	if in.SprintID == nil {
		var p int
		_ = tx.QueryRow(ctx, `
			SELECT coalesce(MAX(backlog_position), 0) + 100
			FROM o_artefacts_execution_work_items
			WHERE subscription_id = $1 AND sprint_id IS NULL AND archived_at IS NULL`,
			subscriptionID,
		).Scan(&p)
		backlogPos = &p
	} else {
		var p int
		_ = tx.QueryRow(ctx, `
			SELECT coalesce(MAX(sprint_position), 0) + 100
			FROM o_artefacts_execution_work_items
			WHERE subscription_id = $1 AND sprint_id = $2 AND archived_at IS NULL`,
			subscriptionID, *in.SprintID,
		).Scan(&p)
		sprintPos = &p
	}

	// Resolve the position-1 flow state for this subscription's work_items flow.
	var defaultFlowStateID string
	err = tx.QueryRow(ctx, `
		SELECT ft.id FROM o_flow_tenant ft
		JOIN o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
		WHERE ft.subscription_id = $1
		  AND ats.scope_key = 'execution_work_items'
		  AND ft.flow_position = 1
		  AND ft.archived_at IS NULL
		LIMIT 1`,
		subscriptionID,
	).Scan(&defaultFlowStateID)
	if err != nil {
		return nil, fmt.Errorf("resolve default flow state: %w", err)
	}

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO o_artefacts_execution_work_items
			(subscription_id, key_num, item_type, title, description,
			 status, flow_state_id, priority, story_points, sprint_id, parent_id, root_feature_id,
			 owner_id, created_by, backlog_position, sprint_position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		RETURNING id`,
		subscriptionID, keyNum, in.ItemType, in.Title, in.Description,
		status, defaultFlowStateID, in.Priority, in.StoryPoints, in.SprintID, in.ParentID, rootFeatureID,
		in.OwnerID, in.CreatedBy, backlogPos, sprintPos,
	).Scan(&id)
	if err != nil {
		return nil, err
	}

	// If no parent, set root_feature_id = self.
	if in.ParentID == nil {
		_, err = tx.Exec(ctx,
			`UPDATE o_artefacts_execution_work_items SET root_feature_id = id WHERE id = $1`, id)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetWorkItem(ctx, subscriptionID, id)
}

// PatchWorkItem applies a partial update to a work item.
//
// Sprint membership transitions: when sprint_id changes, the row's
// active position column flips per the ranking convention —
//   - entering a sprint: backlog_position cleared, sprint_position set
//     to MAX(sprint_position)+gap so the row appears at the bottom of
//     the new sprint.
//   - leaving a sprint: sprint_position cleared, backlog_position set
//     to MIN(backlog_position)-gap so the row pops to the top of the
//     backlog (where freshly-released sprint work usually wants to go).
//
// All of this happens in one transaction so the table CHECK
// (exactly one of backlog_position / sprint_position non-NULL per
// scope) is never momentarily violated.
func (s *Service) PatchWorkItem(ctx context.Context, subscriptionID string, id uuid.UUID, in PatchWorkItemInput) (*WorkItem, error) {
	if in.Status != nil && !validStatuses[*in.Status] {
		return nil, fmt.Errorf("%w: invalid status", ErrInvalidInput)
	}
	if in.Priority != nil && *in.Priority != "" && !validPriorities[*in.Priority] {
		return nil, fmt.Errorf("%w: invalid priority", ErrInvalidInput)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// We need the row's item_type to gate story_points writes (tasks
	// can't carry their own points), and the current sprint_id to
	// detect a real sprint transition. Lock the row for both — the
	// MAX/MIN computed below for sprint moves must not race another
	// mover. Skip the read entirely when neither field is in the patch
	// to avoid an extra round-trip on hot paths (status/priority
	// toggles).
	var currentSprintID *string
	var currentItemType string
	sprintChanging := false
	needsRowRead := in.SprintID != nil || in.StoryPoints != nil
	if needsRowRead {
		var cur *string
		err := tx.QueryRow(ctx, `
			SELECT sprint_id::text, item_type
			FROM o_artefacts_execution_work_items
			WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
			FOR UPDATE`,
			id, subscriptionID,
		).Scan(&cur, &currentItemType)
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		currentSprintID = cur
		if in.SprintID != nil {
			// Treat "" in the patch as "move to backlog (no sprint)".
			newVal := *in.SprintID
			oldVal := ""
			if cur != nil {
				oldVal = *cur
			}
			sprintChanging = newVal != oldVal
		}
		if in.StoryPoints != nil && !canHaveManualPoints(currentItemType) {
			return nil, fmt.Errorf("%w: story_points cannot be set on %s items", ErrInvalidInput, currentItemType)
		}
	}

	sets := []string{"updated_at = now()"}
	args := []any{}
	n := 1

	if in.Title != nil {
		sets = append(sets, fmt.Sprintf("title = $%d", n))
		args = append(args, *in.Title)
		n++
	}
	if in.Description != nil {
		sets = append(sets, fmt.Sprintf("description = $%d", n))
		args = append(args, *in.Description)
		n++
	}
	if in.Status != nil {
		sets = append(sets, fmt.Sprintf("status = $%d", n))
		args = append(args, *in.Status)
		n++
	}
	if in.FlowStateID != nil {
		// Validate the flow state belongs to this subscription before writing.
		var fsSub string
		err := tx.QueryRow(ctx,
			`SELECT subscription_id FROM o_flow_tenant WHERE id = $1 AND archived_at IS NULL`,
			*in.FlowStateID,
		).Scan(&fsSub)
		if err != nil {
			return nil, fmt.Errorf("%w: flow_state_id not found", ErrInvalidInput)
		}
		if fsSub != subscriptionID {
			return nil, fmt.Errorf("%w: flow_state_id belongs to a different subscription", ErrInvalidInput)
		}
		sets = append(sets, fmt.Sprintf("flow_state_id = $%d", n))
		args = append(args, *in.FlowStateID)
		n++
	}
	if in.Priority != nil {
		sets = append(sets, fmt.Sprintf("priority = $%d", n))
		args = append(args, *in.Priority)
		n++
	}
	if in.StoryPoints != nil {
		sets = append(sets, fmt.Sprintf("story_points = $%d", n))
		args = append(args, *in.StoryPoints)
		n++
	}
	if in.SprintID != nil {
		sets = append(sets, fmt.Sprintf("sprint_id = $%d", n))
		if *in.SprintID == "" {
			args = append(args, nil)
		} else {
			args = append(args, *in.SprintID)
		}
		n++
	}

	if sprintChanging {
		// Compute and write new position columns in the same UPDATE.
		// gap=100 matches ranking.defaultGap; the rank service will
		// rebalance later if neighbours collide.
		if *in.SprintID == "" {
			// leaving sprint → top of backlog
			sets = append(sets, "sprint_position = NULL")
			sets = append(sets, fmt.Sprintf(
				`backlog_position = (
					SELECT coalesce(MIN(backlog_position), 100) - 100
					FROM o_artefacts_execution_work_items
					WHERE subscription_id = $%d AND sprint_id IS NULL AND archived_at IS NULL
				)`, n))
			args = append(args, subscriptionID)
			n++
		} else {
			// entering sprint → bottom of that sprint
			sets = append(sets, "backlog_position = NULL")
			sets = append(sets, fmt.Sprintf(
				`sprint_position = (
					SELECT coalesce(MAX(sprint_position), 0) + 100
					FROM o_artefacts_execution_work_items
					WHERE subscription_id = $%d AND sprint_id = $%d AND archived_at IS NULL
				)`, n, n+1))
			args = append(args, subscriptionID, *in.SprintID)
			n += 2
		}
	}
	_ = currentSprintID // reserved for richer transition logic

	args = append(args, id, subscriptionID)
	q := fmt.Sprintf(`
		UPDATE o_artefacts_execution_work_items
		SET %s
		WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`,
		strings.Join(sets, ", "), n, n+1,
	)
	ct, err := tx.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetWorkItem(ctx, subscriptionID, id)
}

// ArchiveWorkItem soft-deletes a work item by setting archived_at.
func (s *Service) ArchiveWorkItem(ctx context.Context, subscriptionID string, id uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE o_artefacts_execution_work_items
		SET archived_at = now(), updated_at = now()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListChildren returns direct children of the given parent work item.
func (s *Service) ListChildren(ctx context.Context, subscriptionID string, parentID uuid.UUID) ([]WorkItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT wi.id, wi.subscription_id, wi.key_num, wi.item_type, wi.title, wi.description,
		       wi.status, coalesce(wi.flow_state_id::text, ''), coalesce(fs.name, ''), coalesce(fs.canonical_code, ''),
		       wi.priority, wi.story_points, wi.sprint_id, wi.parent_id, wi.root_feature_id,
		       wi.owner_id, wi.created_by, wi.created_at, wi.updated_at, wi.archived_at,
		       (SELECT COUNT(*) FROM o_artefacts_execution_work_items c
		        WHERE c.parent_id = wi.id AND c.archived_at IS NULL) AS children_count,
		       `+rollupPointsExpr+` AS rollup_points
		FROM o_artefacts_execution_work_items wi
		LEFT JOIN o_flow_tenant fs ON fs.id = wi.flow_state_id
		WHERE wi.subscription_id = $1 AND wi.parent_id = $2 AND wi.archived_at IS NULL
		ORDER BY coalesce(wi.sprint_position, wi.backlog_position) NULLS LAST, wi.key_num ASC`,
		subscriptionID, parentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWorkItems(rows)
}

// ─── Sprints ─────────────────────────────────────────────────────────────────

// ListSprints returns all non-archived sprints for the subscription.
func (s *Service) ListSprints(ctx context.Context, subscriptionID string) ([]Sprint, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, subscription_id, name, goal, start_date, end_date,
		       status, created_by, created_at, updated_at, archived_at
		FROM sprints
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY created_at ASC`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSprints(rows)
}

// GetSprint returns a single sprint by ID.
func (s *Service) GetSprint(ctx context.Context, subscriptionID string, id uuid.UUID) (*Sprint, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, subscription_id, name, goal, start_date, end_date,
		       status, created_by, created_at, updated_at, archived_at
		FROM sprints
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	sp, err := scanSprint(row)
	if err == pgx.ErrNoRows {
		return nil, ErrSprintNotFound
	}
	return sp, err
}

// CreateSprint inserts a new sprint row.
func (s *Service) CreateSprint(ctx context.Context, subscriptionID string, in CreateSprintInput) (*Sprint, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sprints (subscription_id, name, goal, start_date, end_date, status, created_by)
		VALUES ($1, $2, $3, $4, $5, 'planned', $6)
		RETURNING id`,
		subscriptionID, in.Name, in.Goal, in.StartDate, in.EndDate, in.CreatedBy,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetSprint(ctx, subscriptionID, id)
}

// PatchSprint applies a partial update to a sprint.
func (s *Service) PatchSprint(ctx context.Context, subscriptionID string, id uuid.UUID, in PatchSprintInput) (*Sprint, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	n := 1

	if in.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", n))
		args = append(args, *in.Name)
		n++
	}
	if in.Goal != nil {
		sets = append(sets, fmt.Sprintf("goal = $%d", n))
		args = append(args, *in.Goal)
		n++
	}
	if in.StartDate != nil {
		sets = append(sets, fmt.Sprintf("start_date = $%d", n))
		args = append(args, *in.StartDate)
		n++
	}
	if in.EndDate != nil {
		sets = append(sets, fmt.Sprintf("end_date = $%d", n))
		args = append(args, *in.EndDate)
		n++
	}
	if in.Status != nil {
		if !validSprintStatuses[*in.Status] {
			return nil, fmt.Errorf("%w: invalid sprint status", ErrInvalidInput)
		}
		// Enforce single active sprint per subscription.
		if *in.Status == "active" {
			var count int
			_ = s.pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM sprints WHERE subscription_id = $1 AND status = 'active' AND id != $2 AND archived_at IS NULL`,
				subscriptionID, id,
			).Scan(&count)
			if count > 0 {
				return nil, fmt.Errorf("%w: another sprint is already active", ErrConflict)
			}
		}
		sets = append(sets, fmt.Sprintf("status = $%d", n))
		args = append(args, *in.Status)
		n++
	}

	args = append(args, id, subscriptionID)
	q := fmt.Sprintf(`
		UPDATE sprints SET %s
		WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`,
		strings.Join(sets, ", "), n, n+1,
	)
	ct, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrSprintNotFound
	}
	return s.GetSprint(ctx, subscriptionID, id)
}

// ArchiveSprint soft-deletes a sprint.
func (s *Service) ArchiveSprint(ctx context.Context, subscriptionID string, id uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE sprints SET archived_at = now(), updated_at = now()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrSprintNotFound
	}
	return nil
}

// ─── Custom Field Library ─────────────────────────────────────────────────────

// ListCustomFields returns all non-archived entries in the field library.
func (s *Service) ListCustomFields(ctx context.Context, subscriptionID string) ([]CustomField, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, subscription_id, field_name, label, type, options_json, config_json,
		       created_by, created_at, updated_at, archived_at
		FROM o_execution_custom_field_library
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY field_name ASC`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCustomFields(rows)
}

// GetCustomField returns a single library entry by ID.
func (s *Service) GetCustomField(ctx context.Context, subscriptionID string, id uuid.UUID) (*CustomField, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, subscription_id, field_name, label, type, options_json, config_json,
		       created_by, created_at, updated_at, archived_at
		FROM o_execution_custom_field_library
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	cf, err := scanCustomField(row)
	if err == pgx.ErrNoRows {
		return nil, ErrFieldNotFound
	}
	return cf, err
}

// CreateCustomField inserts a new library entry. field_name must be unique per subscription.
func (s *Service) CreateCustomField(ctx context.Context, subscriptionID string, in CreateCustomFieldInput) (*CustomField, error) {
	if strings.TrimSpace(in.FieldName) == "" {
		return nil, fmt.Errorf("%w: field_name is required", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Label) == "" {
		return nil, fmt.Errorf("%w: label is required", ErrInvalidInput)
	}
	if !validFieldTypes[in.Type] {
		return nil, fmt.Errorf("%w: invalid field type", ErrInvalidInput)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO o_execution_custom_field_library
			(subscription_id, field_name, label, type, options_json, config_json, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id`,
		subscriptionID, in.FieldName, in.Label, in.Type, in.OptionsJSON, in.ConfigJSON, in.CreatedBy,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, fmt.Errorf("%w: field_name already exists in this workspace", ErrConflict)
		}
		return nil, err
	}
	return s.GetCustomField(ctx, subscriptionID, id)
}

// PatchCustomField updates label/options/config — field_name is immutable.
func (s *Service) PatchCustomField(ctx context.Context, subscriptionID string, id uuid.UUID, in PatchCustomFieldInput) (*CustomField, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	n := 1

	if in.Label != nil {
		sets = append(sets, fmt.Sprintf("label = $%d", n))
		args = append(args, *in.Label)
		n++
	}
	if in.OptionsJSON != nil {
		sets = append(sets, fmt.Sprintf("options_json = $%d", n))
		args = append(args, *in.OptionsJSON)
		n++
	}
	if in.ConfigJSON != nil {
		sets = append(sets, fmt.Sprintf("config_json = $%d", n))
		args = append(args, *in.ConfigJSON)
		n++
	}

	args = append(args, id, subscriptionID)
	q := fmt.Sprintf(`
		UPDATE o_execution_custom_field_library SET %s
		WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`,
		strings.Join(sets, ", "), n, n+1,
	)
	ct, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrFieldNotFound
	}
	return s.GetCustomField(ctx, subscriptionID, id)
}

// ArchiveCustomField soft-deletes a library entry.
func (s *Service) ArchiveCustomField(ctx context.Context, subscriptionID string, id uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE o_execution_custom_field_library SET archived_at = now(), updated_at = now()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrFieldNotFound
	}
	return nil
}

// ─── Templates ───────────────────────────────────────────────────────────────

// ListTemplates returns all non-archived templates.
func (s *Service) ListTemplates(ctx context.Context, subscriptionID string) ([]Template, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, subscription_id, name, description, item_type,
		       created_by, created_at, updated_at, archived_at
		FROM o_execution_work_item_templates
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY name ASC`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var templates []Template
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.ID, &t.SubscriptionID, &t.Name, &t.Description, &t.ItemType,
			&t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.ArchivedAt); err != nil {
			return nil, err
		}
		templates = append(templates, t)
	}
	return templates, rows.Err()
}

// GetTemplate returns a template with its ordered fields joined.
func (s *Service) GetTemplate(ctx context.Context, subscriptionID string, id uuid.UUID) (*Template, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, subscription_id, name, description, item_type,
		       created_by, created_at, updated_at, archived_at
		FROM o_execution_work_item_templates
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	var t Template
	if err := row.Scan(&t.ID, &t.SubscriptionID, &t.Name, &t.Description, &t.ItemType,
		&t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.ArchivedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTemplateNotFound
		}
		return nil, err
	}

	// Load ordered fields.
	frows, err := s.pool.Query(ctx, `
		SELECT f.id, f.template_id, f.field_library_id, l.field_name, l.label, l.type,
		       f.position, f.required, f.default_value
		FROM o_execution_work_item_template_fields f
		JOIN o_execution_custom_field_library l ON l.id = f.field_library_id
		WHERE f.template_id = $1
		ORDER BY f.position ASC`,
		id,
	)
	if err != nil {
		return nil, err
	}
	defer frows.Close()
	for frows.Next() {
		var tf TemplateField
		if err := frows.Scan(&tf.ID, &tf.TemplateID, &tf.FieldLibraryID, &tf.FieldName, &tf.Label,
			&tf.FieldType, &tf.Position, &tf.Required, &tf.DefaultValue); err != nil {
			return nil, err
		}
		t.Fields = append(t.Fields, tf)
	}
	return &t, frows.Err()
}

// CreateTemplate inserts a new template.
func (s *Service) CreateTemplate(ctx context.Context, subscriptionID string, in CreateTemplateInput) (*Template, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO o_execution_work_item_templates
			(subscription_id, name, description, item_type, created_by)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id`,
		subscriptionID, in.Name, in.Description, in.ItemType, in.CreatedBy,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, fmt.Errorf("%w: template name already exists", ErrConflict)
		}
		return nil, err
	}
	return s.GetTemplate(ctx, subscriptionID, id)
}

// AddTemplateField adds a field slot to a template.
func (s *Service) AddTemplateField(ctx context.Context, templateID uuid.UUID, in AddTemplateFieldInput) (*TemplateField, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO o_execution_work_item_template_fields
			(template_id, field_library_id, position, required, default_value)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id`,
		templateID, in.FieldLibraryID, in.Position, in.Required, in.DefaultValue,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, fmt.Errorf("%w: field already in template", ErrConflict)
		}
		return nil, err
	}

	row := s.pool.QueryRow(ctx, `
		SELECT f.id, f.template_id, f.field_library_id, l.field_name, l.label, l.type,
		       f.position, f.required, f.default_value
		FROM o_execution_work_item_template_fields f
		JOIN o_execution_custom_field_library l ON l.id = f.field_library_id
		WHERE f.id = $1`, id,
	)
	var tf TemplateField
	if err := row.Scan(&tf.ID, &tf.TemplateID, &tf.FieldLibraryID, &tf.FieldName, &tf.Label,
		&tf.FieldType, &tf.Position, &tf.Required, &tf.DefaultValue); err != nil {
		return nil, err
	}
	return &tf, nil
}

// RemoveTemplateField removes a field slot from a template.
func (s *Service) RemoveTemplateField(ctx context.Context, fieldID uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM o_execution_work_item_template_fields WHERE id = $1`, fieldID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrFieldNotFound
	}
	return nil
}

// ─── Field Values ─────────────────────────────────────────────────────────────

// ListFieldValues returns all field_values for a work item joined with library metadata.
func (s *Service) ListFieldValues(ctx context.Context, subscriptionID string, workItemID uuid.UUID) ([]FieldValue, error) {
	// Ensure work item belongs to subscription.
	if _, err := s.GetWorkItem(ctx, subscriptionID, workItemID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT fv.id, fv.work_item_id, fv.field_library_id, fv.template_id,
		       l.field_name, l.label, l.type, l.options_json,
		       fv.string_value, fv.number_value, fv.text_value, fv.date_value
		FROM o_artefacts_execution_work_items_field_values fv
		JOIN o_execution_custom_field_library l ON l.id = fv.field_library_id
		WHERE fv.work_item_id = $1
		ORDER BY l.field_name ASC`,
		workItemID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fvs []FieldValue
	for rows.Next() {
		var fv FieldValue
		if err := rows.Scan(&fv.ID, &fv.WorkItemID, &fv.FieldLibraryID, &fv.TemplateID,
			&fv.FieldName, &fv.Label, &fv.FieldType, &fv.OptionsJSON,
			&fv.StringValue, &fv.NumberValue, &fv.TextValue, &fv.DateValue); err != nil {
			return nil, err
		}
		fvs = append(fvs, fv)
	}
	return fvs, rows.Err()
}

// UpsertFieldValue writes a single field value for a work item, enforcing type routing.
func (s *Service) UpsertFieldValue(ctx context.Context, subscriptionID string, workItemID uuid.UUID, in UpsertFieldValueInput) error {
	// Ensure work item belongs to subscription.
	if _, err := s.GetWorkItem(ctx, subscriptionID, workItemID); err != nil {
		return err
	}

	// Load the field from library to determine type.
	fieldID, err := uuid.Parse(in.FieldLibraryID)
	if err != nil {
		return fmt.Errorf("%w: invalid field_library_id", ErrInvalidInput)
	}
	cf, err := s.GetCustomField(ctx, subscriptionID, fieldID)
	if err != nil {
		return err
	}

	// Enforce type routing: exactly one value column must be set, matching the field type.
	expectedCol := typeValueColumn(cf.Type)
	var provided []string
	if in.StringValue != nil {
		provided = append(provided, "string_value")
	}
	if in.NumberValue != nil {
		provided = append(provided, "number_value")
	}
	if in.TextValue != nil {
		provided = append(provided, "text_value")
	}
	if in.DateValue != nil {
		provided = append(provided, "date_value")
	}
	if len(provided) == 1 && provided[0] != expectedCol {
		return fmt.Errorf("%w: field type %q requires %s, got %s", ErrWrongValueColumn, cf.Type, expectedCol, provided[0])
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO o_artefacts_execution_work_items_field_values
			(work_item_id, field_library_id, string_value, number_value, text_value, date_value)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (work_item_id, field_library_id)
		DO UPDATE SET
			string_value = EXCLUDED.string_value,
			number_value = EXCLUDED.number_value,
			text_value   = EXCLUDED.text_value,
			date_value   = EXCLUDED.date_value`,
		workItemID, in.FieldLibraryID, in.StringValue, in.NumberValue, in.TextValue, in.DateValue,
	)
	return err
}

// DeleteFieldValue removes a field value row.
func (s *Service) DeleteFieldValue(ctx context.Context, subscriptionID string, workItemID, fvID uuid.UUID) error {
	if _, err := s.GetWorkItem(ctx, subscriptionID, workItemID); err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx,
		`DELETE FROM o_artefacts_execution_work_items_field_values WHERE id = $1 AND work_item_id = $2`,
		fvID, workItemID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrFieldNotFound
	}
	return nil
}

// ─── Scan helpers ─────────────────────────────────────────────────────────────

type scannable interface {
	Scan(dest ...any) error
}

func scanWorkItem(row scannable) (*WorkItem, error) {
	var wi WorkItem
	err := row.Scan(
		&wi.ID, &wi.SubscriptionID, &wi.KeyNum, &wi.ItemType, &wi.Title, &wi.Description,
		&wi.Status, &wi.FlowStateID, &wi.FlowStateName, &wi.FlowStateCode,
		&wi.Priority, &wi.StoryPoints, &wi.SprintID, &wi.ParentID, &wi.RootFeatureID,
		&wi.OwnerID, &wi.CreatedBy, &wi.CreatedAt, &wi.UpdatedAt, &wi.ArchivedAt,
		&wi.ChildrenCount, &wi.RollupPoints,
	)
	if err != nil {
		return nil, err
	}
	return &wi, nil
}

func scanWorkItems(rows pgx.Rows) ([]WorkItem, error) {
	var items []WorkItem
	for rows.Next() {
		wi, err := scanWorkItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *wi)
	}
	if items == nil {
		items = []WorkItem{}
	}
	return items, rows.Err()
}

func scanSprint(row scannable) (*Sprint, error) {
	var sp Sprint
	var startDate, endDate *time.Time
	err := row.Scan(
		&sp.ID, &sp.SubscriptionID, &sp.Name, &sp.Goal, &startDate, &endDate,
		&sp.Status, &sp.CreatedBy, &sp.CreatedAt, &sp.UpdatedAt, &sp.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	if startDate != nil {
		s := startDate.Format("2006-01-02")
		sp.StartDate = &s
	}
	if endDate != nil {
		e := endDate.Format("2006-01-02")
		sp.EndDate = &e
	}
	return &sp, nil
}

func scanSprints(rows pgx.Rows) ([]Sprint, error) {
	var sprints []Sprint
	for rows.Next() {
		sp, err := scanSprint(rows)
		if err != nil {
			return nil, err
		}
		sprints = append(sprints, *sp)
	}
	if sprints == nil {
		sprints = []Sprint{}
	}
	return sprints, rows.Err()
}

func scanCustomField(row scannable) (*CustomField, error) {
	var cf CustomField
	err := row.Scan(
		&cf.ID, &cf.SubscriptionID, &cf.FieldName, &cf.Label, &cf.Type,
		&cf.OptionsJSON, &cf.ConfigJSON, &cf.CreatedBy, &cf.CreatedAt, &cf.UpdatedAt, &cf.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cf, nil
}

func scanCustomFields(rows pgx.Rows) ([]CustomField, error) {
	var fields []CustomField
	for rows.Next() {
		cf, err := scanCustomField(rows)
		if err != nil {
			return nil, err
		}
		fields = append(fields, *cf)
	}
	if fields == nil {
		fields = []CustomField{}
	}
	return fields, rows.Err()
}

// ListFlowStates returns the ordered flow states for the execution_work_items
// flow scoped to the subscription. Used by the frontend Status dropdown without
// requiring flows.manage permission.
func (s *Service) ListFlowStates(ctx context.Context, subscriptionID string) ([]WorkItemFlowState, error) {
	const q = `
		SELECT ft.id, ft.flow_position, ft.name, ft.canonical_code
		FROM   o_flow_tenant ft
		JOIN   o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
		WHERE  ft.subscription_id = $1
		  AND  ats.scope_key = 'execution_work_items'
		  AND  ft.archived_at IS NULL
		ORDER  BY ft.flow_position`

	rows, err := s.pool.Query(ctx, q, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []WorkItemFlowState
	for rows.Next() {
		var st WorkItemFlowState
		if err := rows.Scan(&st.ID, &st.Position, &st.Name, &st.CanonicalCode); err != nil {
			return nil, err
		}
		states = append(states, st)
	}
	if states == nil {
		states = []WorkItemFlowState{}
	}
	return states, rows.Err()
}
