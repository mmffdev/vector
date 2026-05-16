package artefactitems

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
// declared here as an interface so artefactitems does not import
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
// scope discriminates which `artefacts_types.scope` value this Service
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
// given `artefacts_types.scope` value (typically "work" or "strategy").
// vaPool may be nil when VECTOR_ARTEFACTS_DB_URL is unset; mainPool may be
// nil (owner decoration is skipped and Owner stays nil on every item).
// scope must be a non-empty literal known in `artefacts_types.scope`.
func NewService(vaPool, mainPool *pgxpool.Pool, scope string) *Service {
	return &Service{vectorArtefactsPool: vaPool, mainPool: mainPool, scope: scope}
}

// Scope returns the artefacts_types.scope value this Service is bound to.
// Used by tests and diagnostics.
func (s *Service) Scope() string { return s.scope }

// WithNotifier attaches a webhook notifier. Safe to call with nil.
func (s *Service) WithNotifier(n *webhooks.Notifier) { s.notifier = n }

// WithTopologyResolver wires the PLA-0043 scope clamp dependency. When
// nil (or unset) every Filters.ScopeNodeID is rejected as
// ErrInvalidInput — callers cannot bypass scope by simply omitting the
// resolver. Pass a *orgdesign.Service.
func (s *Service) WithTopologyResolver(t TopologyScopeResolver) { s.topology = t }

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
	} else if len(filters.ItemType) == 0 {
		// Default: top-level items only (mirrors v1 ListWorkItems default).
		extra = append(extra, "a.parent_artefact_id IS NULL")
	}
	// PLA-0054 / story 00586: multi-value UUID filters. Empty slice is a
	// no-op; otherwise emit ANY($N::uuid[]) so the JOIN predicate matches
	// any artefact_type whose UUID is in the chip's selection. Rename-
	// invariant: matching by ID instead of lower(name).
	if len(filters.ItemType) > 0 {
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id = ANY($%d::uuid[])", n))
		args = append(args, filters.ItemType)
		n++
	}
	if len(filters.Status) > 0 {
		// PLA-0054 / story 00585: Status filter is now flow_state_id list
		// (the artefact's current flow state, not a translated kind slug).
		extra = append(extra, fmt.Sprintf("a.flow_state_id = ANY($%d::uuid[])", n))
		args = append(args, filters.Status)
		n++
	}
	if len(filters.Priority) > 0 {
		extra = append(extra, fmt.Sprintf("a.priority = ANY($%d::text[])", n))
		args = append(args, filters.Priority)
		n++
	}
	if filters.SprintID != nil {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *filters.SprintID)
		n++
	}
	if len(filters.OwnerID) > 0 {
		extra = append(extra, fmt.Sprintf("a.owned_by_user_id = ANY($%d::uuid[])", n))
		args = append(args, filters.OwnerID)
		n++
	}
	// PLA-0053 / story 00579: workspace clamp via the artefact_type's
	// workspace_id (the column added by PLA-0026 mig 019). artefact_items
	// inherits its workspace from the type it instances; cross-workspace
	// reads are excluded by JOIN predicate. The `at` alias is already in
	// scope from the base FROM clause.
	if filters.WorkspaceID != nil {
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id_workspace = $%d::uuid", n))
		args = append(args, *filters.WorkspaceID)
		n++
	}

	extraWhere := ""
	if len(extra) > 0 {
		extraWhere = "\n  AND " + strings.Join(extra, "\n  AND ")
	}

	orderBy := buildOrderBy(filters.Sort, filters.Dir)

	// ── count query (no rollupCTE, no LIMIT/OFFSET) ───────────────────────────
	countQ := fmt.Sprintf(sqlCountWorkItemsTemplate, extraWhere)

	if err = s.vectorArtefactsPool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// ── data query ───────────────────────────────────────────────────────────
	limitN := n
	offsetN := n + 1
	dataArgs := append(args, lim, filters.Offset)

	dataQ := fmt.Sprintf(sqlListWorkItemsTemplate, extraWhere, orderBy, limitN, offsetN)

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
	return s.getWorkItemImpl(ctx, subscriptionID, id, nil)
}

