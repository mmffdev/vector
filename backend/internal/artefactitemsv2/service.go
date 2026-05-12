package artefactitemsv2

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/webhooks"
)

// TopologyScopeResolver answers "may this user read scope X" and "what
// nodes are in scope X's subtree." Implemented by orgdesign.Service —
// declared here as an interface so artefactitemsv2 does not import
// orgdesign (which would create a cycle once orgdesign starts reading
// artefacts). Wired by main.go after both services exist.
type TopologyScopeResolver interface {
	CanReadScope(ctx context.Context, subscriptionID, userID, targetNodeID uuid.UUID, actorRole string) (bool, error)
	DescendantNodeIDs(ctx context.Context, subscriptionID, rootNodeID uuid.UUID) ([]uuid.UUID, error)
}

// Service owns all DB operations for the v2 artefacts domain.
// vectorArtefactsPool reads from vector_artefacts; mainPool reads from
// mmff_vector (owner decoration cross-DB lookup). Either may be nil.
//
// scope discriminates which `artefact_types.scope` value this Service
// instance serves. main.go registers two instances: scope="work" for
// /work-items, scope="strategy" for /portfolio-items. The value is
// embedded in every SQL clause via `at.scope = $N` parameter binding —
// no string interpolation, no SQL-injection surface.
type Service struct {
	vectorArtefactsPool *pgxpool.Pool
	mainPool            *pgxpool.Pool
	notifier            *webhooks.Notifier
	scope               string
	topology            TopologyScopeResolver
}

// NewService creates a Service backed by the given pools, scoped to the
// given `artefact_types.scope` value (typically "work" or "strategy").
// vaPool may be nil when VECTOR_ARTEFACTS_DB_URL is unset; mainPool may be
// nil (owner decoration is skipped and Owner stays nil on every item).
// scope must be a non-empty literal known in `artefact_types.scope`.
func NewService(vaPool, mainPool *pgxpool.Pool, scope string) *Service {
	return &Service{vectorArtefactsPool: vaPool, mainPool: mainPool, scope: scope}
}

// Scope returns the artefact_types.scope value this Service is bound to.
// Used by tests and diagnostics.
func (s *Service) Scope() string { return s.scope }

// WithNotifier attaches a webhook notifier. Safe to call with nil.
func (s *Service) WithNotifier(n *webhooks.Notifier) { s.notifier = n }

