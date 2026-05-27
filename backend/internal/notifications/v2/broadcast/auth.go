package broadcast

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotAuthorized is returned by the Check* functions when the caller
// does not hold the required role/grant for the requested broadcast mode.
// Callers (and later S11 handlers) map this to HTTP 403.
var ErrNotAuthorized = errors.New("broadcast: not authorized")

// RoleChecker is the dependency that auth functions use to verify whether
// a user holds a specific role. Keeping this as an interface lets tests
// inject a stub without reaching for a real DB.
//
// In production this is backed by a query against users.users_role or the
// roles package — the concrete implementation wired in main.go.
type RoleChecker interface {
	// IsGlobalAdmin returns true when the user holds the gadmin role
	// (grp_global / users_role='gadmin'). gadmin has platform-wide authority.
	IsGlobalAdmin(ctx context.Context, userID uuid.UUID) (bool, error)

	// IsPlatformAdmin returns true when the user holds the padmin role
	// (users_role='padmin'). pAdmin can broadcast to nodes they own.
	IsPlatformAdmin(ctx context.Context, userID uuid.UUID) (bool, error)

	// IsSubscriptionAdmin returns true when the user holds an active
	// admin-level role within the given subscription.
	IsSubscriptionAdmin(ctx context.Context, userID, subscriptionID uuid.UUID) (bool, error)
}

// GrantChecker is the dependency that topology auth uses. sentinel.Resolver
// already exposes GrantOnNode — this interface lets tests inject a stub.
type GrantChecker interface {
	// GrantOnNode returns true when userID holds an active grant on nodeID
	// or any of its ancestors within the tenant. Mirrors the PLA-0043
	// scope-read predicate used by the sentinel middleware.
	GrantOnNode(ctx context.Context, tenantID, userID, nodeID, roleID uuid.UUID) (bool, error)
}

// CheckPlatformAuth returns nil when userID holds the gadmin role.
// Only gadmin can fire platform-scope broadcasts (all users, all tenants).
//
// HARD RULE: server-side gate, not client-side. The caller must confirm
// auth before Resolver.UsersForPlatform() is called.
func CheckPlatformAuth(ctx context.Context, userID uuid.UUID, roles RoleChecker) error {
	ok, err := roles.IsGlobalAdmin(ctx, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotAuthorized
	}
	return nil
}

// CheckTopologyAuth returns nil when the caller:
//  1. Holds pAdmin or gadmin role, AND
//  2. Has an active grant on nodeID (or any ancestor) — via sentinel.GrantOnNode.
//
// gadmin has a synthetic grant on every node (short-circuit in GrantOnNode).
// padmin must hold a real grant row.
//
// tenantID and roleID are passed through to GrantOnNode — roleID drives
// the gadmin short-circuit in the production PoolResolver.
func CheckTopologyAuth(
	ctx context.Context,
	userID, nodeID, tenantID, roleID uuid.UUID,
	roles RoleChecker,
	grants GrantChecker,
) error {
	// Must be at least pAdmin
	isGA, err := roles.IsGlobalAdmin(ctx, userID)
	if err != nil {
		return err
	}
	isPA, err := roles.IsPlatformAdmin(ctx, userID)
	if err != nil {
		return err
	}
	if !isGA && !isPA {
		return ErrNotAuthorized
	}

	// Must hold a grant on the target node (or ancestor).
	// gadmin short-circuits to true inside GrantOnNode.
	ok, err := grants.GrantOnNode(ctx, tenantID, userID, nodeID, roleID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotAuthorized
	}
	return nil
}

// CheckTenantAuth returns nil when the caller holds the subscription-admin
// role within the given subscription. Sub-admins can broadcast to all users
// in their own tenant.
func CheckTenantAuth(ctx context.Context, userID, subscriptionID uuid.UUID, roles RoleChecker) error {
	// gadmin can also do tenant broadcasts
	isGA, err := roles.IsGlobalAdmin(ctx, userID)
	if err != nil {
		return err
	}
	if isGA {
		return nil
	}

	ok, err := roles.IsSubscriptionAdmin(ctx, userID, subscriptionID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotAuthorized
	}
	return nil
}

// CheckWorkspaceAuth returns nil when the caller holds pAdmin or gadmin AND
// has an active grant on the target workspace's root node. Workspace broadcasts
// target all users in a workspace — similar authority to topology broadcasts.
//
// For simplicity the workspace check reuses the topology grant checker:
// a grant on any node in the workspace (including the workspace-root) is
// sufficient. The handler (S11) passes the workspace root nodeID.
func CheckWorkspaceAuth(
	ctx context.Context,
	userID, workspaceRootNodeID, tenantID, roleID uuid.UUID,
	roles RoleChecker,
	grants GrantChecker,
) error {
	return CheckTopologyAuth(ctx, userID, workspaceRootNodeID, tenantID, roleID, roles, grants)
}