// GetWorkItemInWorkspace clamps the read to a single workspace
// (PLA-0053 / story 00579). When the workspace clamp is in effect,
// cross-workspace IDs return ErrNotFound — the handler translates to
// 404, preserving the no-existence-leak contract from F1's test scope.
func (s *Service) GetWorkItemInWorkspace(ctx context.Context, subscriptionID, workspaceID, id uuid.UUID) (*WorkItem, error) {
	return s.getWorkItemImpl(ctx, subscriptionID, id, &workspaceID)
}

func (s *Service) getWorkItemImpl(ctx context.Context, subscriptionID, id uuid.UUID, workspaceID *uuid.UUID) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	var row pgx.Row
	if workspaceID != nil {
		row = s.vectorArtefactsPool.QueryRow(ctx, sqlSelectWorkItemByIDInWorkspace,
			subscriptionID, id, s.scope, *workspaceID,
		)
	} else {
		row = s.vectorArtefactsPool.QueryRow(ctx, sqlSelectWorkItemByID,
			subscriptionID, id, s.scope,
		)
	}
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
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlListChildWorkItems,
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
// artefacts_types.name so portfolio/strategy scopes (which have no
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
		"at.artefacts_types_scope = $2",
	}
	n := 3
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *sprintID)
		n++
	}
	_ = n
	whereClause := strings.Join(conds, " AND ")

	// Pass 1: total + blocked (single row).
	totalQ := fmt.Sprintf(sqlSummariseTotalTemplate, whereClause)
	if err := s.vectorArtefactsPool.QueryRow(ctx, totalQ, args...).Scan(&out.Total, &out.Blocked); err != nil {
		return WorkItemsSummary{ByType: map[string]int{}}, err
	}

	// Pass 2: per-type bucket map (one row per artefact_type.name).
	typeQ := fmt.Sprintf(sqlSummariseByTypeTemplate, whereClause)
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
	return out, nil
}

// SummariseRisks (PLA-0052 Story 10) returns severity × likelihood aggregates
// for the /risk page header. JWT-scoped to subscription. Risk artefacts only
// (artefacts_types_name='Risk'). Reads risk_impact + risk_probability from
// artefacts_fields_values; null/missing values are excluded from buckets but
// still counted in Total.
func (s *Service) SummariseRisks(ctx context.Context, subscriptionID uuid.UUID) (RisksSummary, error) {
	var out RisksSummary
	if s.vectorArtefactsPool == nil {
		return out, nil
	}
	row := s.vectorArtefactsPool.QueryRow(ctx, sqlSummariseRisks, subscriptionID)
	err := row.Scan(
		&out.Total, &out.Open,
		&out.BySeverity.Critical, &out.BySeverity.High, &out.BySeverity.Medium, &out.BySeverity.Low,
		&out.ByLikelihood.High, &out.ByLikelihood.Medium, &out.ByLikelihood.Low,
		// matrix[severity_row][likelihood_col]
		&out.Matrix[0][0], &out.Matrix[0][1], &out.Matrix[0][2], // severity=high
		&out.Matrix[1][0], &out.Matrix[1][1], &out.Matrix[1][2], // severity=medium
		&out.Matrix[2][0], &out.Matrix[2][1], &out.Matrix[2][2], // severity=low
	)
	if err != nil {
		return RisksSummary{}, err
	}
	return out, nil
}

