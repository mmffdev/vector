package workitemsv2

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns all DB operations for the v2 work-items domain.
// vectorArtefactsPool reads from vector_artefacts; mainPool reads from
// mmff_vector (owner decoration cross-DB lookup). Either may be nil.
type Service struct {
	vectorArtefactsPool *pgxpool.Pool
	mainPool            *pgxpool.Pool
}

// NewService creates a Service backed by the given pools.
// vaPool may be nil when VECTOR_ARTEFACTS_DB_URL is unset; mainPool may be
// nil (owner decoration is skipped and Owner stays nil on every item).
func NewService(vaPool, mainPool *pgxpool.Pool) *Service {
	return &Service{vectorArtefactsPool: vaPool, mainPool: mainPool}
}

// rollupCTE is the WITH RECURSIVE expression retargeted to
// vector_artefacts.artefacts. Structure is identical to v1's
// rollupPointsExpr except:
//   - table name    : artefacts (not obj_work_items)
//   - parent column : parent_artefact_id (not parent_id)
//   - points column : story_points (same name, just confirming)
//
// The CTE is used in both the data query and the count query so
// Postgres only walks the tree once per query plan.
const rollupCTE = `rollup_points AS (
	SELECT
		a.id,
		CASE WHEN EXISTS (
			SELECT 1 FROM artefacts c
			WHERE c.parent_artefact_id = a.id AND c.archived_at IS NULL
		) THEN (
			WITH RECURSIVE descendants AS (
				SELECT id, story_points
				FROM artefacts
				WHERE parent_artefact_id = a.id AND archived_at IS NULL
				UNION ALL
				SELECT child.id, child.story_points
				FROM artefacts child
				JOIN descendants d ON child.parent_artefact_id = d.id
				WHERE child.archived_at IS NULL
			)
			SELECT COALESCE(SUM(story_points), 0) FROM descendants
		) ELSE NULL END AS rollup_points
	FROM artefacts a
	WHERE a.subscription_id = $1
	  AND a.archived_at IS NULL
)`

