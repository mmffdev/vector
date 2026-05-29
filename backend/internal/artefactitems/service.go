package artefactitems

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/rules"
	"github.com/mmffdev/vector-backend/internal/sentinel"
	"github.com/mmffdev/vector-backend/internal/webhooks"
)

// TopologyScopeResolver answers "may this user read scope X" and "what
// nodes are in scope X's subtree." Implemented by orgdesign.Service —
// declared here as an interface so artefactitems does not import
// orgdesign (which would create a cycle once orgdesign starts reading
// artefacts). Wired by main.go after both services exist.
//
// ERROR CONTRACT: implementations MUST return one of artefactitems'
// sentinels (ErrScopeNodeNotFound, ErrScopeForbidden, ErrNotFound) so
// the service can switch on errors.Is without sniffing error strings.
// main.go adapts the underlying topology service to this contract at
// the wiring seam (see topologyResolverAdapter in main.go).
type TopologyScopeResolver interface {
	CanReadScope(ctx context.Context, subscriptionID, userID, targetNodeID uuid.UUID, actorRoleID uuid.UUID) (bool, error)
	DescendantNodeIDs(ctx context.Context, subscriptionID, rootNodeID uuid.UUID) ([]uuid.UUID, error)
	// AncestorNodeIDs returns rootNodeID plus every live ancestor up to the
	// subscription root (strict chain — no siblings). Used by the "ascend"
	// scope direction so users can walk up the tree from a selected node.
	AncestorNodeIDs(ctx context.Context, subscriptionID, rootNodeID uuid.UUID) ([]uuid.UUID, error)
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
	// ruleHook receives ArtefactChangedEvent fan-out on writes
	// (B11.4 follow-up). Optional — when nil, writes proceed
	// without rule evaluation. Wire in main.go via WithRuleHook.
	ruleHook rules.RuleHook
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

// WithRuleHook wires the notification-rules engine into the write
// path. Safe to call with nil — write proceeds, no rules fire.
func (s *Service) WithRuleHook(h rules.RuleHook) { s.ruleHook = h }

// fireRuleHook builds an ArtefactChangedEvent from before/after
// snapshots and hands it to the rule engine. Best-effort: any
// failure (workspace lookup, hook panic, missing field) is logged
// but never blocks the write. Caller passes nil `before` for Create.
//
// The set of fields included in the event covers what users actually
// build rules against today: flow_state, status, priority, estimate,
// owner, parent, sprint, milestone, release, due_date, blocked,
// colour, title. Adding a new field = one line in the diff loop +
// surface in the schema endpoint.
func (s *Service) fireRuleHook(ctx context.Context, before, after *WorkItem, authorUserID uuid.UUID) {
	if s.ruleHook == nil || after == nil || s.vectorArtefactsPool == nil {
		return
	}
	// Look up workspace_id + the artefact type NAME — both required
	// to scope the rules query (mig 237). Single round-trip.
	var workspaceID uuid.UUID
	var typeName string
	if err := s.vectorArtefactsPool.QueryRow(ctx, sqlArtefactWorkspaceAndTypeName, after.ID).
		Scan(&workspaceID, &typeName); err != nil {
		// Best-effort — silently skip rather than block the write.
		return
	}
	subID, _ := uuid.Parse(after.SubscriptionID)
	artefactID, _ := uuid.Parse(after.ID)
	ev := rules.ArtefactChangedEvent{
		SubscriptionID: subID,
		WorkspaceID:    workspaceID,
		ArtefactID:     artefactID,
		ArtefactType:   typeName,
		AuthorUserID:   authorUserID,
		Fields:         diffWorkItem(before, after),
	}
	s.ruleHook.OnArtefactChanged(ctx, ev)
}

// diffWorkItem turns before+after snapshots into the field-change map
// the evaluator reads. `before == nil` (Create) seeds Before=nil for
// every field — the `changed_to` operator still fires (nil → after).
func diffWorkItem(before, after *WorkItem) map[string]rules.FieldChange {
	out := map[string]rules.FieldChange{}
	add := func(name string, b, a any) { out[name] = rules.FieldChange{Before: b, After: a} }
	if before == nil {
		// Create: every populated field is "changed from nil".
		add("title", nil, after.Title)
		add("status", nil, after.Status)
		add("flow_state_id", nil, after.FlowStateID)
		add("flow_state", nil, after.FlowStateName)
		add("priority_id", nil, after.PriorityID)
		add("story_points", nil, valOrNil(after.StoryPoints))
		add("sprint_id", nil, valOrNil(after.SprintID))
		add("parent_id", nil, valOrNil(after.ParentID))
		add("owner_id", nil, after.OwnerID)
		add("due_date", nil, valOrNil(after.DueDate))
		add("colour", nil, valOrNil(after.Colour))
		// Field name matches the field-library row (subscription's
		// `blocked` boolean) not the WorkItem Go-struct name. The
		// schema endpoint surfaces "blocked", so rule conditions
		// store "blocked" — the diff must use the same key.
		add("blocked", nil, after.IsBlocked)
		add("blocked_reason", nil, valOrNil(after.BlockedReason))
		add("milestone_id", nil, valOrNil(after.MilestoneID))
		add("release_id", nil, valOrNil(after.ReleaseID))
		return out
	}
	add("title", before.Title, after.Title)
	add("status", before.Status, after.Status)
	add("flow_state_id", before.FlowStateID, after.FlowStateID)
	add("flow_state", before.FlowStateName, after.FlowStateName)
	add("priority_id", before.PriorityID, after.PriorityID)
	add("story_points", valOrNil(before.StoryPoints), valOrNil(after.StoryPoints))
	add("sprint_id", valOrNil(before.SprintID), valOrNil(after.SprintID))
	add("parent_id", valOrNil(before.ParentID), valOrNil(after.ParentID))
	add("owner_id", before.OwnerID, after.OwnerID)
	add("due_date", valOrNil(before.DueDate), valOrNil(after.DueDate))
	add("colour", valOrNil(before.Colour), valOrNil(after.Colour))
	// See note in the Create branch — field name follows the field
	// library ("blocked"), not WorkItem.IsBlocked.
	add("blocked", before.IsBlocked, after.IsBlocked)
	add("blocked_reason", valOrNil(before.BlockedReason), valOrNil(after.BlockedReason))
	add("milestone_id", valOrNil(before.MilestoneID), valOrNil(after.MilestoneID))
	add("release_id", valOrNil(before.ReleaseID), valOrNil(after.ReleaseID))
	return out
}

// valOrNil unwraps *T → T-or-nil so the evaluator's `any` comparisons
// don't trip over typed-nil-vs-untyped-nil semantics.
func valOrNil[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

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

	// PLA062 S26 — Sentinel mandatory subtree clamp. Every artefact read
	// is bounded to the user's reachable subtree (computed by
	// sentinel.Middleware from JWT + topology). PLA-0043's ?scope=
	// further-narrowing path (below) intersects with this clamp so a
	// hostile caller can't widen scope by passing an ancestor node.
	// When the clamp is absent (admin / dev paths with no middleware),
	// SubtreeClause returns "" and the read falls back to
	// subscription-only narrowing — same pre-Sentinel behaviour.
	if mandatory, mArgs, mNext := sentinel.SubtreeClause(ctx, "a", args, n); mandatory != "" {
		extra = append(extra, mandatory[len(" AND "):]) // strip leading " AND "; the joiner adds it back
		args = mArgs
		n = mNext
	}

	// PLA-0043 — Topology scope further-narrowing. When the caller
	// passed ?scope=<id> we resolve the user's reachable subtree and
	// limit artefacts to that set. Intersects with the Sentinel clamp
	// above so the URL param can only narrow further, never widen.
	// NULL topology_node_id rows are excluded when scope is active
	// (un-assigned items are visible only in unscoped reads).
	//
	// PERF (2026-05-28) — fast path when ?meg= matches the Sentinel
	// focus node. That's the common case (every page passes its
	// current focus as ?meg=), and in that case the Sentinel middleware
	// has ALREADY done the access check + subtree resolution and put
	// the answer on the context. The SubtreeClause above already
	// applied it. Re-doing CanReadScope (1 SQL) + DescendantNodeIDs
	// (1 SQL recursive CTE) + ApplyClampToIDs (in-process intersect of
	// two identical sets) is pure duplicate work — measured 80-150ms on
	// a 116-row dev subscription. We short-circuit here so the hot path
	// makes 0 extra SQL calls; the slow path (?meg= different from
	// focus, e.g. legacy URLs or ?scope_dir=ascend) keeps the original
	// re-resolution because the answer genuinely differs from the
	// middleware's.
	if filters.ScopeNodeID != nil {
		clamp := sentinel.FromCtx(ctx)
		scopeMatchesFocus := clamp.FocusNodeID != uuid.Nil &&
			*filters.ScopeNodeID == clamp.FocusNodeID.String() &&
			filters.ScopeDirection != "ascend"
		if !scopeMatchesFocus {
			if s.topology == nil {
				return nil, 0, ErrInvalidInput
			}
			if filters.ActorUserID == nil || filters.ActorRoleID == uuid.Nil {
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
			ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, actorUserID, scopeNodeID, filters.ActorRoleID)
			if permErr != nil {
				if errors.Is(permErr, ErrNotFound) || errors.Is(permErr, ErrScopeNodeNotFound) {
					return nil, 0, ErrScopeNodeNotFound
				}
				return nil, 0, permErr
			}
			if !ok {
				return nil, 0, ErrScopeForbidden
			}
			var ids []uuid.UUID
			var resolveErr error
			if filters.ScopeDirection == "ascend" {
				ids, resolveErr = s.topology.AncestorNodeIDs(ctx, subscriptionID, scopeNodeID)
			} else {
				ids, resolveErr = s.topology.DescendantNodeIDs(ctx, subscriptionID, scopeNodeID)
			}
			if resolveErr != nil {
				return nil, 0, resolveErr
			}
			// Intersect with the Sentinel clamp (no-op when clamp absent).
			ids = sentinel.ApplyClampToIDs(ctx, ids)
			extra = append(extra, fmt.Sprintf("a.artefacts_id_topology_node = ANY($%d::uuid[])", n))
			args = append(args, ids)
			n++
		}
	}

	if filters.ParentID != nil {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_parent = $%d::uuid", n))
		args = append(args, *filters.ParentID)
		n++
	} else if len(filters.ItemType) == 0 && filters.ScopeNodeID == nil {
		// Default: top-level items only when no scope clamp is active.
		// When scope is active, artefacts at any depth in the topology
		// subtree are visible (their parents may live outside the node).
		extra = append(extra, "a.artefacts_id_parent IS NULL")
	}
	// PLA-0054 / story 00586: multi-value UUID filters. Empty slice is a
	// no-op; otherwise emit ANY($N::uuid[]) so the JOIN predicate matches
	// any artefact_type whose UUID is in the chip's selection. Rename-
	// invariant: matching by ID instead of lower(name).
	//
	// itemTypeBindIdx captures the $N used for the parent's ItemType clause
	// so the children_count scalar subquery can reuse the same bind (filter
	// children by the same allow-list). 0 means "no item_type filter in
	// play" — children_count stays unfiltered.
	itemTypeBindIdx := 0
	if len(filters.ItemType) > 0 {
		itemTypeBindIdx = n
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id = ANY($%d::uuid[])", n))
		args = append(args, filters.ItemType)
		n++
	}
	if len(filters.Status) > 0 {
		// PLA-0054 / story 00585: Status filter is now flow_state_id list
		// (the artefact's current flow state, not a translated kind slug).
		extra = append(extra, fmt.Sprintf("a.artefacts_id_flow_state = ANY($%d::uuid[])", n))
		args = append(args, filters.Status)
		n++
	}
	if len(filters.Priority) > 0 {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_priority = ANY($%d::uuid[])", n))
		args = append(args, filters.Priority)
		n++
	}
	if filters.SprintIDIsNull {
		// __none__ sentinel — items with no sprint assigned. Used by
		// the /value-sprint backlog tree (mutual exclusion with the
		// sprint-panel tree). No bind needed; constant predicate.
		extra = append(extra, "a.artefacts_id_timebox_sprint IS NULL")
	} else if filters.SprintID != nil {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *filters.SprintID)
		n++
	}
	if len(filters.OwnerID) > 0 {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_user_owned_by = ANY($%d::uuid[])", n))
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

	// Children-count slot — when an item_type_id allow-list is in play,
	// mirror it inside the children_count scalar subquery so a parent
	// whose only children are of excluded types reports 0. The frontend
	// expander gates on children_count, so 0 hides the expander and the
	// row no longer pretends to have hidden descendants. Reuses the
	// parent ItemType bind (itemTypeBindIdx) — no new arg appended.
	childExtra := ""
	if itemTypeBindIdx > 0 {
		childExtra = fmt.Sprintf("\n	   AND child.artefacts_id_artefact_type = ANY($%d::uuid[])", itemTypeBindIdx)
	}

	dataQ := fmt.Sprintf(sqlListWorkItemsTemplate, childExtra, extraWhere, orderBy, limitN, offsetN)

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

// FacetSet is the result of ListFacets — distinct UUIDs of artefact types
// and priorities reachable in the caller's current scope. Used by filter-chip
// UIs that need to enumerate "what's actually in this scope" rather than
// "what's defined in the workspace catalogue" — see PLA057 / TD-CHIP-SCOPE-MISMATCH.
type FacetSet struct {
	ArtefactTypeIDs []uuid.UUID `json:"artefact_type_ids"`
	PriorityIDs     []uuid.UUID `json:"priority_ids"`
}

// FacetFilters carries the same row-level clamps the List endpoint
// honours, so the facet chip wheel agrees with the grid below it. When
// the page passes ?item_type_id=<a>,<b> and ?sprint_id=__none__ to the
// LIST, the chip wheel rendering the Type filter MUST be filtered
// through the same clauses — otherwise the wheel shows Epic+Task even
// when the row-level clamp hides Tasks. Origin: 2026-05-28 /value-sprint
// page where the wheel disagreed with the rows.
//
// Empty / nil fields are no-ops. SprintID and SprintIDIsNull mirror the
// row-level Filters convention: the __none__ sentinel sets IsNull=true
// and SprintID stays nil; a UUID sets SprintID and IsNull stays false.
type FacetFilters struct {
	ItemType       []uuid.UUID
	SprintID       *string
	SprintIDIsNull bool
}

// ListFacets returns the distinct artefact_type_id and priority_id values
// of live (non-archived) artefacts in the caller's scope. Mirrors the
// ListWorkItems scope-clamp pipeline so the chip surface always agrees
// with the grid surface — same workspace clamp, same topology clamp,
// same archived exclusion.
//
// When workspaceID is uuid.Nil, the workspace clamp is omitted (legacy /
// admin-tool callers without WorkspaceClampMiddleware). When scopeNodeID
// is uuid.Nil, the topology clamp is omitted (unscoped view returns
// workspace-wide facets). actorUserID + actorRoleID are required only
// when scopeNodeID is non-nil — they feed the CanReadScope check.
//
// Two small DISTINCT queries — kept separate to avoid a CROSS JOIN's
// row blow-up and to let the caller's TypeID + PriorityID lookups
// remain independently fast. If the perf shape ever wants one
// round-trip, a single CTE with two SELECTs UNION ALL'd is the
// obvious next step.
func (s *Service) ListFacets(
	ctx context.Context,
	subscriptionID, workspaceID, scopeNodeID, actorUserID, actorRoleID uuid.UUID,
	filters FacetFilters,
) (FacetSet, error) {
	if s.vectorArtefactsPool == nil {
		return FacetSet{}, nil
	}

	// $1 = subscriptionID (always). $2 = scope (always). Extras start at $3.
	args := []any{subscriptionID, s.scope}
	n := 3
	var extra []string

	// Workspace clamp — defence-in-depth, matches ListWorkItems.
	if workspaceID != uuid.Nil {
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id_workspace = $%d::uuid", n))
		args = append(args, workspaceID)
		n++
	}

	// PLA062 S26 — Sentinel mandatory subtree clamp (matches ListWorkItems).
	if mandatory, mArgs, mNext := sentinel.SubtreeClause(ctx, "a", args, n); mandatory != "" {
		extra = append(extra, mandatory[len(" AND "):])
		args = mArgs
		n = mNext
	}

	// PLA-0043 — Topology scope further-narrowing. Intersects with the
	// Sentinel clamp above so the URL param can only narrow further.
	//
	// PERF (2026-05-28) — fast path when ?meg= matches the Sentinel focus
	// node (mirrors the ListWorkItems fast path in commit 9cb8e7d2). In
	// the common case (every page passes its current focus as ?meg=), the
	// Sentinel middleware has ALREADY done the access check + subtree
	// resolution and the SubtreeClause above already applied it. Re-doing
	// CanReadScope (1 SQL) + DescendantNodeIDs (1 SQL recursive CTE) +
	// ApplyClampToIDs (in-process intersect of two identical sets) is
	// pure duplicate work. Facets has no scope_dir param — always descend
	// — so the only condition is `scopeNodeID == FocusNodeID`. Slow path
	// kept for the legacy case where the caller asks about a different
	// node than the request's focus.
	if scopeNodeID != uuid.Nil {
		clamp := sentinel.FromCtx(ctx)
		scopeMatchesFocus := clamp.FocusNodeID != uuid.Nil &&
			scopeNodeID == clamp.FocusNodeID
		if !scopeMatchesFocus {
			if s.topology == nil {
				return FacetSet{}, ErrInvalidInput
			}
			if actorUserID == uuid.Nil || actorRoleID == uuid.Nil {
				return FacetSet{}, ErrInvalidInput
			}
			ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, actorUserID, scopeNodeID, actorRoleID)
			if permErr != nil {
				if errors.Is(permErr, ErrNotFound) || errors.Is(permErr, ErrScopeNodeNotFound) {
					return FacetSet{}, ErrScopeNodeNotFound
				}
				return FacetSet{}, permErr
			}
			if !ok {
				return FacetSet{}, ErrScopeForbidden
			}
			ids, resolveErr := s.topology.DescendantNodeIDs(ctx, subscriptionID, scopeNodeID)
			if resolveErr != nil {
				return FacetSet{}, resolveErr
			}
			ids = sentinel.ApplyClampToIDs(ctx, ids)
			extra = append(extra, fmt.Sprintf("a.artefacts_id_topology_node = ANY($%d::uuid[])", n))
			args = append(args, ids)
			n++
		}
	}

	// Row-level filter parity with ListWorkItems. The chip surface must
	// reflect what the grid below actually shows: when the page clamps
	// to item_type_id=<a,b,c> + sprint_id=__none__, the Type wheel can
	// only show types reachable INSIDE that clamp. Without this, the
	// wheel disagrees with the rows (e.g. the /value-sprint backlog
	// renders Story-only rows yet the wheel listed Epic + Task too).
	if len(filters.ItemType) > 0 {
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id = ANY($%d::uuid[])", n))
		args = append(args, filters.ItemType)
		n++
	}
	if filters.SprintIDIsNull {
		extra = append(extra, "a.artefacts_id_timebox_sprint IS NULL")
	} else if filters.SprintID != nil {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *filters.SprintID)
		n++
	}

	extraWhere := ""
	if len(extra) > 0 {
		extraWhere = "\n  AND " + strings.Join(extra, "\n  AND ")
	}

	typeQ := fmt.Sprintf(sqlListFacetTypesTemplate, extraWhere)
	priQ := fmt.Sprintf(sqlListFacetPrioritiesTemplate, extraWhere)

	out := FacetSet{ArtefactTypeIDs: []uuid.UUID{}, PriorityIDs: []uuid.UUID{}}
	rows, err := s.vectorArtefactsPool.Query(ctx, typeQ, args...)
	if err != nil {
		return FacetSet{}, fmt.Errorf("artefactitems.ListFacets types: %w", err)
	}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return FacetSet{}, fmt.Errorf("artefactitems.ListFacets types scan: %w", err)
		}
		out.ArtefactTypeIDs = append(out.ArtefactTypeIDs, id)
	}
	rows.Close()

	rows2, err := s.vectorArtefactsPool.Query(ctx, priQ, args...)
	if err != nil {
		return FacetSet{}, fmt.Errorf("artefactitems.ListFacets priorities: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var id uuid.UUID
		if err := rows2.Scan(&id); err != nil {
			return FacetSet{}, fmt.Errorf("artefactitems.ListFacets priorities scan: %w", err)
		}
		out.PriorityIDs = append(out.PriorityIDs, id)
	}

	return out, nil
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
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// PLA062 S26 — Sentinel mandatory subtree clamp. The list paths
	// splice the clamp into SQL; single-row reads use a static SELECT
	// for the existing-id 404 contract, so we post-filter here. When
	// the clamp is absent (admin / dev), allow the read. When the
	// clamp is present and the artefact's topology_node_id falls
	// outside it (or is NULL — un-pinned, treated as out-of-scope per
	// the project convention), surface ErrNotFound to preserve the
	// no-existence-leak property. A 404 here is procurement-equivalent
	// to a 403 for the data exposure question.
	if c := sentinel.FromCtx(ctx); len(c.AllowedSubtreeIDs) > 0 {
		if wi.TopologyNodeID == nil {
			return nil, ErrNotFound
		}
		nodeID, parseErr := uuid.Parse(*wi.TopologyNodeID)
		if parseErr != nil {
			return nil, ErrNotFound
		}
		allowed := false
		for _, id := range c.AllowedSubtreeIDs {
			if id == nodeID {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, ErrNotFound
		}
	}
	items := []WorkItem{*wi}
	if err := s.decorateOwners(ctx, items); err != nil {
		return nil, err
	}
	wi = &items[0]
	return wi, nil
}

// ChildFilters carries the same row-level filters /work-items LIST
// accepts (item_type_id allow-list, sprint_id incl. __none__ sentinel)
// so the chevron-expand view honours the same clamps as the parent
// LIST. Without this, expanding a row leaks children of types or
// sprints the user has clamped out at the page level — e.g. Tasks
// appear under a Story on /value-sprint even though the page-level
// item_type_id clamp hides them. Origin: 2026-05-28 value-sprint
// "expand-shows-nothing" bug (which was the malformed URL); fix here
// makes the backend respect the clamps so a corrected URL gets a
// correct row set.
//
// Empty/nil fields are no-ops. SprintIDIsNull mirrors the row-level
// Filters convention: the __none__ sentinel sets IsNull=true and
// SprintID stays nil; a UUID sets SprintID and IsNull stays false.
type ChildFilters struct {
	ItemType       []uuid.UUID
	SprintID       *string
	SprintIDIsNull bool
}

// ListChildren returns direct children of parentID scoped to the
// subscription, optionally filtered by item_type_id allow-list and/or
// sprint_id (with the __none__ sentinel meaning "no sprint assigned").
// When filters are empty, returns every direct child — same shape as
// the pre-2026-05-28 zero-arg version.
func (s *Service) ListChildren(ctx context.Context, subscriptionID uuid.UUID, parentID uuid.UUID, filters ChildFilters) ([]WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItem{}, nil
	}

	// $1 = subscriptionID, $2 = parentID, $3 = scope. Extras start at $4.
	args := []any{subscriptionID, parentID, s.scope}
	n := 4
	var extra []string

	if len(filters.ItemType) > 0 {
		extra = append(extra, fmt.Sprintf("at.artefacts_types_id = ANY($%d::uuid[])", n))
		args = append(args, filters.ItemType)
		n++
	}
	if filters.SprintIDIsNull {
		extra = append(extra, "a.artefacts_id_timebox_sprint IS NULL")
	} else if filters.SprintID != nil {
		extra = append(extra, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *filters.SprintID)
		n++
	}

	extraWhere := ""
	if len(extra) > 0 {
		extraWhere = "\n  AND " + strings.Join(extra, "\n  AND ")
	}

	q := fmt.Sprintf(sqlListChildWorkItemsTemplate, extraWhere)

	rows, err := s.vectorArtefactsPool.Query(ctx, q, args...)
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
// PLA-0043 / 2026-05-18: optional scopeNodeID clamps the counts to a
// topology subtree (same descendants the List query uses), so the
// summary strip and the tree below it stay in sync. When set,
// actorUserID + actorRoleID gate the permission check via
// topology.CanReadScope. Unscoped calls (all three nil/empty) keep
// the legacy subscription-wide behaviour.
//
// B21 (PLA-0037): the by-type bucket map is populated data-driven from
// artefacts_types.name so portfolio/strategy scopes (which have no
// epic/story/task/defect static fields) still get a useful summary. The
// fixed Epics/Stories/Tasks/Defects fields remain populated from ByType
// for back-compat with the v2 work-items page header.
func (s *Service) SummariseWorkItems(
	ctx context.Context,
	subscriptionID uuid.UUID,
	sprintID *string,
	scopeNodeID *string,
	actorUserID *string,
	actorRoleID uuid.UUID,
	scopeDirection string,
) (WorkItemsSummary, error) {
	out := WorkItemsSummary{ByType: map[string]int{}}
	if s.vectorArtefactsPool == nil {
		return out, nil
	}
	args := []any{subscriptionID, s.scope}
	conds := []string{
		"a.artefacts_id_subscription = $1",
		"a.artefacts_archived_at IS NULL",
		"at.artefacts_types_scope = $2",
	}
	n := 3
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("a.artefacts_id_timebox_sprint = $%d::uuid", n))
		args = append(args, *sprintID)
		n++
	}
	// PLA062 S26 — Sentinel mandatory subtree clamp.
	if mandatory, mArgs, mNext := sentinel.SubtreeClause(ctx, "a", args, n); mandatory != "" {
		conds = append(conds, mandatory[len(" AND "):])
		args = mArgs
		n = mNext
	}
	// Topology scope further-narrowing. Intersects with the Sentinel
	// clamp above so the URL param can only narrow further. NULL
	// topology_node_id rows are excluded when scope is active (matches
	// the List behaviour: unscoped reads only see un-assigned items).
	//
	// PERF (2026-05-28) — fast path when ?meg= matches the Sentinel
	// focus node (mirrors the ListWorkItems fast path in commit 9cb8e7d2).
	// The summary header is rendered on the same page as the work-items
	// grid and shares its ?meg= value — so it hits this branch on every
	// page load. Sentinel middleware has ALREADY done the access check +
	// subtree resolution and the SubtreeClause above already applied it.
	// Re-doing CanReadScope + DescendantNodeIDs + ApplyClampToIDs is pure
	// duplicate work. Condition matches ListWorkItems: focus equal AND
	// not ascending (the ascend path resolves a different ID set than the
	// middleware's default descend, so its slow path is genuine).
	if scopeNodeID != nil && *scopeNodeID != "" {
		clamp := sentinel.FromCtx(ctx)
		scopeMatchesFocus := clamp.FocusNodeID != uuid.Nil &&
			*scopeNodeID == clamp.FocusNodeID.String() &&
			scopeDirection != "ascend"
		if !scopeMatchesFocus {
			if s.topology == nil {
				return out, ErrInvalidInput
			}
			if actorUserID == nil || actorRoleID == uuid.Nil {
				return out, ErrInvalidInput
			}
			nodeUUID, parseErr := uuid.Parse(*scopeNodeID)
			if parseErr != nil {
				return out, ErrInvalidInput
			}
			actorUUID, parseErr := uuid.Parse(*actorUserID)
			if parseErr != nil {
				return out, ErrInvalidInput
			}
			ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, actorUUID, nodeUUID, actorRoleID)
			if permErr != nil {
				if errors.Is(permErr, ErrNotFound) || errors.Is(permErr, ErrScopeNodeNotFound) {
					return out, ErrScopeNodeNotFound
				}
				return out, permErr
			}
			if !ok {
				return out, ErrScopeForbidden
			}
			var ids []uuid.UUID
			var resolveErr error
			if scopeDirection == "ascend" {
				ids, resolveErr = s.topology.AncestorNodeIDs(ctx, subscriptionID, nodeUUID)
			} else {
				ids, resolveErr = s.topology.DescendantNodeIDs(ctx, subscriptionID, nodeUUID)
			}
			if resolveErr != nil {
				return out, resolveErr
			}
			ids = sentinel.ApplyClampToIDs(ctx, ids)
			conds = append(conds, fmt.Sprintf("a.artefacts_id_topology_node = ANY($%d::uuid[])", n))
			args = append(args, ids)
			n++
		}
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