// ListFlowStates returns the flow states for the work artefact type belonging
// to the subscription. Queries flows_states via the default flow for the
// first work-scoped artefact_type owned by this subscription.
func (s *Service) ListFlowStates(ctx context.Context, subscriptionID uuid.UUID) ([]WorkItemFlowState, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItemFlowState{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlListWorkScopeFlowStates,
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
// number is allocated atomically via artefacts_number_sequences.
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
	err = tx.QueryRow(ctx, sqlSelectArtefactTypeIDForCreate,
		subscriptionID, in.ItemType, s.scope,
	).Scan(&artefactTypeID)
	if err != nil {
		return nil, fmt.Errorf("resolve artefact_type for %q: %w", in.ItemType, err)
	}

	// Allocate number atomically.
	var num int64
	err = tx.QueryRow(ctx, sqlAllocateArtefactNumber,
		subscriptionID, artefactTypeID,
	).Scan(&num)
	if err != nil {
		return nil, err
	}

	// Resolve default (is_initial) flow state for this type.
	var defaultFlowStateID uuid.UUID
	err = tx.QueryRow(ctx, sqlSelectDefaultInitialFlowState, artefactTypeID).
		Scan(&defaultFlowStateID)
	if err != nil {
		return nil, fmt.Errorf("resolve default flow state: %w", err)
	}

	// Resolve workspace_id — required NOT NULL. Use first workspace for subscription
	// (same heuristic as the ETL backfill).
	var workspaceID uuid.UUID
	err = s.mainPool.QueryRow(ctx, sqlSelectFirstLiveWorkspaceForSubscription,
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
	_ = tx.QueryRow(ctx, sqlSelectNextArtefactPosition,
		subscriptionID, artefactTypeID,
	).Scan(&pos)

	err = tx.QueryRow(ctx, sqlInsertArtefact,
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
		err := s.vectorArtefactsPool.QueryRow(ctx, sqlExistsFlowStateInSubscription,
			*in.FlowStateID, subscriptionID,
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
			sets = append(sets, "artefacts_id_timebox_sprint = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_timebox_sprint = $%d::uuid", n))
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
		fmt.Sprintf(sqlPatchArtefactTemplate,
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
	ct, err := s.vectorArtefactsPool.Exec(ctx, sqlArchiveArtefact,
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

	rows, err := tx.Query(ctx, sqlSelectArtefactsForBulkLock,
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
			_, execErr = tx.Exec(ctx, sqlBulkSetPriority,
				val, row.id, subscriptionID)
		case "set_owner":
			ownerID, _ := payload["owner_id"].(string)
			_, execErr = tx.Exec(ctx, sqlBulkSetOwner,
				ownerID, row.id, subscriptionID)
		case "archive":
			_, execErr = tx.Exec(ctx, sqlBulkArchive,
				row.id, subscriptionID)
		case "set_flow_state", "set_status":
			fsID, _ := payload["flow_state_id"].(string)
			if fsID == "" {
				fsID, _ = payload["status"].(string)
			}
			_, execErr = tx.Exec(ctx, sqlBulkSetFlowState,
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

// ListFieldValues returns all artefacts_fields_values for an artefact,
// enforcing subscription isolation by first verifying the artefact exists.
func (s *Service) ListFieldValues(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID) ([]FieldValue, error) {
	if s.vectorArtefactsPool == nil {
		return []FieldValue{}, nil
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return nil, err
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlListFieldValuesForArtefact,
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
	err = s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFieldLibraryType,
		fieldID, subscriptionID,
	).Scan(&fieldType)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: field_library_id not found", ErrInvalidInput)
	}
	if err != nil {
		return err
	}

	_, err = s.vectorArtefactsPool.Exec(ctx, sqlUpsertFieldValue,
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
	ct, err := s.vectorArtefactsPool.Exec(ctx, sqlDeleteFieldValue,
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

	uRows, err := s.mainPool.Query(ctx, sqlSelectActiveUserDisplayNamesByIDs, ids)
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
		// TD-WORKITEMS-GENERIC pay-down (2026-05-16): sort by the type's
		// own `artefacts_types_sort_order` column (seeded per type) instead
		// of a hardcoded CASE WHEN that grew a line for every new type.
		// Adding a new artefact type now requires only the seed migration —
		// no Go change.
		return fmt.Sprintf(`at.artefacts_types_sort_order ASC NULLS LAST, a.number %s`, d)
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
		return fmt.Sprintf("a.artefacts_id_timebox_sprint %s NULLS LAST, a.number ASC", d)
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

