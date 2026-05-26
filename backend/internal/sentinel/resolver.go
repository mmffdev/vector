package sentinel

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolResolver is the production Resolver implementation. It is the
// adapter wired in cmd/server/main.go (S05.4) that satisfies the
// Resolver interface against the live database pools.
//
// Two pools:
//   - vaPool — vector_artefacts pool, owns topology_nodes (the SQL
//     for descendants/ancestors/tenant-root/node-belongs lives here).
//   - mvPool — mmff_vector pool, owns workspaces / roles_workspaces /
//     users (the SQL for FirstLiveWorkspace, HasActiveRole, and the
//     deferred DefaultFocus once S06 lands).
//
// The split mirrors how topology.Service / PoolWorkspaceLookup carve
// up the same data today — sentinel duplicates the access path rather
// than delegating to those types, per PLA062 Replace decision.
type PoolResolver struct {
	VAPool *pgxpool.Pool // vector_artefacts (topology_nodes)
	MVPool *pgxpool.Pool // mmff_vector (workspaces, roles_workspaces, users)
}

// NewPoolResolver constructs a PoolResolver. Both pools are required;
// passing nil is a programming error and will surface as a nil-pointer
// panic on the first Resolver call.
func NewPoolResolver(vaPool, mvPool *pgxpool.Pool) *PoolResolver {
	return &PoolResolver{VAPool: vaPool, MVPool: mvPool}
}