// ListFlowStates returns the flow states for one or more artefact types.
// When artefactTypeIDs is empty the legacy behaviour applies — picks the
// first work-scoped artefact type owned by this subscription and returns
// a flat list. When non-empty the SQL fans out to ANY($1::uuid[]) and
// returns a flat list ordered (artefact_type_id, sort_order). The handler
// groups by ArtefactTypeID into a by-type map for the wire response.
// Subscription clamp is enforced in both branches.
func (s *Service) ListFlowStates(ctx context.Context, subscriptionID uuid.UUID, artefactTypeIDs []uuid.UUID) ([]WorkItemFlowState, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItemFlowState{}, nil
	}
	var rows pgx.Rows
	var err error
	if len(artefactTypeIDs) > 0 {
		rows, err = s.vectorArtefactsPool.Query(ctx, sqlListFlowStatesByArtefactType,
			artefactTypeIDs, subscriptionID,
		)
	} else {
		rows, err = s.vectorArtefactsPool.Query(ctx, sqlListWorkScopeFlowStates,
			subscriptionID, s.scope,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var states []WorkItemFlowState
	byType := len(artefactTypeIDs) > 0
	for rows.Next() {
		var st WorkItemFlowState
		if byType {
			if err := rows.Scan(&st.ArtefactTypeID, &st.ID, &st.Position, &st.Name, &st.CanonicalCode, &st.Colour); err != nil {
				return nil, err
			}
		} else {
			if err := rows.Scan(&st.ID, &st.Position, &st.Name, &st.CanonicalCode, &st.Colour); err != nil {
				return nil, err
			}
		}
		states = append(states, st)
	}
	if states == nil {
		states = []WorkItemFlowState{}
	}
	return states, rows.Err()
}

// ListAncestors returns the parent chain of an artefact, ordered
// immediate-parent-first (depth=1) up to the topmost ancestor. Empty
// slice when the artefact has no parent. Subscription clamp is enforced
// both on the starting row and every walked row by the SQL CTE.
func (s *Service) ListAncestors(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) ([]AncestorRef, error) {
	if s.vectorArtefactsPool == nil {
		return []AncestorRef{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlSelectAncestors, id, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AncestorRef
	for rows.Next() {
		var r AncestorRef
		if err := rows.Scan(&r.ID, &r.TypePrefix, &r.KeyNum, &r.Title, &r.ParentID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []AncestorRef{}
	}
	return out, rows.Err()
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

	// PLA-0043 writer path — when the caller passed ?meg=<uuid>, pin the
	// new artefact to that topology node. Validation mirrors the read
	// path (ListWorkItems / Summary): the node must exist in the actor's
	// tenant AND the actor must hold a role grant that reaches it.
	// Without this, NULL topology_node_id rows become zombies — visible
	// to unscoped reads but invisible to any per-node clamp.
	var topologyNodeID *uuid.UUID
	if in.TopologyNodeID != nil && *in.TopologyNodeID != "" {
		if s.topology == nil {
			return nil, ErrInvalidInput
		}
		if in.ActorRoleID == uuid.Nil {
			return nil, ErrInvalidInput
		}
		nodeUUID, parseErr := uuid.Parse(*in.TopologyNodeID)
		if parseErr != nil {
			return nil, fmt.Errorf("%w: invalid topology_node_id", ErrInvalidInput)
		}
		actorUUID, parseErr := uuid.Parse(in.CreatedBy)
		if parseErr != nil || actorUUID == uuid.Nil {
			return nil, ErrInvalidInput
		}
		ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, actorUUID, nodeUUID, in.ActorRoleID)
		if permErr != nil {
			if errors.Is(permErr, ErrNotFound) || errors.Is(permErr, ErrScopeNodeNotFound) {
				return nil, ErrScopeNodeNotFound
			}
			return nil, permErr
		}
		if !ok {
			return nil, ErrScopeForbidden
		}
		topologyNodeID = &nodeUUID
	}

	// Append to existing items (position = MAX + 100).
	var pos int
	_ = tx.QueryRow(ctx, sqlSelectNextArtefactPosition,
		subscriptionID, artefactTypeID,
	).Scan(&pos)

	// PLA-0055 / story 00595+00597 — resolve priority_id. Use the
	// caller's UUID when provided + valid; otherwise pick the
	// workspace's default (pri_medium row, or lowest sort_order).
	var priorityID uuid.UUID
	if in.PriorityID != nil && *in.PriorityID != "" {
		pid, perr := uuid.Parse(*in.PriorityID)
		if perr != nil {
			return nil, fmt.Errorf("%w: invalid priority_id", ErrInvalidInput)
		}
		priorityID = pid
	} else {
		err = tx.QueryRow(ctx, sqlSelectDefaultPriorityForWorkspace, workspaceID).Scan(&priorityID)
		if err != nil {
			return nil, fmt.Errorf("resolve default priority for workspace %s: %w", workspaceID, err)
		}
	}

	err = tx.QueryRow(ctx, sqlInsertArtefact,
		subscriptionID, workspaceID, artefactTypeID, num,
		in.Title, in.Description,
		defaultFlowStateID, priorityID, in.StoryPoints, sprintID, parentID,
		ownerID, createdBy, pos, topologyNodeID,
	).Scan(&newID)
	if err != nil {
		return nil, err
	}

	// Custom-field values land inside the same transaction so the artefact
	// row + its values are committed atomically. Each value is routed to
	// the right *_value column by looking up field_type from the library;
	// mismatched value/type combos return ErrInvalidInput and roll the
	// whole create back. We do NOT re-fetch the library row in a loop —
	// each upsert is one round-trip into the txn pool, which is the
	// minimum the existing UpsertFieldValues path also does.
	for _, cf := range in.CustomFields {
		fieldUUID, ferr := uuid.Parse(cf.FieldLibraryID)
		if ferr != nil {
			return nil, fmt.Errorf("%w: invalid field_library_id %q", ErrInvalidInput, cf.FieldLibraryID)
		}
		var fieldType string
		if ferr := tx.QueryRow(ctx, sqlSelectFieldLibraryType, fieldUUID, subscriptionID).Scan(&fieldType); ferr != nil {
			return nil, fmt.Errorf("%w: field %s not in tenant catalogue", ErrInvalidInput, fieldUUID)
		}
		// Route the value to the typed column. typeValueColumn (types.go)
		// returns the full *_value column suffix used by both the
		// per-artefact UpsertFieldValues path and this create-time path;
		// keep them in lockstep on any change.
		var s, n, t, d *string
		switch typeValueColumn(fieldType) {
		case "string_value":
			s = cf.StringValue
		case "number_value":
			n = cf.NumberValue
		case "text_value":
			t = cf.TextValue
		case "date_value":
			d = cf.DateValue
		}
		if _, werr := tx.Exec(ctx, sqlUpsertFieldValue, newID, fieldUUID, s, n, t, d); werr != nil {
			return nil, fmt.Errorf("write custom field %s: %w", fieldUUID, werr)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	item, err := s.GetWorkItem(ctx, subscriptionID, newID)
	if err != nil {
		return nil, err
	}
	s.notifier.Fire(subscriptionID, "item.created", item)

	// Cascade — a new child appearing under a parent can flip the
	// parent's derived state (e.g. an Epic with one Done Story gets a
	// new Backlog Story added → Epic flips to in_progress eventually,
	// but immediately the "all done" bucket no longer holds).
	if parentID != nil {
		_ = s.recalcParentFlowState(ctx, subscriptionID, *parentID)
	}

	// Notification-rules hook — Create has no before-state; pass nil
	// so `changed_to <value>` rules still fire (nil → new value). The
	// caller is the just-parsed createdBy (handler reads it from the
	// auth-context at the transport boundary).
	if s.ruleHook != nil {
		s.fireRuleHook(ctx, nil, item, createdBy)
	}
	return item, nil
}

// PatchWorkItem applies a partial update to an artefact row.
//
// Flow-state cascade integration (recalc.go):
//   - If the caller PATCHes flow_state_id on a row that has live
//     children, the request is rejected with ErrParentFlowStateDerived.
//     Parented rows' states are DERIVED from their children (work
//     flows up); manual writes are not allowed. Server-side gate;
//     the frontend pill row is also disabled for parented rows but
//     this is defence-in-depth (HARD RULE: SERVER IS THE GATE).
//   - After a successful flow_state_id write, the cascade fires on the
//     patched row's parent (Task done → Story recalcs → Epic recalcs).
//   - After a parent_artefact_id write (re-parent), the cascade fires
//     on BOTH the OLD and NEW parent — either side's child set changed.
func (s *Service) PatchWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID, in PatchWorkItemInput) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	if in.Status != nil && !validStatuses[*in.Status] {
		return nil, fmt.Errorf("%w: invalid status", ErrInvalidInput)
	}
	// Core-field demotion (mig 147) — mirror the DB CHECK constraints
	// for defect_severity / defect_status so a bad patch returns 400
	// before the round-trip. Empty string is the wire "clear-to-NULL"
	// sentinel; allowed values are the CHECK list verbatim.
	if in.DefectSeverity != nil && *in.DefectSeverity != "" && !validDefectSeverities[*in.DefectSeverity] {
		return nil, fmt.Errorf("%w: invalid defect_severity", ErrInvalidInput)
	}
	if in.DefectStatus != nil && *in.DefectStatus != "" && !validDefectStatuses[*in.DefectStatus] {
		return nil, fmt.Errorf("%w: invalid defect_status", ErrInvalidInput)
	}
	// Rally-screenshots batch (mig 151+152+155) — mirror the DB CHECK
	// constraints handler-side so a bad patch returns 400 BEFORE the
	// round-trip (cleaner error than the trigger's '23514' from SQL).
	// Empty string is the wire "clear-to-NULL" sentinel — allowed for
	// every CHECK-bound *string column.
	if in.DefectResolution != nil && *in.DefectResolution != "" && !validDefectResolutions[*in.DefectResolution] {
		return nil, fmt.Errorf("%w: invalid defect_resolution", ErrInvalidInput)
	}
	if in.DefectTestCaseStatus != nil && *in.DefectTestCaseStatus != "" && !validDefectTestCaseStatuses[*in.DefectTestCaseStatus] {
		return nil, fmt.Errorf("%w: invalid defect_test_case_status", ErrInvalidInput)
	}
	if in.RiskResolution != nil && *in.RiskResolution != "" && !validRiskResolutions[*in.RiskResolution] {
		return nil, fmt.Errorf("%w: invalid risk_resolution", ErrInvalidInput)
	}
	if in.RiskImpact != nil && *in.RiskImpact != "" && !validRiskImpacts[*in.RiskImpact] {
		return nil, fmt.Errorf("%w: invalid risk_impact", ErrInvalidInput)
	}
	if in.RiskProbability != nil && *in.RiskProbability != "" && !validRiskProbabilities[*in.RiskProbability] {
		return nil, fmt.Errorf("%w: invalid risk_probability", ErrInvalidInput)
	}
	if in.RiskResponse != nil && *in.RiskResponse != "" && !validRiskResponses[*in.RiskResponse] {
		return nil, fmt.Errorf("%w: invalid risk_response", ErrInvalidInput)
	}
	// EstimateInitial is now the bucket NAME (mig 155 ALTERed it from
	// NUMERIC to TEXT). The numeric value-per-bucket lives in the new
	// EstimateInitialValue column. Mirror the bucket-vocab CHECK here.
	if in.EstimateInitial != nil && *in.EstimateInitial != "" && !validEstimateInitialBuckets[*in.EstimateInitial] {
		return nil, fmt.Errorf("%w: invalid estimate_initial bucket", ErrInvalidInput)
	}
	// Risk score range gates (1..4 impact, 1..3 probability) per mig 152
	// — mirror the per-column CHECK so the handler returns 400 before
	// the round-trip rather than letting the DB raise 23514.
	if in.RiskImpactScore != nil && (*in.RiskImpactScore < 1 || *in.RiskImpactScore > 4) {
		return nil, fmt.Errorf("%w: risk_impact_score out of range (1..4)", ErrInvalidInput)
	}
	if in.RiskProbabilityScore != nil && (*in.RiskProbabilityScore < 1 || *in.RiskProbabilityScore > 3) {
		return nil, fmt.Errorf("%w: risk_probability_score out of range (1..3)", ErrInvalidInput)
	}
	// Submitted-by must be a parseable UUID — the FK constraint catches
	// non-existent users, but bad-UUID is a faster handler-side reject.
	if in.SubmittedByUserID != nil && *in.SubmittedByUserID != "" {
		if _, perr := uuid.Parse(*in.SubmittedByUserID); perr != nil {
			return nil, fmt.Errorf("%w: invalid submitted_by_user_id", ErrInvalidInput)
		}
	}

	// Snapshot the before-state for the notification-rules hook.
	// Skipped (and cost-free) when no rule hook is wired. Errors
	// here are best-effort — we don't want a snapshot failure to
	// block the legitimate write.
	var beforeSnapshot *WorkItem
	if s.ruleHook != nil {
		if snap, snapErr := s.GetWorkItem(ctx, subscriptionID, id); snapErr == nil {
			beforeSnapshot = snap
		}
	}
	// PLA-0055 / story 00595+00597 — priority is a UUID FK. PriorityID
	// must be a parseable UUID; the FK constraint guarantees it points
	// at a real artefact_priorities row (no need for an enum allow-list).
	if in.PriorityID != nil && *in.PriorityID != "" {
		if _, perr := uuid.Parse(*in.PriorityID); perr != nil {
			return nil, fmt.Errorf("%w: invalid priority_id", ErrInvalidInput)
		}
	}

	// Cascade guard — reject manual flow_state_id writes on parented
	// rows BEFORE the UPDATE runs (don't half-write, then fail). Skipped
	// when the request isn't touching flow_state_id at all.
	//
	// Exception: a parent at a TERMINAL state (done / accepted) is back
	// in the user's hands. The cascade has finished its job; from here
	// the user is allowed to move the row to accepted (manual gate the
	// cascade never auto-fires) OR push it back to an earlier state for
	// further work. The cascade re-asserts the rule the next time a
	// child changes — so any pushback is a temporary user override, not
	// a permanent escape from the derived-state contract.
	if in.FlowStateID != nil {
		hasKids, gerr := s.hasLiveChildren(ctx, subscriptionID, id)
		if gerr != nil {
			return nil, gerr
		}
		if hasKids {
			currentKind, kerr := s.currentFlowStateKind(ctx, subscriptionID, id)
			if kerr != nil {
				return nil, kerr
			}
			if currentKind != "done" && currentKind != "accepted" {
				return nil, ErrParentFlowStateDerived
			}
		}
	}

	// If the caller is re-parenting, snapshot the OLD parent_id BEFORE
	// the UPDATE so we can recalc it afterwards. The UPDATE replaces it,
	// and post-UPDATE we'd only have the NEW parent. Both need a recalc.
	var oldParentID *uuid.UUID
	if in.ParentArtefactID != nil {
		op, perr := s.loadParentID(ctx, id)
		if perr == nil {
			oldParentID = op
		}
	}

	sets := []string{"artefacts_updated_at = now()"}
	args := []any{}
	n := 1

	if in.Title != nil {
		sets = append(sets, fmt.Sprintf("artefacts_title = $%d", n))
		args = append(args, *in.Title)
		n++
	}
	if in.Description != nil {
		sets = append(sets, fmt.Sprintf("artefacts_description = $%d", n))
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
		sets = append(sets, fmt.Sprintf("artefacts_id_flow_state = $%d::uuid", n))
		args = append(args, *in.FlowStateID)
		n++
	}
	if in.PriorityID != nil && *in.PriorityID != "" {
		// priority_id is NOT NULL FK post-migration; explicit "clear to
		// NULL" path is no longer supported. Callers wanting to "reset"
		// must send the workspace's default priority UUID (resolved via
		// the catalogue's useDefaultPriority on the frontend).
		sets = append(sets, fmt.Sprintf("artefacts_id_priority = $%d::uuid", n))
		args = append(args, *in.PriorityID)
		n++
	}
	if in.StoryPoints != nil {
		sets = append(sets, fmt.Sprintf("artefacts_story_points = $%d", n))
		args = append(args, *in.StoryPoints)
		n++
	}
	if in.SprintID != nil {
		// Keep the denormalised label in lockstep with the FK — clear to
		// NULL on unassign, derive via the shared scalar-subquery fragment
		// on assign. Both SET clauses reference the same $n bind so the
		// FK + label are computed from the same sprint_id.
		if *in.SprintID == "" {
			sets = append(sets, "artefacts_id_timebox_sprint = NULL")
			sets = append(sets, "artefacts_timebox_sprint_label = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_timebox_sprint = $%d::uuid", n))
			sets = append(sets, "artefacts_timebox_sprint_label = "+fmt.Sprintf(sqlDeriveSprintLabelSubquery, n))
			args = append(args, *in.SprintID)
			n++
		}
	}
	if in.DueDate != nil {
		if *in.DueDate == "" {
			sets = append(sets, "artefacts_due_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_due_date = $%d::date", n))
			args = append(args, *in.DueDate)
			n++
		}
	}
	if in.Colour != nil {
		if *in.Colour == "" {
			sets = append(sets, "artefacts_colour = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_colour = $%d", n))
			args = append(args, *in.Colour)
			n++
		}
	}
	if in.IsBlocked != nil {
		sets = append(sets, fmt.Sprintf("artefacts_is_blocked = $%d", n))
		args = append(args, *in.IsBlocked)
		n++
	}
	if in.BlockedReason != nil {
		if *in.BlockedReason == "" {
			sets = append(sets, "artefacts_blocked_reason = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_blocked_reason = $%d", n))
			args = append(args, *in.BlockedReason)
			n++
		}
	}
	if in.ReleaseID != nil {
		if *in.ReleaseID == "" {
			sets = append(sets, "artefacts_id_timebox_release = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_timebox_release = $%d::uuid", n))
			args = append(args, *in.ReleaseID)
			n++
		}
	}
	if in.MilestoneID != nil {
		if *in.MilestoneID == "" {
			sets = append(sets, "artefacts_id_timebox_milestone = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_timebox_milestone = $%d::uuid", n))
			args = append(args, *in.MilestoneID)
			n++
		}
	}
	if in.OwnedByUserID != nil {
		if *in.OwnedByUserID == "" {
			sets = append(sets, "artefacts_id_user_owned_by = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_user_owned_by = $%d::uuid", n))
			args = append(args, *in.OwnedByUserID)
			n++
		}
	}
	if in.ParentArtefactID != nil {
		if *in.ParentArtefactID == "" {
			sets = append(sets, "artefacts_id_parent = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_parent = $%d::uuid", n))
			args = append(args, *in.ParentArtefactID)
			n++
		}
	}
	// Track whether the patch rebinds topology so the post-write GetWorkItem
	// can carve out of the entry-time subtree clamp — if we let it 404 here
	// the user just moved a row "out of their own view" and gets a hostile
	// error even though the write succeeded and was authorised.
	topologyRebound := false
	if in.TopologyNodeID != nil {
		if *in.TopologyNodeID == "" {
			sets = append(sets, "artefacts_id_topology_node = NULL")
			topologyRebound = true
		} else {
			// SERVER-IS-GATE: mirror the CanReadScope check that
			// CreateWorkItem already runs (service.go § create). Without it
			// a non-gadmin can PATCH topology_node_id to any UUID — moving
			// the artefact onto a node they hold no grant on, effectively
			// hiding it from themselves AND from anyone whose scope doesn't
			// include the new node. The Resolver short-circuits to true for
			// SystemGrpGlobalID so gadmin keeps its synthetic-grant freedom.
			if s.topology == nil {
				return nil, ErrInvalidInput
			}
			if in.ActorRoleID == uuid.Nil {
				return nil, ErrInvalidInput
			}
			nodeUUID, parseErr := uuid.Parse(*in.TopologyNodeID)
			if parseErr != nil {
				return nil, fmt.Errorf("%w: invalid topology_node_id", ErrInvalidInput)
			}
			if in.AuthorUserID == uuid.Nil {
				return nil, ErrInvalidInput
			}
			ok, permErr := s.topology.CanReadScope(ctx, subscriptionID, in.AuthorUserID, nodeUUID, in.ActorRoleID)
			if permErr != nil {
				if errors.Is(permErr, ErrNotFound) || errors.Is(permErr, ErrScopeNodeNotFound) {
					return nil, ErrScopeNodeNotFound
				}
				return nil, permErr
			}
			if !ok {
				return nil, ErrScopeForbidden
			}
			sets = append(sets, fmt.Sprintf("artefacts_id_topology_node = $%d::uuid", n))
			args = append(args, *in.TopologyNodeID)
			n++
			topologyRebound = true
		}
	}
	if in.DescriptionDoc != nil {
		raw := string(*in.DescriptionDoc)
		// "null", "" or "{}" all mean "clear to NULL". Any other JSON
		// is stored verbatim — pgx maps json.RawMessage to JSONB.
		if raw == "" || raw == "null" || raw == "{}" {
			sets = append(sets, "artefacts_description_doc = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_description_doc = $%d::jsonb", n))
			args = append(args, *in.DescriptionDoc)
			n++
		}
	}

	// ── Core-field demotion (mig 147) ──
	// All three-state on *string (nil ⇒ skip / "" ⇒ NULL / non-empty ⇒
	// write). *bool tri-state (nil ⇒ skip / non-nil ⇒ write). NotesDoc
	// mirrors DescriptionDoc.
	if in.DefectSeverity != nil {
		if *in.DefectSeverity == "" {
			sets = append(sets, "artefacts_defect_severity = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_severity = $%d", n))
			args = append(args, *in.DefectSeverity)
			n++
		}
	}
	if in.DefectStatus != nil {
		if *in.DefectStatus == "" {
			sets = append(sets, "artefacts_defect_status = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_status = $%d", n))
			args = append(args, *in.DefectStatus)
			n++
		}
	}
	if in.Environment != nil {
		if *in.Environment == "" {
			sets = append(sets, "artefacts_environment = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_environment = $%d", n))
			args = append(args, *in.Environment)
			n++
		}
	}
	if in.EstimateHours != nil {
		if *in.EstimateHours == "" {
			sets = append(sets, "artefacts_estimate_hours = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_estimate_hours = $%d::numeric", n))
			args = append(args, *in.EstimateHours)
			n++
		}
	}
	if in.EstimateRemaining != nil {
		if *in.EstimateRemaining == "" {
			sets = append(sets, "artefacts_estimate_remaining = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_estimate_remaining = $%d::numeric", n))
			args = append(args, *in.EstimateRemaining)
			n++
		}
	}
	if in.EstimateInitial != nil {
		if *in.EstimateInitial == "" {
			sets = append(sets, "artefacts_estimate_initial = NULL")
		} else {
			// Post mig-155: column type is TEXT (bucket name). Vocab
			// is validated by validEstimateInitialBuckets above; the
			// numeric value-per-bucket lives in EstimateInitialValue.
			sets = append(sets, fmt.Sprintf("artefacts_estimate_initial = $%d", n))
			args = append(args, *in.EstimateInitial)
			n++
		}
	}
	if in.EstimateUpdated != nil {
		if *in.EstimateUpdated == "" {
			sets = append(sets, "artefacts_estimate_updated = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_estimate_updated = $%d::numeric", n))
			args = append(args, *in.EstimateUpdated)
			n++
		}
	}
	if in.IsExpedite != nil {
		sets = append(sets, fmt.Sprintf("artefacts_is_expedite = $%d", n))
		args = append(args, *in.IsExpedite)
		n++
	}
	if in.IsReady != nil {
		sets = append(sets, fmt.Sprintf("artefacts_is_ready = $%d", n))
		args = append(args, *in.IsReady)
		n++
	}
	if in.AffectsDoc != nil {
		sets = append(sets, fmt.Sprintf("artefacts_affects_doc = $%d", n))
		args = append(args, *in.AffectsDoc)
		n++
	}
	if in.CountChildTestCases != nil {
		// NOT NULL DEFAULT 0 in the DB; nil ⇒ skip, non-nil ⇒ write the
		// integer verbatim. No "clear-to-NULL" path.
		sets = append(sets, fmt.Sprintf("artefacts_count_child_test_cases = $%d", n))
		args = append(args, *in.CountChildTestCases)
		n++
	}
	if in.Notes != nil {
		if *in.Notes == "" {
			sets = append(sets, "artefacts_notes = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_notes = $%d", n))
			args = append(args, *in.Notes)
			n++
		}
	}
	if in.NotesDoc != nil {
		raw := string(*in.NotesDoc)
		if raw == "" || raw == "null" || raw == "{}" {
			sets = append(sets, "artefacts_notes_doc = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_notes_doc = $%d::jsonb", n))
			args = append(args, *in.NotesDoc)
			n++
		}
	}
	if in.PlannedStartDate != nil {
		if *in.PlannedStartDate == "" {
			sets = append(sets, "artefacts_planned_start_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_planned_start_date = $%d::date", n))
			args = append(args, *in.PlannedStartDate)
			n++
		}
	}
	if in.PlannedFinishDate != nil {
		if *in.PlannedFinishDate == "" {
			sets = append(sets, "artefacts_planned_finish_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_planned_finish_date = $%d::date", n))
			args = append(args, *in.PlannedFinishDate)
			n++
		}
	}
	if in.ActualStartDate != nil {
		if *in.ActualStartDate == "" {
			sets = append(sets, "artefacts_actual_start_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_actual_start_date = $%d::date", n))
			args = append(args, *in.ActualStartDate)
			n++
		}
	}
	if in.StrategicInvestmentGroup != nil {
		if *in.StrategicInvestmentGroup == "" {
			sets = append(sets, "artefacts_strategic_investment_group = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_strategic_investment_group = $%d", n))
			args = append(args, *in.StrategicInvestmentGroup)
			n++
		}
	}

	// ── Rally-screenshots batch (migs 150-155) ──
	// Universal-scope, defect-only, risk-only, strategy-only, +
	// submitted-by FK. Three-state on *string and *[]string; bool
	// pointers write verbatim; int pointers write verbatim (no
	// clear-to-NULL). artefacts_risk_calculated is GENERATED — never
	// written here. The mig-158 trigger gates the slot/scope after
	// the write reaches the DB; handler-side validation above
	// returns 400 BEFORE the round-trip on bad enum values.

	// Universal (mig 150).
	if in.Actuals != nil {
		if *in.Actuals == "" {
			sets = append(sets, "artefacts_actuals = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_actuals = $%d::numeric", n))
			args = append(args, *in.Actuals)
			n++
		}
	}
	if in.Tags != nil {
		// Replace the whole TEXT[]. Empty slice ⇒ empty array (not
		// NULL); callers wanting NULL would need a separate sentinel
		// (none today — Rally Tags is intentionally empty-vs-set).
		sets = append(sets, fmt.Sprintf("artefacts_tags = $%d", n))
		args = append(args, *in.Tags)
		n++
	}
	if in.ActualEndDate != nil {
		if *in.ActualEndDate == "" {
			sets = append(sets, "artefacts_actual_end_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_actual_end_date = $%d::date", n))
			args = append(args, *in.ActualEndDate)
			n++
		}
	}

	// Defect (mig 151).
	if in.DefectResolution != nil {
		if *in.DefectResolution == "" {
			sets = append(sets, "artefacts_defect_resolution = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_resolution = $%d", n))
			args = append(args, *in.DefectResolution)
			n++
		}
	}
	if in.DefectTestCaseStatus != nil {
		if *in.DefectTestCaseStatus == "" {
			sets = append(sets, "artefacts_defect_test_case_status = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_test_case_status = $%d", n))
			args = append(args, *in.DefectTestCaseStatus)
			n++
		}
	}
	if in.DefectFixedInBuild != nil {
		if *in.DefectFixedInBuild == "" {
			sets = append(sets, "artefacts_defect_fixed_in_build = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_fixed_in_build = $%d", n))
			args = append(args, *in.DefectFixedInBuild)
			n++
		}
	}
	if in.DefectFoundInBuild != nil {
		if *in.DefectFoundInBuild == "" {
			sets = append(sets, "artefacts_defect_found_in_build = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_found_in_build = $%d", n))
			args = append(args, *in.DefectFoundInBuild)
			n++
		}
	}
	if in.DefectIsReleaseNote != nil {
		sets = append(sets, fmt.Sprintf("artefacts_defect_is_release_note = $%d", n))
		args = append(args, *in.DefectIsReleaseNote)
		n++
	}
	if in.DefectStepsToReproduce != nil {
		if *in.DefectStepsToReproduce == "" {
			sets = append(sets, "artefacts_defect_steps_to_reproduce = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_steps_to_reproduce = $%d", n))
			args = append(args, *in.DefectStepsToReproduce)
			n++
		}
	}
	if in.DefectStepsToReproduceDoc != nil {
		raw := string(*in.DefectStepsToReproduceDoc)
		if raw == "" || raw == "null" || raw == "{}" {
			sets = append(sets, "artefacts_defect_steps_to_reproduce_doc = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_steps_to_reproduce_doc = $%d::jsonb", n))
			args = append(args, *in.DefectStepsToReproduceDoc)
			n++
		}
	}
	if in.DefectIsRegression != nil {
		sets = append(sets, fmt.Sprintf("artefacts_defect_is_regression = $%d", n))
		args = append(args, *in.DefectIsRegression)
		n++
	}

	// Risk (mig 152). risk_calculated is GENERATED — not written here.
	if in.RiskResolution != nil {
		if *in.RiskResolution == "" {
			sets = append(sets, "artefacts_risk_resolution = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_risk_resolution = $%d", n))
			args = append(args, *in.RiskResolution)
			n++
		}
	}
	if in.RiskImpact != nil {
		if *in.RiskImpact == "" {
			sets = append(sets, "artefacts_risk_impact = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_risk_impact = $%d", n))
			args = append(args, *in.RiskImpact)
			n++
		}
	}
	if in.RiskImpactScore != nil {
		sets = append(sets, fmt.Sprintf("artefacts_risk_impact_score = $%d", n))
		args = append(args, *in.RiskImpactScore)
		n++
	}
	if in.RiskProbability != nil {
		if *in.RiskProbability == "" {
			sets = append(sets, "artefacts_risk_probability = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_risk_probability = $%d", n))
			args = append(args, *in.RiskProbability)
			n++
		}
	}
	if in.RiskProbabilityScore != nil {
		sets = append(sets, fmt.Sprintf("artefacts_risk_probability_score = $%d", n))
		args = append(args, *in.RiskProbabilityScore)
		n++
	}
	if in.RiskResponse != nil {
		if *in.RiskResponse == "" {
			sets = append(sets, "artefacts_risk_response = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_risk_response = $%d", n))
			args = append(args, *in.RiskResponse)
			n++
		}
	}
	if in.RiskExposure != nil {
		if *in.RiskExposure == "" {
			sets = append(sets, "artefacts_risk_exposure = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_risk_exposure = $%d::numeric", n))
			args = append(args, *in.RiskExposure)
			n++
		}
	}

	// Submitted-by (mig 153). Already-validated uuid string above.
	if in.SubmittedByUserID != nil {
		if *in.SubmittedByUserID == "" {
			sets = append(sets, "artefacts_id_user_submitted_by = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_id_user_submitted_by = $%d::uuid", n))
			args = append(args, *in.SubmittedByUserID)
			n++
		}
	}

	// Strategy (mig 154).
	if in.StrategicJobSize != nil {
		sets = append(sets, fmt.Sprintf("artefacts_strategic_job_size = $%d", n))
		args = append(args, *in.StrategicJobSize)
		n++
	}
	if in.StrategicPreliminaryEstimateValue != nil {
		sets = append(sets, fmt.Sprintf("artefacts_strategic_preliminary_estimate_value = $%d", n))
		args = append(args, *in.StrategicPreliminaryEstimateValue)
		n++
	}

	// Estimate-initial sidecar (mig 155).
	if in.EstimateInitialValue != nil {
		sets = append(sets, fmt.Sprintf("artefacts_estimate_initial_value = $%d", n))
		args = append(args, *in.EstimateInitialValue)
		n++
	}

	// ── Fourth-wave demotion batch (mig 162) ──
	// Three-state on every *string (nil ⇒ skip / "" ⇒ clear-to-NULL /
	// non-empty ⇒ UPDATE). No CHECK-vocab validation handler-side —
	// defect_browser / work_accepted_date / strategic_value_stream_identifier
	// are free-text/date; strategic_investment_weight vocab is undefined
	// (see TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB). The mig-162 trigger
	// enforces slot/scope gating server-side.
	if in.DefectBrowser != nil {
		if *in.DefectBrowser == "" {
			sets = append(sets, "artefacts_defect_browser = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_defect_browser = $%d", n))
			args = append(args, *in.DefectBrowser)
			n++
		}
	}
	if in.WorkAcceptedDate != nil {
		if *in.WorkAcceptedDate == "" {
			sets = append(sets, "artefacts_work_accepted_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_work_accepted_date = $%d::date", n))
			args = append(args, *in.WorkAcceptedDate)
			n++
		}
	}
	if in.StrategicValueStreamIdentifier != nil {
		if *in.StrategicValueStreamIdentifier == "" {
			sets = append(sets, "artefacts_strategic_value_stream_identifier = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_strategic_value_stream_identifier = $%d", n))
			args = append(args, *in.StrategicValueStreamIdentifier)
			n++
		}
	}
	if in.StrategicInvestmentWeight != nil {
		if *in.StrategicInvestmentWeight == "" {
			sets = append(sets, "artefacts_strategic_investment_weight = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("artefacts_strategic_investment_weight = $%d", n))
			args = append(args, *in.StrategicInvestmentWeight)
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
	// Post-write read context. When the patch rebinds topology, the row's
	// NEW topology_node may fall outside the request's entry-time
	// AllowedSubtreeIDs (because the clamp was computed from the URL ?meg=
	// BEFORE this UPDATE ran). Bypass the subtree gate on this single read
	// so we can return the row the actor was just authorised to write.
	// The bypass is safe here because:
	//   (a) the actor was either authorised by topology.CanReadScope above
	//       when writing a non-NULL node, or
	//   (b) the actor cleared the field to NULL, which doesn't require a
	//       read-scope grant on any node.
	// All other clamp fields (WorkspaceID, RoleID, …) stay intact.
	readCtx := ctx
	if topologyRebound {
		readCtx = sentinel.WithBypassedSubtreeClamp(ctx)
	}
	item, err := s.GetWorkItem(readCtx, subscriptionID, id)
	if err != nil {
		return nil, err
	}
	eventType := "item.updated"
	if in.FlowStateID != nil {
		eventType = "item.status_changed"
	}
	s.notifier.Fire(subscriptionID, eventType, item)

	// Cascade — fire AFTER the GetWorkItem read so the caller sees the
	// post-patch state, but BEFORE we return so any state changes the
	// cascade triggers are durable by the time the response goes out.
	// Errors are logged-and-swallowed (a recalc failure must NOT undo
	// the user's patch — the next mutation will retrigger).
	//
	// Two cases:
	//   - flow_state_id was patched      → recalc THIS row's parent
	//   - parent_artefact_id was patched → recalc OLD parent + NEW parent
	//
	// Slice 4.6c — touched_ids surfaced via a per-call sidecar slice the
	// callers attached to the context. The cascade appends every row id
	// it actually wrote to. Pure additive — when no sidecar is present
	// (e.g. ArchiveWorkItem still uses the unbothered recalcParentFlowState),
	// behaviour is identical to before.
	touched := touchedIDsFromCtx(ctx)
	if in.FlowStateID != nil {
		if pid, perr := s.loadParentID(ctx, id); perr == nil && pid != nil {
			if touched != nil {
				_ = s.recalcParentFlowStateCollecting(ctx, subscriptionID, *pid, touched)
			} else {
				_ = s.recalcParentFlowState(ctx, subscriptionID, *pid)
			}
		}
	}
	if in.ParentArtefactID != nil {
		if oldParentID != nil {
			if touched != nil {
				_ = s.recalcParentFlowStateCollecting(ctx, subscriptionID, *oldParentID, touched)
			} else {
				_ = s.recalcParentFlowState(ctx, subscriptionID, *oldParentID)
			}
		}
		if newPid, perr := s.loadParentID(ctx, id); perr == nil && newPid != nil {
			if touched != nil {
				_ = s.recalcParentFlowStateCollecting(ctx, subscriptionID, *newPid, touched)
			} else {
				_ = s.recalcParentFlowState(ctx, subscriptionID, *newPid)
			}
		}
	}

	// Notification-rules hook — fires once after the write commits.
	// Best-effort: nil hook skips, all errors are absorbed. AuthorUserID
	// comes from the handler (auth-context read happens at the transport
	// boundary, not in the domain service).
	if s.ruleHook != nil {
		s.fireRuleHook(ctx, beforeSnapshot, item, in.AuthorUserID)
	}
	return item, nil
}

// ── Slice 4.6c — touched-ids context channel ──────────────────────────────
//
// The handler that wants touched_ids back from PatchWorkItem attaches
// a slice via WithTouchedIDsSink(ctx) and reads from it after the call
// returns. The slice escapes through context because PatchWorkItem's
// signature stays untouched — keeps every existing caller (tests,
// admin tooling) unaware of the new sidecar. Callers that DON'T set
// the sink see identical behaviour: the cascade uses the non-collect
// recalc, no allocation, no extra path.

type touchedIDsKey struct{}

// WithTouchedIDsSink attaches a *[]uuid.UUID sink to ctx. After
// PatchWorkItem returns, *sink contains every ancestor row id the
// cascade wrote (parent-first, deepest-last). Pass nil to disable.
func WithTouchedIDsSink(ctx context.Context, sink *[]uuid.UUID) context.Context {
	if sink == nil {
		return ctx
	}
	return context.WithValue(ctx, touchedIDsKey{}, sink)
}

func touchedIDsFromCtx(ctx context.Context) *[]uuid.UUID {
	v, _ := ctx.Value(touchedIDsKey{}).(*[]uuid.UUID)
	return v
}

// ArchiveWorkItem sets archived_at on an artefact row (soft delete).
//
// Cascade integration: the row's parent (if any) is loaded BEFORE the
// archive so we can recalc it AFTER. Archive sets archived_at — the row
// still exists but the live-children query filters it out, so the
// parent's derived state may need to update (e.g. archiving the last
// in_progress task may flip the Story back to backlog).
func (s *Service) ArchiveWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrNotFound
	}
	// Snapshot the parent BEFORE we archive — same artefact row stays
	// in the table, but the recalc query filters on archived_at IS NULL,
	// so reading it post-archive is fine. We do it pre-archive so a
	// future change to "hard delete" still works without rewiring.
	parentID, _ := s.loadParentID(ctx, id)

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

	// Cascade — the archived row no longer counts as a child for the
	// parent's bucket, so the parent's derived state may move.
	if parentID != nil {
		_ = s.recalcParentFlowState(ctx, subscriptionID, *parentID)
	}
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
			// PLA-0055 / story 00595+00597 — bulk set takes a priority_id
			// UUID. The legacy "priority" slug payload key is removed in
			// the same commit window as the chip cutover.
			val, _ := payload["priority_id"].(string)
			pid, perr := uuid.Parse(val)
			if perr != nil {
				result.Failed = append(result.Failed, BulkFailure{ID: row.id, Reason: "invalid priority_id"})
				continue
			}
			_, execErr = tx.Exec(ctx, sqlBulkSetPriority,
				pid, row.id, subscriptionID)
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

// ListFieldsForType returns the per-type form schema: every field
// bound to the artefact type via artefacts_types_fields, joined with
// the field_library row, ordered by display position. Used by the
// create + edit + duplicate forms to know which inputs to render per
// type (e.g. Risk → risk_score / risk_impact / risk_probability + 9
// optional). Subscription isolation is enforced through the
// artefact_types.subscription_id JOIN — an enumerating UUID from
// another tenant returns an empty list, not a leak.
func (s *Service) ListFieldsForType(ctx context.Context, subscriptionID uuid.UUID, typeID uuid.UUID) ([]FieldBinding, error) {
	if s.vectorArtefactsPool == nil {
		return []FieldBinding{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlListFieldsForType,
		typeID, subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FieldBinding
	for rows.Next() {
		var fb FieldBinding
		if err := rows.Scan(&fb.FieldLibraryID, &fb.FieldName, &fb.Label,
			&fb.FieldType, &fb.OptionsJSON, &fb.Position, &fb.Required,
			&fb.DefaultValue); err != nil {
			return nil, err
		}
		out = append(out, fb)
	}
	if out == nil {
		out = []FieldBinding{}
	}
	return out, rows.Err()
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

// UpsertFieldValue writes one field value for an artefact. Thin
// wrapper around UpsertFieldValues for callers that have a single
// value to write. See UpsertFieldValues for the contract.
func (s *Service) UpsertFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, in UpsertFieldValueInput) error {
	return s.UpsertFieldValues(ctx, subscriptionID, artefactID, []UpsertFieldValueInput{in})
}

// UpsertFieldValues writes N field values for one artefact in a
// single transaction and fires ONE rule event covering every change.
// Type routing + subscription isolation are enforced per row; one bad
// row rolls the whole batch back (matches the user's mental model
// when they click Save on a multi-field form).
//
// Rule-engine integration: when a rule hook is wired, snapshots each
// field's pre-write value (nil for first writes), executes all
// upserts inside the transaction, then fires a single
// ArtefactChangedEvent keyed by the field library's stable wire name
// (matches what the rules schema endpoint surfaces, so conditions
// stored against `severity` land on `ev.Fields["severity"]`).
//
// AuthorUserID: takes the first non-nil AuthorUserID from the batch.
// Callers should set it consistently across the slice — it's a
// per-request property, not per-field.
//
// Best-effort hook fan-out — hook failures never block the write.
func (s *Service) UpsertFieldValues(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, ins []UpsertFieldValueInput) error {
	if s.vectorArtefactsPool == nil {
		return fmt.Errorf("vector_artefacts pool not configured")
	}
	if len(ins) == 0 {
		return nil
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}

	// Resolve field-library metadata up front. Doing this before the tx
	// keeps the rollback cost low when callers send a bad field_library_id.
	type resolved struct {
		fieldID   uuid.UUID
		fieldName string
		fieldType string
		input     UpsertFieldValueInput
	}
	resolveds := make([]resolved, 0, len(ins))
	var authorUserID uuid.UUID
	for _, in := range ins {
		fieldID, err := uuid.Parse(in.FieldLibraryID)
		if err != nil {
			return fmt.Errorf("%w: invalid field_library_id", ErrInvalidInput)
		}
		var name, ftype string
		err = s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFieldLibraryNameAndType,
			fieldID, subscriptionID,
		).Scan(&name, &ftype)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: field_library_id not found", ErrInvalidInput)
		}
		if err != nil {
			return err
		}
		resolveds = append(resolveds, resolved{fieldID, name, ftype, in})
		if authorUserID == uuid.Nil && in.AuthorUserID != uuid.Nil {
			authorUserID = in.AuthorUserID
		}
	}

	// Snapshot before-values for the hook BEFORE the transaction so the
	// diff captures the pre-write state. Skipped when no hook is wired
	// (zero cost on the unwired path).
	var beforeValues map[uuid.UUID]any
	if s.ruleHook != nil {
		beforeValues = make(map[uuid.UUID]any, len(resolveds))
		for _, r := range resolveds {
			beforeValues[r.fieldID] = s.loadFieldValue(ctx, artefactID, r.fieldID, r.fieldType)
		}
	}

	tx, err := s.vectorArtefactsPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, r := range resolveds {
		if _, err := tx.Exec(ctx, sqlUpsertFieldValue,
			artefactID, r.fieldID,
			r.input.StringValue, r.input.NumberValue, r.input.TextValue, r.input.DateValue,
		); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	if s.ruleHook != nil {
		diff := make(map[string]rules.FieldChange, len(resolveds))
		for _, r := range resolveds {
			after := pickFieldValue(r.fieldType,
				r.input.StringValue, r.input.NumberValue, r.input.TextValue, r.input.DateValue)
			diff[r.fieldName] = rules.FieldChange{
				Before: beforeValues[r.fieldID],
				After:  after,
			}
		}
		s.fireRuleHookForFields(ctx, artefactID, authorUserID, diff)
	}
	return nil
}

// DeleteFieldValue removes a field value row by id, enforcing ownership.
//
// Rule-engine integration: snapshots the deleted row's field name +
// type + value BEFORE the DELETE (the row vanishes afterward), then
// fires a single event with After=nil so `changed` and `changed_from`
// operators fire as expected.
func (s *Service) DeleteFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, fvID uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrFieldNotFound
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}

	// Snapshot the row's field metadata + value BEFORE the delete so
	// the rule event has somewhere to source the diff. Skipped when no
	// hook is wired. A missing row returns pgx.ErrNoRows which we let
	// fall through to the delete's "0 rows affected" branch below.
	var snapName, snapType string
	var snapValue any
	if s.ruleHook != nil {
		var sv, nv, tv, dv *string
		if err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFieldValueByValueRowID,
			fvID, artefactID,
		).Scan(&snapName, &snapType, &sv, &nv, &tv, &dv); err == nil {
			snapValue = pickFieldValue(snapType, sv, nv, tv, dv)
		}
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

	if s.ruleHook != nil && snapName != "" {
		s.fireRuleHookForFields(ctx, artefactID, uuid.Nil, map[string]rules.FieldChange{
			snapName: {Before: snapValue, After: nil},
		})
	}
	return nil
}