// WithTopologyResolver wires the PLA-0043 scope clamp dependency. When
// nil (or unset) every Filters.ScopeNodeID is rejected as
// ErrInvalidInput — callers cannot bypass scope by simply omitting the
// resolver. Pass a *orgdesign.Service.
func (s *Service) WithTopologyResolver(t TopologyScopeResolver) { s.topology = t }

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
	// $1 = subscriptionID (always). $2 = scope (always). Extras start at $3.
	args := []any{subscriptionID, s.scope}
	n := 3
	var extra []string

	// PLA-0043 — Topology scope clamp on artefact reads. When the caller
	// passed ?scope=<id> we resolve the user's reachable subtree and
	// limit artefacts to that set. NULL topology_node_id rows are
	// excluded when scope is active (un-assigned items are visible only
	// in unscoped reads).
	if filters.ScopeNodeID != nil {
		if s.topology == nil {
			return nil, 0, ErrInvalidInput
		}
		if filters.ActorUserID == nil || filters.ActorRole == "" {
			return nil, 0, ErrInvalidInput
		}
		scopeNodeID, parseErr := uuid.Parse(*filters.ScopeNodeID)
		if parseErr != nil {
			return nil, 0, ErrInvalidInput
		}
		actorUserID, parseErr := uuid.Parse(*filters.ActorUserID)
		if parseErr != nil {
			return nil, 0, ErrInvalidInput
		}
		ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, actorUserID, scopeNodeID, filters.ActorRole)
		if permErr != nil {
			if errors.Is(permErr, ErrNotFound) {
				return nil, 0, ErrScopeNodeNotFound
			}
			// orgdesign returns its own ErrNodeNotFound; translate via string match
			// to avoid importing orgdesign here (cycle risk).
			if strings.Contains(permErr.Error(), "node not found") {
				return nil, 0, ErrScopeNodeNotFound
			}
			return nil, 0, permErr
		}
		if !ok {
			return nil, 0, ErrScopeForbidden
		}
		ids, descErr := s.topology.DescendantNodeIDs(ctx, subscriptionID, scopeNodeID)
		if descErr != nil {
			return nil, 0, descErr
		}
		extra = append(extra, fmt.Sprintf("a.topology_node_id = ANY($%d::uuid[])", n))
		args = append(args, ids)
		n++
	}

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
		extra = append(extra, fmt.Sprintf("a.timebox_sprint_id = $%d::uuid", n))
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
		  AND at.scope = $2` + extraWhere

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
			at.prefix                       AS type_prefix,
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
			a.timebox_sprint_id::text,
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
		  AND at.scope = $2` + extraWhere + `
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
			at.prefix                       AS type_prefix,
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
			a.timebox_sprint_id::text,
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
		  AND at.scope = $3`,
		subscriptionID, id, s.scope,
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
			at.prefix                       AS type_prefix,
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
			a.timebox_sprint_id::text,
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
		  AND at.scope = $3
		ORDER BY a.position ASC, a.number ASC`,
		subscriptionID, parentID, s.scope,
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
//
// B21 (PLA-0037): the by-type bucket map is populated data-driven from
// artefact_types.name so portfolio/strategy scopes (which have no
// epic/story/task/defect static fields) still get a useful summary. The
// fixed Epics/Stories/Tasks/Defects fields remain populated from ByType
// for back-compat with the v2 work-items page header.
func (s *Service) SummariseWorkItems(ctx context.Context, subscriptionID uuid.UUID, sprintID *string) (WorkItemsSummary, error) {
	out := WorkItemsSummary{ByType: map[string]int{}}
	if s.vectorArtefactsPool == nil {
		return out, nil
	}
	args := []any{subscriptionID, s.scope}
	conds := []string{
		"a.subscription_id = $1",
		"a.archived_at IS NULL",
		"at.scope = $2",
	}
	n := 3
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("a.timebox_sprint_id = $%d::uuid", n))
		args = append(args, *sprintID)
		n++
	}
	_ = n
	whereClause := strings.Join(conds, " AND ")

	// Pass 1: total + blocked (single row).
	totalQ := fmt.Sprintf(`
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (
				WHERE (fs.kind = 'todo' OR fs.id IS NULL)
				  AND a.updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		WHERE %s`, whereClause)
	if err := s.vectorArtefactsPool.QueryRow(ctx, totalQ, args...).Scan(&out.Total, &out.Blocked); err != nil {
		return WorkItemsSummary{ByType: map[string]int{}}, err
	}

	// Pass 2: per-type bucket map (one row per artefact_type.name).
	typeQ := fmt.Sprintf(`
		SELECT lower(at.name) AS name, COUNT(*)
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		WHERE %s
		GROUP BY lower(at.name)`, whereClause)
	rows, err := s.vectorArtefactsPool.Query(ctx, typeQ, args...)
	if err != nil {
		return WorkItemsSummary{ByType: map[string]int{}}, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			return WorkItemsSummary{ByType: map[string]int{}}, err
		}
		out.ByType[name] = n
	}
	if err := rows.Err(); err != nil {
		return WorkItemsSummary{ByType: map[string]int{}}, err
	}

	// Back-compat: fill the fixed work-only fields from ByType. Outside
	// scope="work" these stay 0 (the keys won't exist in the map).
	out.Epics = out.ByType["epic"]
	out.Stories = out.ByType["story"]
	out.Tasks = out.ByType["task"]
	out.Defects = out.ByType["defect"]
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
		WHERE f.artefact_type_id = (
			SELECT at.id FROM artefact_types at
			JOIN flows f2 ON f2.artefact_type_id = at.id
			WHERE at.subscription_id = $1
			  AND at.scope = $2
			  AND f2.is_default = TRUE
			  AND f2.archived_at IS NULL
			  AND at.archived_at IS NULL
			ORDER BY at.created_at ASC
			LIMIT 1
		)
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.archived_at IS NULL
		ORDER BY fs.sort_order ASC`,
		subscriptionID, s.scope,
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

// CreateWorkItem inserts a new artefact row in vector_artefacts.
// number is allocated atomically via artefact_number_sequence.
// The default flow_state is the is_initial=true state for the subscription's
// work artefact type default flow.
func (s *Service) CreateWorkItem(ctx context.Context, subscriptionID uuid.UUID, in CreateWorkItemInput) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, fmt.Errorf("vector_artefacts pool not configured")
	}
	if allowed, ok := validItemTypesByScope[s.scope]; ok && allowed != nil {
		if !allowed[in.ItemType] {
			return nil, fmt.Errorf("%w: item_type %q not allowed in scope %q", ErrInvalidInput, in.ItemType, s.scope)
		}
	}
	if in.StoryPoints != nil && !canHaveManualPoints(in.ItemType) {
		return nil, fmt.Errorf("%w: story_points cannot be set on %s items", ErrInvalidInput, in.ItemType)
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}

	tx, err := s.vectorArtefactsPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Resolve artefact_type_id for this subscription + item_type.
	var artefactTypeID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM artefact_types
		WHERE subscription_id = $1
		  AND scope = $3
		  AND lower(name) = $2
		  AND archived_at IS NULL
		LIMIT 1`,
		subscriptionID, in.ItemType, s.scope,
	).Scan(&artefactTypeID)
	if err != nil {
		return nil, fmt.Errorf("resolve artefact_type for %q: %w", in.ItemType, err)
	}

	// Allocate number atomically.
	var num int64
	err = tx.QueryRow(ctx, `
		INSERT INTO artefact_number_sequence (subscription_id, artefact_type_id, next_num)
		VALUES ($1, $2, 2)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = artefact_number_sequence.next_num + 1
		RETURNING next_num - 1`,
		subscriptionID, artefactTypeID,
	).Scan(&num)
	if err != nil {
		return nil, err
	}

	// Resolve default (is_initial) flow state for this type.
	var defaultFlowStateID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT fs.id FROM flow_states fs
		JOIN flows f ON f.id = fs.flow_id
		WHERE f.artefact_type_id = $1
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.is_initial = TRUE
		  AND fs.archived_at IS NULL
		LIMIT 1`,
		artefactTypeID,
	).Scan(&defaultFlowStateID)
	if err != nil {
		return nil, fmt.Errorf("resolve default flow state: %w", err)
	}

	// Resolve workspace_id — required NOT NULL. Use first workspace for subscription
	// (same heuristic as the ETL backfill).
	var workspaceID uuid.UUID
	err = s.mainPool.QueryRow(ctx, `
		SELECT id FROM master_record_workspaces
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY created_at ASC LIMIT 1`,
		subscriptionID,
	).Scan(&workspaceID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("resolve workspace: %w", err)
	} else if errors.Is(err, pgx.ErrNoRows) {
		// Fall back to subscription_id as workspace_id sentinel (matches ETL).
		workspaceID = subscriptionID
	}

	var newID uuid.UUID
	ownerID := uuid.Nil
	if in.OwnerID != "" {
		ownerID, err = uuid.Parse(in.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid owner_id UUID", ErrInvalidInput)
		}
	}
	createdBy := uuid.Nil
	if in.CreatedBy != "" {
		createdBy, err = uuid.Parse(in.CreatedBy)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid created_by UUID", ErrInvalidInput)
		}
	}

	var parentID *uuid.UUID
	if in.ParentID != nil {
		pid, err := uuid.Parse(*in.ParentID)
		if err == nil {
			parentID = &pid
		}
	}
	var sprintID *uuid.UUID
	if in.SprintID != nil {
		sid, err := uuid.Parse(*in.SprintID)
		if err == nil {
			sprintID = &sid
		}
	}

	// Append to existing items (position = MAX + 100).
	var pos int
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position), 0) + 100 FROM artefacts
		WHERE subscription_id = $1
		  AND artefact_type_id = $2
		  AND archived_at IS NULL`,
		subscriptionID, artefactTypeID,
	).Scan(&pos)

	err = tx.QueryRow(ctx, `
		INSERT INTO artefacts
			(subscription_id, workspace_id, artefact_type_id, number, title, description,
			 flow_state_id, priority, story_points, timebox_sprint_id, parent_artefact_id,
			 owned_by_user_id, created_by_user_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id`,
		subscriptionID, workspaceID, artefactTypeID, num,
		in.Title, in.Description,
		defaultFlowStateID, in.Priority, in.StoryPoints, sprintID, parentID,
		ownerID, createdBy, pos,
	).Scan(&newID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	item, err := s.GetWorkItem(ctx, subscriptionID, newID)
	if err != nil {
		return nil, err
	}
	s.notifier.Fire(subscriptionID, "item.created", item)
	return item, nil
}

// PatchWorkItem applies a partial update to an artefact row.
func (s *Service) PatchWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID, in PatchWorkItemInput) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	if in.Status != nil && !validStatuses[*in.Status] {
		return nil, fmt.Errorf("%w: invalid status", ErrInvalidInput)
	}
	if in.Priority != nil && *in.Priority != "" && !validPriorities[*in.Priority] {
		return nil, fmt.Errorf("%w: invalid priority", ErrInvalidInput)
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
	if in.FlowStateID != nil {
		// Validate the flow_state belongs to this subscription.
		var fsExists bool
		err := s.vectorArtefactsPool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM flow_states fs
				JOIN flows f ON f.id = fs.flow_id
				JOIN artefact_types at ON at.id = f.artefact_type_id
				WHERE fs.id = $1
				  AND at.subscription_id = $2
				  AND fs.archived_at IS NULL
			)`, *in.FlowStateID, subscriptionID,
		).Scan(&fsExists)
		if err != nil || !fsExists {
			return nil, fmt.Errorf("%w: flow_state_id not found", ErrInvalidInput)
		}
		sets = append(sets, fmt.Sprintf("flow_state_id = $%d::uuid", n))
		args = append(args, *in.FlowStateID)
		n++
	}
	if in.Priority != nil {
		if *in.Priority == "" {
			sets = append(sets, "priority = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("priority = $%d", n))
			args = append(args, *in.Priority)
			n++
		}
	}
	if in.StoryPoints != nil {
		sets = append(sets, fmt.Sprintf("story_points = $%d", n))
		args = append(args, *in.StoryPoints)
		n++
	}
	if in.SprintID != nil {
		if *in.SprintID == "" {
			sets = append(sets, "timebox_sprint_id = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("timebox_sprint_id = $%d::uuid", n))
			args = append(args, *in.SprintID)
			n++
		}
	}
	if in.DueDate != nil {
		if *in.DueDate == "" {
			sets = append(sets, "due_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("due_date = $%d::date", n))
			args = append(args, *in.DueDate)
			n++
		}
	}

	// WHERE clause args: id=$N, subscription_id=$N+1
	args = append(args, id, subscriptionID)
	idN := n
	subN := n + 1

	ct, err := s.vectorArtefactsPool.Exec(ctx,
		fmt.Sprintf(`UPDATE artefacts SET %s
			WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`,
			strings.Join(sets, ", "), idN, subN),
		args...,
	)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	item, err := s.GetWorkItem(ctx, subscriptionID, id)
	if err != nil {
		return nil, err
	}
	eventType := "item.updated"
	if in.FlowStateID != nil {
		eventType = "item.status_changed"
	}
	s.notifier.Fire(subscriptionID, eventType, item)
	return item, nil
}

// ArchiveWorkItem sets archived_at on an artefact row (soft delete).
func (s *Service) ArchiveWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrNotFound
	}
	ct, err := s.vectorArtefactsPool.Exec(ctx, `
		UPDATE artefacts
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
	s.notifier.Fire(subscriptionID, "item.deleted", map[string]string{"id": id.String()})
	return nil
}

type bulkRowInfo struct {
	id       string
	itemType string
}

// BulkOps applies one op (set_priority | set_owner | archive | set_flow_state)
// to a batch of artefact ids in a single transaction.
// Returns {updated, failed} even on partial failure (best-effort, not all-or-nothing).
func (s *Service) BulkOps(ctx context.Context, subscriptionID uuid.UUID, ids []string, op string, payload map[string]any) (BulkOpResult, error) {
	switch op {
	case "set_priority", "set_owner", "archive", "set_flow_state", "set_status":
		// supported
	default:
		return BulkOpResult{}, fmt.Errorf("%w: unsupported op %q", ErrInvalidInput, op)
	}
	if len(ids) == 0 {
		return BulkOpResult{Updated: 0}, nil
	}
	if s.vectorArtefactsPool == nil {
		return BulkOpResult{}, fmt.Errorf("vector_artefacts pool not configured")
	}

	supplied := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		supplied[id] = struct{}{}
	}

	tx, err := s.vectorArtefactsPool.Begin(ctx)
	if err != nil {
		return BulkOpResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT a.id::text, lower(at.name)
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		WHERE a.subscription_id = $1 AND a.id::text = ANY($2) AND a.archived_at IS NULL
		FOR UPDATE OF a`,
		subscriptionID, ids,
	)
	if err != nil {
		return BulkOpResult{}, err
	}
	var visible []bulkRowInfo
	for rows.Next() {
		var r bulkRowInfo
		if err := rows.Scan(&r.id, &r.itemType); err != nil {
			rows.Close()
			return BulkOpResult{}, err
		}
		visible = append(visible, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return BulkOpResult{}, err
	}

	visibleSet := make(map[string]struct{}, len(visible))
	for _, r := range visible {
		visibleSet[r.id] = struct{}{}
	}

	var result BulkOpResult
	for id := range supplied {
		if _, ok := visibleSet[id]; !ok {
			result.Failed = append(result.Failed, BulkFailure{ID: id, Reason: "forbidden"})
		}
	}

	for _, row := range visible {
		var execErr error
		switch op {
		case "set_priority":
			val, _ := payload["priority"].(string)
			if !validPriorities[val] {
				result.Failed = append(result.Failed, BulkFailure{ID: row.id, Reason: "invalid priority"})
				continue
			}
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET priority=$1, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`,
				val, row.id, subscriptionID)
		case "set_owner":
			ownerID, _ := payload["owner_id"].(string)
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET owned_by_user_id=$1::uuid, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`,
				ownerID, row.id, subscriptionID)
		case "archive":
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET archived_at=now(), updated_at=now() WHERE id=$1::uuid AND subscription_id=$2`,
				row.id, subscriptionID)
		case "set_flow_state", "set_status":
			fsID, _ := payload["flow_state_id"].(string)
			if fsID == "" {
				fsID, _ = payload["status"].(string)
			}
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET flow_state_id=$1::uuid, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`,
				fsID, row.id, subscriptionID)
		}
		if execErr != nil {
			result.Failed = append(result.Failed, BulkFailure{ID: row.id, Reason: execErr.Error()})
		} else {
			result.Updated++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return BulkOpResult{}, err
	}
	if result.Failed == nil {
		result.Failed = []BulkFailure{}
	}
	return result, nil
}