// ListWorkItems returns work items from vector_artefacts for the given
// subscription. Filters and ORDER BY are applied dynamically; LIMIT/OFFSET
// provide pagination. Returns an empty slice (not nil) when the pool is nil.
func (s *Service) ListWorkItems(ctx context.Context, subscriptionID uuid.UUID, filters Filters) (items []WorkItem, total int, err error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItem{}, 0, nil
	}

	// Cap limit (matches v1 service behaviour).
	lim := filters.Limit
	if lim <= 0 {
		lim = 50
	} else if lim > 5000 {
		lim = 5000
	}

	// ── dynamic WHERE ────────────────────────────────────────────────────────
	// $1 = subscriptionID (always). Extra conditions start at $2.
	args := []any{subscriptionID}
	n := 2
	var extra []string

	if filters.ParentID != nil {
		extra = append(extra, fmt.Sprintf("a.parent_artefact_id = $%d::uuid", n))
		args = append(args, *filters.ParentID)
		n++
	} else if filters.ItemType == nil {
		// Default: top-level items only (mirrors v1 ListWorkItems default).
		extra = append(extra, "a.parent_artefact_id IS NULL")
	}
	if filters.ItemType != nil {
		extra = append(extra, fmt.Sprintf("lower(at.name) = $%d", n))
		args = append(args, *filters.ItemType)
		n++
	}
	if filters.Status != nil {
		extra = append(extra, fmt.Sprintf("fs.kind = $%d", n))
		args = append(args, statusToFlowKind(*filters.Status))
		n++
	}
	if filters.Priority != nil {
		extra = append(extra, fmt.Sprintf("a.priority = $%d", n))
		args = append(args, *filters.Priority)
		n++
	}
	if filters.SprintID != nil {
		extra = append(extra, fmt.Sprintf("a.sprint_id = $%d::uuid", n))
		args = append(args, *filters.SprintID)
		n++
	}
	if filters.OwnerID != nil {
		extra = append(extra, fmt.Sprintf("a.owned_by_user_id = $%d::uuid", n))
		args = append(args, *filters.OwnerID)
		n++
	}

	extraWhere := ""
	if len(extra) > 0 {
		extraWhere = "\n  AND " + strings.Join(extra, "\n  AND ")
	}

	orderBy := buildOrderBy(filters.Sort, filters.Dir)

	// ── count query (no rollupCTE, no LIMIT/OFFSET) ───────────────────────────
	countQ := `
		SELECT count(*) FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'` + extraWhere

	if err = s.vectorArtefactsPool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// ── data query ───────────────────────────────────────────────────────────
	limitN := n
	offsetN := n + 1
	dataArgs := append(args, lim, filters.Offset)

	dataQ := `
		WITH ` + rollupCTE + `
		SELECT
			a.id::text,
			a.subscription_id::text,
			a.number                        AS key_num,
			lower(at.name)                  AS item_type,
			a.title,
			a.description,
			''                              AS status,
			COALESCE(fs.id::text, '')        AS flow_state_id,
			COALESCE(fs.name, '')            AS flow_state_name,
			CASE fs.kind
				WHEN 'todo'        THEN 'backlog'
				WHEN 'in_progress' THEN 'doing'
				WHEN 'done'        THEN 'completed'
				WHEN 'cancelled'   THEN 'cancelled'
				ELSE                    'backlog'
			END                             AS flow_state_code,
			a.priority,
			a.story_points,
			a.sprint_id::text,
			NULL::text                      AS sprint_ref_id,
			NULL::text                      AS sprint_ref_alias,
			a.parent_artefact_id::text      AS parent_id,
			NULL::text                      AS root_feature_id,
			COALESCE(a.owned_by_user_id::text, '') AS owner_id,
			NULL::text                      AS owner_ref_id,
			NULL::text                      AS owner_display_name,
			NULL::text                      AS owner_avatar_url,
			a.due_date::text,
			COALESCE(a.created_by_user_id::text, '') AS created_by,
			a.created_at,
			a.updated_at,
			a.archived_at,
			(SELECT count(*) FROM artefacts child
			 WHERE child.parent_artefact_id = a.id
			   AND child.archived_at IS NULL)        AS children_count,
			COALESCE(rp.rollup_points, a.story_points) AS rollup_points
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'` + extraWhere + `
		ORDER BY ` + orderBy + fmt.Sprintf(`
		LIMIT $%d OFFSET $%d`, limitN, offsetN)

	rows, err := s.vectorArtefactsPool.Query(ctx, dataQ, dataArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items, err = scanWorkItemRows(rows)
	if err != nil {
		return nil, 0, err
	}

	if err = s.decorateOwners(ctx, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// GetWorkItem returns a single work item by ID enforcing subscription isolation.
// Returns ErrNotFound when the row does not exist or belongs to another tenant.
func (s *Service) GetWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	row := s.vectorArtefactsPool.QueryRow(ctx, `
		WITH `+rollupCTE+`
		SELECT
			a.id::text,
			a.subscription_id::text,
			a.number                        AS key_num,
			lower(at.name)                  AS item_type,
			a.title,
			a.description,
			''                              AS status,
			COALESCE(fs.id::text, '')        AS flow_state_id,
			COALESCE(fs.name, '')            AS flow_state_name,
			CASE fs.kind
				WHEN 'todo'        THEN 'backlog'
				WHEN 'in_progress' THEN 'doing'
				WHEN 'done'        THEN 'completed'
				WHEN 'cancelled'   THEN 'cancelled'
				ELSE                    'backlog'
			END                             AS flow_state_code,
			a.priority,
			a.story_points,
			a.sprint_id::text,
			NULL::text                      AS sprint_ref_id,
			NULL::text                      AS sprint_ref_alias,
			a.parent_artefact_id::text      AS parent_id,
			NULL::text                      AS root_feature_id,
			COALESCE(a.owned_by_user_id::text, '') AS owner_id,
			NULL::text                      AS owner_ref_id,
			NULL::text                      AS owner_display_name,
			NULL::text                      AS owner_avatar_url,
			a.due_date::text,
			COALESCE(a.created_by_user_id::text, '') AS created_by,
			a.created_at,
			a.updated_at,
			a.archived_at,
			(SELECT count(*) FROM artefacts child
			 WHERE child.parent_artefact_id = a.id
			   AND child.archived_at IS NULL)        AS children_count,
			COALESCE(rp.rollup_points, a.story_points) AS rollup_points
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.id = $2
		  AND a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'`,
		subscriptionID, id,
	)
	wi, err := scanWorkItemRow(row)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items := []WorkItem{*wi}
	if err := s.decorateOwners(ctx, items); err != nil {
		return nil, err
	}
	wi = &items[0]
	return wi, nil
}

// ListChildren returns direct children of parentID scoped to the subscription.
func (s *Service) ListChildren(ctx context.Context, subscriptionID uuid.UUID, parentID uuid.UUID) ([]WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItem{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		WITH `+rollupCTE+`
		SELECT
			a.id::text,
			a.subscription_id::text,
			a.number                        AS key_num,
			lower(at.name)                  AS item_type,
			a.title,
			a.description,
			''                              AS status,
			COALESCE(fs.id::text, '')        AS flow_state_id,
			COALESCE(fs.name, '')            AS flow_state_name,
			CASE fs.kind
				WHEN 'todo'        THEN 'backlog'
				WHEN 'in_progress' THEN 'doing'
				WHEN 'done'        THEN 'completed'
				WHEN 'cancelled'   THEN 'cancelled'
				ELSE                    'backlog'
			END                             AS flow_state_code,
			a.priority,
			a.story_points,
			a.sprint_id::text,
			NULL::text                      AS sprint_ref_id,
			NULL::text                      AS sprint_ref_alias,
			a.parent_artefact_id::text      AS parent_id,
			NULL::text                      AS root_feature_id,
			COALESCE(a.owned_by_user_id::text, '') AS owner_id,
			NULL::text                      AS owner_ref_id,
			NULL::text                      AS owner_display_name,
			NULL::text                      AS owner_avatar_url,
			a.due_date::text,
			COALESCE(a.created_by_user_id::text, '') AS created_by,
			a.created_at,
			a.updated_at,
			a.archived_at,
			(SELECT count(*) FROM artefacts child
			 WHERE child.parent_artefact_id = a.id
			   AND child.archived_at IS NULL)        AS children_count,
			COALESCE(rp.rollup_points, a.story_points) AS rollup_points
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.parent_artefact_id = $2
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'
		ORDER BY a.position ASC, a.number ASC`,
		subscriptionID, parentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanWorkItemRows(rows)
	if err != nil {
		return nil, err
	}
	if err := s.decorateOwners(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

// SummariseWorkItems returns counts for the Page Summary Header strip.
// Optional sprintID narrows counts to items in that sprint.
func (s *Service) SummariseWorkItems(ctx context.Context, subscriptionID uuid.UUID, sprintID *string) (WorkItemsSummary, error) {
	if s.vectorArtefactsPool == nil {
		return WorkItemsSummary{}, nil
	}
	args := []any{subscriptionID}
	conds := []string{
		"a.subscription_id = $1",
		"a.archived_at IS NULL",
		"at.scope = 'work'",
	}
	n := 2
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("a.sprint_id = $%d::uuid", n))
		args = append(args, *sprintID)
		n++
	}
	_ = n
	q := fmt.Sprintf(`
		SELECT
			COUNT(*)                                               AS total,
			COUNT(*) FILTER (WHERE lower(at.name) = 'epic')        AS epics,
			COUNT(*) FILTER (WHERE lower(at.name) = 'story')       AS stories,
			COUNT(*) FILTER (WHERE lower(at.name) = 'task')        AS tasks,
			COUNT(*) FILTER (WHERE lower(at.name) = 'defect')      AS defects,
			COUNT(*) FILTER (
				WHERE (fs.kind = 'todo' OR fs.id IS NULL)
				  AND a.updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		WHERE %s`,
		strings.Join(conds, " AND "),
	)
	var out WorkItemsSummary
	if err := s.vectorArtefactsPool.QueryRow(ctx, q, args...).Scan(
		&out.Total, &out.Epics, &out.Stories, &out.Tasks, &out.Defects, &out.Blocked,
	); err != nil {
		return WorkItemsSummary{}, err
	}
	return out, nil
}

// ListFlowStates returns the flow states for the work artefact type belonging
// to the subscription. Queries flow_states via the default flow for the
// first work-scoped artefact_type owned by this subscription.
func (s *Service) ListFlowStates(ctx context.Context, subscriptionID uuid.UUID) ([]WorkItemFlowState, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItemFlowState{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		SELECT fs.id, fs.sort_order, fs.name, fs.kind
		FROM flow_states fs
		JOIN flows f ON f.id = fs.flow_id
		JOIN artefact_types at ON at.id = f.artefact_type_id
		WHERE at.subscription_id = $1
		  AND at.scope = 'work'
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.archived_at IS NULL
		ORDER BY fs.sort_order ASC`,
		subscriptionID,
	)
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

// decorateOwners fetches display names for all unique owner UUIDs in items
// from mmff_vector.users (mainPool) and populates wi.Owner on each row.
// Skipped silently when mainPool is nil or no items have an owner set.
func (s *Service) decorateOwners(ctx context.Context, items []WorkItem) error {
	if s.mainPool == nil || len(items) == 0 {
		return nil
	}

	// Collect unique non-empty owner IDs.
	seen := make(map[string]struct{})
	for _, wi := range items {
		if wi.OwnerID != "" {
			seen[wi.OwnerID] = struct{}{}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}

	uRows, err := s.mainPool.Query(ctx, `
		SELECT id::text,
		       COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email)
		FROM users
		WHERE id::text = ANY($1)
		  AND is_active = true`, ids)
	if err != nil {
		return err
	}
	defer uRows.Close()

	ownerMap := make(map[string]string, len(ids))
	for uRows.Next() {
		var id, dn string
		if err = uRows.Scan(&id, &dn); err != nil {
			return err
		}
		ownerMap[id] = dn
	}
	if err = uRows.Err(); err != nil {
		return err
	}

	for i := range items {
		if dn, ok := ownerMap[items[i].OwnerID]; ok {
			items[i].Owner = &OwnerRef{ID: items[i].OwnerID, DisplayName: dn}
		}
	}
	return nil
}

// statusToFlowKind maps both v1 status vocabulary (open/in_progress/done/cancelled)
// and v2 flow_state_code vocabulary (backlog/doing/completed/cancelled) to the
// flow_states.kind column value used in the v2 schema.
func statusToFlowKind(status string) string {
	switch status {
	case "open", "backlog":
		return "todo"
	case "in_progress", "doing":
		return "in_progress"
	case "done", "completed":
		return "done"
	case "cancelled":
		return "cancelled"
	default:
		return status
	}
}

// buildOrderBy returns the ORDER BY clause for the data query.
// sort keys mirror the v1 frontend SortKey union; dir is clamped to ASC/DESC.
func buildOrderBy(sort, dir string) string {
	if sort == "" {
		return "a.position ASC, a.number ASC"
	}
	d := "ASC"
	if dir == "desc" {
		d = "DESC"
	}
	switch sort {
	case "item_type":
		return fmt.Sprintf(`CASE lower(at.name)
			WHEN 'epic' THEN 1 WHEN 'story' THEN 2
			WHEN 'defect' THEN 3 WHEN 'task' THEN 4
			ELSE 99 END ASC, a.number %s`, d)
	case "title":
		return fmt.Sprintf("a.title %s, a.number ASC", d)
	case "status":
		return fmt.Sprintf("fs.sort_order %s NULLS LAST, a.number ASC", d)
	case "priority":
		return fmt.Sprintf(`CASE a.priority
			WHEN 'critical' THEN 1 WHEN 'high' THEN 2
			WHEN 'medium' THEN 3 WHEN 'low' THEN 4
			ELSE 99 END %s, a.number ASC`, d)
	case "points":
		return fmt.Sprintf("COALESCE(rp.rollup_points, a.story_points) %s NULLS LAST, a.number ASC", d)
	case "sprint_id":
		return fmt.Sprintf("a.sprint_id %s NULLS LAST, a.number ASC", d)
	case "due_date":
		return fmt.Sprintf("a.due_date %s NULLS LAST, a.number ASC", d)
	default:
		return "a.position ASC, a.number ASC"
	}
}

// ─── scan helpers ─────────────────────────────────────────────────────────────

type scannable interface {
	Scan(dest ...any) error
}

func scanWorkItemRow(row scannable) (*WorkItem, error) {
	var wi WorkItem

	// Sprint ref columns — NULL when no sprint assigned.
	var sprintRefID, sprintRefAlias *string
	// Owner ref columns — NULL in this story (decorated in 00468).
	var ownerRefID, ownerDisplayName, ownerAvatarURL *string

	err := row.Scan(
		&wi.ID,
		&wi.SubscriptionID,
		&wi.KeyNum,
		&wi.ItemType,
		&wi.Title,
		&wi.Description,
		&wi.Status,
		&wi.FlowStateID,
		&wi.FlowStateName,
		&wi.FlowStateCode,
		&wi.Priority,
		&wi.StoryPoints,
		&wi.SprintID,
		&sprintRefID,
		&sprintRefAlias,
		&wi.ParentID,
		&wi.RootFeatureID,
		&wi.OwnerID,
		&ownerRefID,
		&ownerDisplayName,
		&ownerAvatarURL,
		&wi.DueDate,
		&wi.CreatedBy,
		&wi.CreatedAt,
		&wi.UpdatedAt,
		&wi.ArchivedAt,
		&wi.ChildrenCount,
		&wi.RollupPoints,
	)
	if err != nil {
		return nil, err
	}

	if sprintRefID != nil && sprintRefAlias != nil {
		wi.Sprint = &SprintRef{ID: *sprintRefID, Alias: *sprintRefAlias}
	}
	if ownerRefID != nil {
		dn := ""
		if ownerDisplayName != nil {
			dn = *ownerDisplayName
		}
		wi.Owner = &OwnerRef{ID: *ownerRefID, DisplayName: dn, AvatarURL: ownerAvatarURL}
	}

	return &wi, nil
}

func scanWorkItemRows(rows pgx.Rows) ([]WorkItem, error) {
	var out []WorkItem
	for rows.Next() {
		wi, err := scanWorkItemRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *wi)
	}
	if out == nil {
		out = []WorkItem{}
	}
	return out, rows.Err()
}