// fireRuleHookForFields publishes a custom-field-write event. Differs
// from fireRuleHook in that it accepts a pre-built diff map (the caller
// has type-aware knowledge that we don't want to duplicate here) and
// looks up the workspace + artefact-type-name envelope the same way.
// Best-effort: any lookup failure silently skips. The hook nil-guard
// is the caller's responsibility (cheap branch on the hot path).
//
// Skips fire when the diff is empty OR when every entry has Before==After
// (no-op writes shouldn't produce notifications — matches the contract
// PatchWorkItem already honours).
func (s *Service) fireRuleHookForFields(ctx context.Context, artefactID, authorUserID uuid.UUID, fields map[string]rules.FieldChange) {
	if len(fields) == 0 {
		return
	}
	changed := false
	for _, c := range fields {
		if !fieldChangeIsNoop(c) {
			changed = true
			break
		}
	}
	if !changed {
		return
	}
	var workspaceID uuid.UUID
	var typeName string
	var subID uuid.UUID
	if err := s.vectorArtefactsPool.QueryRow(ctx, sqlArtefactWorkspaceAndTypeName, artefactID).
		Scan(&workspaceID, &typeName); err != nil {
		return
	}
	// Recover subscription_id from the artefact row itself — the
	// custom-field path doesn't carry a *WorkItem snapshot so we can't
	// pull it from there. One extra query is acceptable on the cold
	// custom-field write path.
	if err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectArtefactSubscriptionID, artefactID).
		Scan(&subID); err != nil {
		return
	}
	s.ruleHook.OnArtefactChanged(ctx, rules.ArtefactChangedEvent{
		SubscriptionID: subID,
		WorkspaceID:    workspaceID,
		ArtefactID:     artefactID,
		ArtefactType:   typeName,
		AuthorUserID:   authorUserID,
		Fields:         fields,
	})
}