// ListFieldValues returns all artefact_field_values for an artefact,
// enforcing subscription isolation by first verifying the artefact exists.
func (s *Service) ListFieldValues(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID) ([]FieldValue, error) {
	if s.vectorArtefactsPool == nil {
		return []FieldValue{}, nil
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return nil, err
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		SELECT fv.id, fv.artefact_id::text, fl.id::text, NULL::text,
		       fl.name, fl.label, fl.field_type, fl.options_json,
		       fv.string_value, fv.number_value::text, fv.text_value, fv.date_value::text
		FROM artefact_field_values fv
		JOIN artefact_field_library fl ON fl.id = fv.field_library_id
		WHERE fv.artefact_id = $1
		ORDER BY fl.name ASC`,
		artefactID,
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
	if fvs == nil {
		fvs = []FieldValue{}
	}
	return fvs, rows.Err()
}

// UpsertFieldValue writes one field value for an artefact.
// Enforces type routing and subscription isolation.
func (s *Service) UpsertFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, in UpsertFieldValueInput) error {
	if s.vectorArtefactsPool == nil {
		return fmt.Errorf("vector_artefacts pool not configured")
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}
	fieldID, err := uuid.Parse(in.FieldLibraryID)
	if err != nil {
		return fmt.Errorf("%w: invalid field_library_id", ErrInvalidInput)
	}
	var fieldType string
	err = s.vectorArtefactsPool.QueryRow(ctx,
		`SELECT field_type FROM artefact_field_library WHERE id = $1 AND subscription_id = $2`,
		fieldID, subscriptionID,
	).Scan(&fieldType)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: field_library_id not found", ErrInvalidInput)
	}
	if err != nil {
		return err
	}

	_, err = s.vectorArtefactsPool.Exec(ctx, `
		INSERT INTO artefact_field_values
			(artefact_id, field_library_id, string_value, number_value, text_value, date_value)
		VALUES ($1,$2,$3,$4::numeric,$5,$6::date)
		ON CONFLICT (artefact_id, field_library_id)
		DO UPDATE SET
			string_value = EXCLUDED.string_value,
			number_value = EXCLUDED.number_value,
			text_value   = EXCLUDED.text_value,
			date_value   = EXCLUDED.date_value,
			updated_at   = now()`,
		artefactID, fieldID,
		in.StringValue, in.NumberValue, in.TextValue, in.DateValue,
	)
	return err
}

// DeleteFieldValue removes a field value row by id, enforcing ownership.
func (s *Service) DeleteFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, fvID uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrFieldNotFound
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}
	ct, err := s.vectorArtefactsPool.Exec(ctx,
		`DELETE FROM artefact_field_values WHERE id = $1 AND artefact_id = $2`,
		fvID, artefactID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrFieldNotFound
	}
	return nil
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
		return fmt.Sprintf("a.timebox_sprint_id %s NULLS LAST, a.number ASC", d)
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
		&wi.TypePrefix,
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