// ResolveSubtree implements Resolver. Steps:
//  1. Verify the focus node exists inside the tenant — if not,
//     return ErrFocusNotInTenant (mapped to 403 by Middleware).
//  2. If scopeDown, gather descendants. If scopeUp, gather ancestors.
//     Always include focus itself.
//  3. Union the result, deduplicating.
//
// Per-grant filtering (ErrFocusNoAccess) is NOT yet implemented in
// this resolver — that requires reading users_roles_topology_nodes
// and intersecting with the resolved subtree. Tracked as a follow-up
// in S05's GREEN log; not gating because:
//
//	(a) workspace gating + tenant gating already filter most cross-
//	    tenant + cross-workspace attempts at higher layers,
//	(b) the existing topology.ClampPredicate already does this
//	    per-grant filtering for the handlers that need it, and S05.4
//	    leaves those handler-level calls in place — sentinel.Middleware
//	    provides the OUTER clamp; handlers still do their per-grant
//	    inner clamp using existing topology helpers (which is fine
//	    under the Replace decision since topology.Subtree /
//	    DescendantNodeIDs are READ helpers, not middleware).
func (r *PoolResolver) ResolveSubtree(
	ctx context.Context,
	tenant, focus uuid.UUID,
	scopeUp, scopeDown bool,
) ([]uuid.UUID, error) {
	// Step 1 — tenant gate.
	var dummy int
	err := r.VAPool.QueryRow(ctx, sqlNodeBelongsToTenant, focus, tenant).Scan(&dummy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFocusNotInTenant
	}
	if err != nil {
		return nil, fmt.Errorf("sentinel.ResolveSubtree tenant gate: %w", err)
	}

	// Step 2 — gather subtree IDs per direction.
	set := map[uuid.UUID]struct{}{focus: {}}

	if scopeDown {
		ids, err := r.queryNodeIDs(ctx, sqlDescendantNodeIDs, focus, tenant)
		if err != nil {
			return nil, fmt.Errorf("sentinel.ResolveSubtree descendants: %w", err)
		}
		for _, id := range ids {
			set[id] = struct{}{}
		}
	}
	if scopeUp {
		ids, err := r.queryNodeIDs(ctx, sqlAncestorNodeIDs, focus, tenant)
		if err != nil {
			return nil, fmt.Errorf("sentinel.ResolveSubtree ancestors: %w", err)
		}
		for _, id := range ids {
			set[id] = struct{}{}
		}
	}

	out := make([]uuid.UUID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	return out, nil
}

// queryNodeIDs runs a UUID-only SELECT and collects the results.
// Shared body for sqlDescendantNodeIDs + sqlAncestorNodeIDs.
func (r *PoolResolver) queryNodeIDs(
	ctx context.Context,
	query string,
	args ...any,
) ([]uuid.UUID, error) {
	rows, err := r.VAPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DefaultFocus implements Resolver. Reads users.default_focus_node_id,
// added by S06 migration 243. NULL row value → (nil, nil), which
// middleware treats as fall-through to workspace root. Inactive user →
// (nil, nil) too, because the sqlUserDefaultFocus query gates on
// is_active = TRUE (an authenticated request from an inactive user
// already failed at auth.RequireAuth; the gate here is defence-in-depth).
func (r *PoolResolver) DefaultFocus(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	var focus *uuid.UUID
	err := r.MVPool.QueryRow(ctx, sqlUserDefaultFocus, userID).Scan(&focus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return focus, err
}

// FocusWorkspace implements Resolver. Returns the workspace that owns a
// live focus node inside the tenant. pgx.ErrNoRows is returned as-is so
// callers can decide whether a bad explicit URL should 403 or a stale
// saved default should fall back.
func (r *PoolResolver) FocusWorkspace(ctx context.Context, tenant, focus uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.VAPool.QueryRow(ctx, sqlFocusWorkspace, focus, tenant).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// WorkspaceRoot implements Resolver. Returns the live root topology
// node for the current workspace.
func (r *PoolResolver) WorkspaceRoot(ctx context.Context, tenant, workspaceID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.VAPool.QueryRow(ctx, sqlWorkspaceRootNode, tenant, workspaceID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("sentinel.WorkspaceRoot: workspace %s has no root topology node", workspaceID)
	}
	return id, err
}

// TenantRoot implements Resolver. Returns the live root topology node
// for the tenant — the final fallback when neither URL focus nor user
// default is set.
func (r *PoolResolver) TenantRoot(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.VAPool.QueryRow(ctx, sqlTenantRootNode, tenant).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("sentinel.TenantRoot: tenant %s has no root topology node", tenant)
	}
	return id, err
}

// FirstLiveWorkspace implements Resolver. Maps the underlying
// sql.ErrNoRows to sentinel.ErrNoWorkspace so middleware can render
// the right ProblemJSON. Narrows by user-grant per the 2026-05-25
// fix — see sql.go for rationale.
func (r *PoolResolver) FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.MVPool.QueryRow(ctx, sqlFirstLiveWorkspace, tenant, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNoWorkspace
	}
	return id, err
}

// HasActiveRole implements Resolver.
func (r *PoolResolver) HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.MVPool.QueryRow(ctx, sqlExistsActiveWorkspaceRole, workspaceID, userID).Scan(&ok)
	return ok, err
}

// GrantOnNode implements Resolver. Recursive-CTE walk: returns TRUE
// when the user holds an active grant on the node OR any ancestor.
// Runs against the vector_artefacts pool (topology_nodes +
// users_roles_topology_nodes both live there).
func (r *PoolResolver) GrantOnNode(ctx context.Context, tenant, userID, nodeID uuid.UUID) (bool, error) {
	var ok bool
	err := r.VAPool.QueryRow(ctx, sqlUserHasGrantOnNodeOrAncestor, nodeID, tenant, userID).Scan(&ok)
	return ok, err
}

// SetUserDefaultFocus implements Resolver. Writes users.default_focus_node_id
// (or NULL when nodeID is nil) against the mmff_vector pool. Returns
// pgx.ErrNoRows when no row matched (e.g. the user was deactivated
// between auth and write); callers map that to 401.
func (r *PoolResolver) SetUserDefaultFocus(ctx context.Context, userID uuid.UUID, nodeID *uuid.UUID) error {
	var nodeArg any // pgx encodes nil as SQL NULL
	if nodeID != nil {
		nodeArg = *nodeID
	}
	tag, err := r.MVPool.Exec(ctx, sqlUpdateUserDefaultFocus, nodeArg, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