// loadFieldValue reads the current value of a (artefact, field_library)
// pair, returning the typed value (string / float64 / time-as-string /
// nil for never-written). Best-effort: any error returns nil.
func (s *Service) loadFieldValue(ctx context.Context, artefactID, fieldID uuid.UUID, fieldType string) any {
	var sv, nv, tv, dv *string
	if err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFieldValueByArtefactAndField,
		artefactID, fieldID,
	).Scan(&sv, &nv, &tv, &dv); err != nil {
		return nil
	}
	return pickFieldValue(fieldType, sv, nv, tv, dv)
}

// pickFieldValue selects the live value column for a field-type and
// coerces it for the evaluator. Numeric fields parse to float64 so
// `>` / `<` / `>=` / `<=` against rule values work without further
// coercion in the matcher. Date values stay as strings (the matcher
// falls through to fmt.Sprint for them today). Returns nil when the
// matching column is unset — equivalent to "field never written".
func pickFieldValue(fieldType string, sv, nv, tv, dv *string) any {
	switch fieldType {
	case "integer", "decimal":
		if nv != nil && *nv != "" {
			var f float64
			if _, err := fmt.Sscanf(*nv, "%g", &f); err == nil {
				return f
			}
		}
		return nil
	case "date":
		if dv != nil && *dv != "" {
			return *dv
		}
		return nil
	case "textbox":
		// Convention (matches WorkItemDetailPanel + sqlListFieldValuesForArtefact):
		// short strings live in string_value. Only richtext uses text_value.
		if sv != nil {
			return *sv
		}
		return nil
	case "richtext":
		if tv != nil {
			return *tv
		}
		return nil
	case "boolean":
		// Booleans are stored as the literal strings "true"/"false" in
		// string_value (consistent with the existing UpsertFieldValue
		// wire shape). Coerce so the matcher's bool branch fires.
		if sv != nil {
			switch *sv {
			case "true":
				return true
			case "false":
				return false
			}
		}
		return nil
	case "multiselect":
		// Stored as a JSON-encoded array in string_value (e.g.
		// `["urgent","ux"]`). Parse to []any so the evaluator's
		// containsValue branch fires for `labels contains urgent`.
		// Malformed JSON falls back to the raw string — the matcher
		// can still do a substring contains, which is the safe choice
		// (better than silently dropping the value).
		if sv == nil || *sv == "" {
			return nil
		}
		var arr []any
		if err := json.Unmarshal([]byte(*sv), &arr); err == nil {
			return arr
		}
		return *sv
	default:
		// select / user / url / radio — string_value carries the
		// wire form (UUID or slug).
		if sv != nil {
			return *sv
		}
		return nil
	}
}

