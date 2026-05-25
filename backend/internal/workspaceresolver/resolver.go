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
// auth.WorkspaceResolver interface. Holds both database pools
// because the derivation crosses them (topology_nodes in
// vector_artefacts, users + users_roles_workspaces in mmff_vector).
//
// Construct via NewPoolResolver; passing nil pools is a programming
// error and surfaces as a nil-pointer panic on the first call.
type PoolResolver struct {
	VAPool *pgxpool.Pool // vector_artefacts (topology_nodes)
	MVPool *pgxpool.Pool // mmff_vector (users_roles_workspaces, master_record_workspaces)
}

// NewPoolResolver constructs a PoolResolver.
func NewPoolResolver(vaPool, mvPool *pgxpool.Pool) *PoolResolver {
	return &PoolResolver{VAPool: vaPool, MVPool: mvPool}
}

// WorkspaceForFocusNode returns the workspace_id of the given live
// topology node, gated by tenant. Returns pgx.ErrNoRows when the
// node is archived, in another tenant, or has been deleted.
func (r *PoolResolver) WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.VAPool.QueryRow(ctx, sqlWorkspaceForFocusNode, focusNodeID, tenantID).Scan(&id)
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
	err := r.MVPool.QueryRow(ctx, sqlFirstGrantedWorkspace, userID, tenantID).Scan(&id)
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
	err := r.MVPool.QueryRow(ctx, sqlUserHasActiveGrantOnWorkspace, userID, workspaceID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("workspaceresolver.UserHasActiveGrantOnWorkspace: %w", err)
	}
	return ok, nil
}
