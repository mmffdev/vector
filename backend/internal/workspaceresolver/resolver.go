package workspaceresolver

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoWorkspace is returned by FirstGrantedWorkspace when the user
// holds zero active grants in the tenant. WorkspaceForFocusNode
// returns the underlying pgx.ErrNoRows so callers can distinguish
// "focus deleted / cross-tenant" from "user has no workspaces at all".
var ErrNoWorkspace = errors.New("user has no active workspace grants in this tenant")

// PoolResolver is the production implementation of the
// auth.WorkspaceResolver interface. Pre-2026-05-26 the derivation
// crossed two DBs (topology_nodes in vector_artefacts,
// users_roles_workspaces + master_record_workspaces in the now-DROPPED
// mmff_vector); the three-pillar merge folded all three tables into
// vector_artefacts, so this is a single-DB resolver. Holds one pool.
//
// Construct via NewPoolResolver; passing a nil pool is a programming
// error and surfaces as a nil-pointer panic on the first call.
type PoolResolver struct {
	Pool *pgxpool.Pool // vector_artefacts (topology_nodes, users_roles_workspaces, master_record_workspaces)
}

// NewPoolResolver constructs a PoolResolver.
func NewPoolResolver(pool *pgxpool.Pool) *PoolResolver {
	return &PoolResolver{Pool: pool}
}

// WorkspaceForFocusNode returns the workspace_id of the given live
// topology node, gated by tenant. Returns pgx.ErrNoRows when the
// node is archived, in another tenant, or has been deleted.
func (r *PoolResolver) WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.Pool.QueryRow(ctx, sqlWorkspaceForFocusNode, focusNodeID, tenantID).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// FirstGrantedWorkspace returns the earliest-created workspace in the
// tenant that the user holds an active grant on. Returns ErrNoWorkspace
// when the user has zero active grants in the tenant.
func (r *PoolResolver) FirstGrantedWorkspace(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.Pool.QueryRow(ctx, sqlFirstGrantedWorkspace, userID, tenantID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNoWorkspace
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("workspaceresolver.FirstGrantedWorkspace: %w", err)
	}
	return id, nil
}

// UserHasActiveGrantOnWorkspace returns true when the user holds an
// active (non-revoked) grant on the workspace.
func (r *PoolResolver) UserHasActiveGrantOnWorkspace(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error) {
	var ok bool
	err := r.Pool.QueryRow(ctx, sqlUserHasActiveGrantOnWorkspace, userID, workspaceID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("workspaceresolver.UserHasActiveGrantOnWorkspace: %w", err)
	}
	return ok, nil
}