// fieldChangeIsNoop reports whether a FieldChange represents an
// actual change. sameValue() lives in the rules package and isn't
// exported, so we duplicate the minimal nil-aware equality check
// here. Keeps the no-op suppression in the producer (where it
// belongs — the evaluator's job is to match, not to filter noise).
func fieldChangeIsNoop(c rules.FieldChange) bool {
	if c.Before == nil && c.After == nil {
		return true
	}
	if c.Before == nil || c.After == nil {
		return false
	}
	if bf, ok := c.Before.(float64); ok {
		if af, ok := c.After.(float64); ok {
			return bf == af
		}
	}
	if bb, ok := c.Before.(bool); ok {
		if ab, ok := c.After.(bool); ok {
			return bb == ab
		}
	}
	return fmt.Sprint(c.Before) == fmt.Sprint(c.After)
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
		return "a.artefacts_position ASC, a.artefacts_number ASC"
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
		return fmt.Sprintf(`at.artefacts_types_sort_order ASC NULLS LAST, a.artefacts_number %s`, d)
	case "title":
		return fmt.Sprintf("a.artefacts_title %s, a.artefacts_number ASC", d)
	case "status":
		return fmt.Sprintf("fs.flows_states_sort_order %s NULLS LAST, a.artefacts_number ASC", d)
	case "priority":
		// PLA-0055 / story 00595+00597 — sort by the priority row's
		// catalogue sort_order. Same TD-WORKITEMS-GENERIC pay-down as
		// item_type: hardcoded CASE WHEN replaced with the joined
		// sort_order so tenant-added custom priorities slot into the
		// ordering without any Go change.
		return fmt.Sprintf(`pri.artefact_priorities_sort_order %s NULLS LAST, a.artefacts_number ASC`, d)
	case "points":
		return fmt.Sprintf("COALESCE(rp.rollup_points, a.artefacts_story_points) %s NULLS LAST, a.artefacts_number ASC", d)
	case "sprint_id":
		return fmt.Sprintf("a.artefacts_id_timebox_sprint %s NULLS LAST, a.artefacts_number ASC", d)
	case "due_date":
		return fmt.Sprintf("a.artefacts_due_date %s NULLS LAST, a.artefacts_number ASC", d)
	default:
		return "a.artefacts_position ASC, a.artefacts_number ASC"
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
	// Parent ref columns — NULL for unparented roots and for rows whose
	// parent has been archived (LEFT JOIN ap drops on ap.archived_at IS NULL).
	var parentRefID, parentRefTypePrefix, parentRefTitle *string
	var parentRefKeyNum *int64
	// Owner ref columns — NULL in this story (decorated in 00468).
	var ownerRefID, ownerDisplayName, ownerAvatarURL *string
	// Priority ref columns — PLA-0055 / story 00595+00597. priority_id
	// is NOT NULL post-migration so wi.PriorityID is always set; the
	// joined name/slot/sort_order populate PriorityRef. Nil pri_*
	// pointers only appear if a future code path orphans a row,
	// which shouldn't happen (FK + slotted-row archive protection).
	var priName, priSlot *string
	var priSortOrder *int

	err := row.Scan(
		&wi.ID,
		&wi.SubscriptionID,
		&wi.KeyNum,
		&wi.ItemType,
		&wi.TypePrefix,
		&wi.ArtefactTypeID,
		&wi.Title,
		&wi.Description,
		&wi.Status,
		&wi.FlowStateID,
		&wi.FlowStateName,
		&wi.FlowStateCode,
		&wi.PriorityID,
		&priName,
		&priSlot,
		&priSortOrder,
		&wi.StoryPoints,
		&wi.SprintID,
		&sprintRefID,
		&sprintRefAlias,
		&wi.ParentID,
		&parentRefID,
		&parentRefTypePrefix,
		&parentRefKeyNum,
		&parentRefTitle,
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
		&wi.TopologyNodeID,
		&wi.Colour,
		&wi.IsBlocked,
		&wi.BlockedReason,
		&wi.ReleaseID,
		&wi.MilestoneID,
		&wi.DescriptionDoc,
		// Core-field demotion (mig 147) — order MUST match the trailing
		// projection in sqlWorkItemColumns / sqlWorkItemColumnsListTemplate.
		&wi.DefectSeverity,
		&wi.DefectStatus,
		&wi.Environment,
		&wi.EstimateHours,
		&wi.EstimateRemaining,
		&wi.EstimateInitial,
		&wi.EstimateUpdated,
		&wi.IsExpedite,
		&wi.IsReady,
		&wi.AffectsDoc,
		&wi.CountChildTestCases,
		&wi.Notes,
		&wi.NotesDoc,
		&wi.PlannedStartDate,
		&wi.PlannedFinishDate,
		&wi.ActualStartDate,
		&wi.FlowStateChangedAt,
		&wi.StrategicInvestmentGroup,
		// Rally-screenshots batch (migs 150-155). Order MUST match the
		// trailing projection in sqlWorkItemColumns /
		// sqlWorkItemColumnsListTemplate.
		&wi.Actuals,
		&wi.Tags,
		&wi.ActualEndDate,
		&wi.DefectResolution,
		&wi.DefectTestCaseStatus,
		&wi.DefectFixedInBuild,
		&wi.DefectFoundInBuild,
		&wi.DefectIsReleaseNote,
		&wi.DefectStepsToReproduce,
		&wi.DefectStepsToReproduceDoc,
		&wi.DefectIsRegression,
		&wi.RiskResolution,
		&wi.RiskImpact,
		&wi.RiskImpactScore,
		&wi.RiskProbability,
		&wi.RiskProbabilityScore,
		&wi.RiskResponse,
		&wi.RiskExposure,
		&wi.RiskCalculated,
		&wi.SubmittedByUserID,
		&wi.StrategicJobSize,
		&wi.StrategicPreliminaryEstimateValue,
		&wi.EstimateInitialValue,
		// Fourth-wave demotion batch (mig 162). Order MUST match the
		// trailing projection in sqlWorkItemColumns /
		// sqlWorkItemColumnsListTemplate.
		&wi.DefectBrowser,
		&wi.WorkAcceptedDate,
		&wi.StrategicValueStreamIdentifier,
		&wi.StrategicInvestmentWeight,
	)
	if err != nil {
		return nil, err
	}

	if sprintRefID != nil && sprintRefAlias != nil {
		wi.Sprint = &SprintRef{ID: *sprintRefID, Alias: *sprintRefAlias}
	}
	if parentRefID != nil {
		ref := ParentRef{ID: *parentRefID}
		if parentRefTypePrefix != nil {
			ref.TypePrefix = *parentRefTypePrefix
		}
		if parentRefKeyNum != nil {
			ref.KeyNum = *parentRefKeyNum
		}
		if parentRefTitle != nil {
			ref.Title = *parentRefTitle
		}
		wi.Parent = &ref
	}
	if ownerRefID != nil {
		dn := ""
		if ownerDisplayName != nil {
			dn = *ownerDisplayName
		}
		wi.Owner = &OwnerRef{ID: *ownerRefID, DisplayName: dn, AvatarURL: ownerAvatarURL}
	}
	if wi.PriorityID != "" && priName != nil {
		order := 0
		if priSortOrder != nil {
			order = *priSortOrder
		}
		wi.Priority = &PriorityRef{
			ID:    wi.PriorityID,
			Name:  *priName,
			Slot:  priSlot,
			Order: order,
		}
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

