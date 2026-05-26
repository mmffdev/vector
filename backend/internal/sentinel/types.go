// Package sentinel — single-source-of-truth identity + tenant + scope clamp.
//
// See docs/Security/Sentinel/sentinel_docs.md for the full design.
// Per PLA062 (Replace decision, 2026-05-24), sentinel OWNS the clamp
// substrate end-to-end. The earlier topology.ClampMiddleware /
// WorkspaceClampMiddleware are deprecated and deleted at S25.
//
// Public surface:
//   - sentinel.Clamp       — the per-request immutable scope bag
//   - sentinel.Resolver    — what middleware needs from topology / users
//   - sentinel.Middleware  — the HTTP middleware (mounted in main.go)
//   - sentinel.FromCtx     — handler-side accessor (lint-ratchet enforced)
//   - sentinel.Err*        — typed sentinel-error sentinels (RFC 9457)
package sentinel

import (
	"context"

	"github.com/google/uuid"
)

// Clamp is the per-request, immutable scope bag attached by Middleware
// to every request context. Handlers MUST read it via FromCtx — never
// reach around it to topology.* or auth.UserFromCtx for tenant/focus/
// workspace resolution. The lint:sentinel-clamp-required ratchet (S20)
// enforces this on every artefact-touching handler.
//
// All fields are populated by Middleware before the inner handler runs:
//
//   - TenantID         — subscription_id from the JWT
//   - UserID           — user.id from the JWT
//   - Role             — legacy role enum (display only, do not authorise)
//   - RoleID           — UUID role id (authoritative)
//   - WorkspaceID      — JWT workspace_id claim > FirstLiveWorkspace fallback (PLA-0053)
//   - FocusNodeID      — the resolved focus node (URL > user default > workspace root > tenant root)
//   - ScopeUp          — include ancestors of FocusNodeID
//   - ScopeDown        — include descendants of FocusNodeID
//   - AllowedSubtreeIDs — the resolved subtree the request may see
//
// WorkspaceID was added by S05 (PLA062) absorbing the workspace clamp
// from topology.WorkspaceClampMiddleware. Handlers that previously
// read topology.WorkspaceIDFromCtx now read FromCtx(ctx).WorkspaceID.
type Clamp struct {
	TenantID          uuid.UUID
	UserID            uuid.UUID
	Role              string
	RoleID            uuid.UUID
	WorkspaceID       uuid.UUID
	FocusNodeID       uuid.UUID
	ScopeUp           bool
	ScopeDown         bool
	AllowedSubtreeIDs []uuid.UUID
}

// Resolver is the dependency Middleware needs to compute a Clamp.
//
// Concrete implementations:
//   - In production: a struct wrapping the vector-artefacts pool +
//     topology SQL helpers (lives in backend/internal/sentinel/resolver.go
//     after PLA062 finishes; S04 ships an in-memory test stub only).
//   - In tests: any struct satisfying this interface — see stubResolver
//     in middleware_test.go.
//
// Each method takes ctx.Context first per Go convention, then the
// inputs needed. Errors returned MUST be one of the sentinel errors
// (ErrFocusNotInTenant, ErrFocusNoAccess) for predictable middleware
// behaviour; any other error becomes a 500.
type Resolver interface {
	// ResolveSubtree returns the union of {focus} + ancestors (if up)
	// + descendants (if down), filtered by user grants. Errors:
	//   - ErrFocusNotInTenant if focus belongs to another tenant
	//   - ErrFocusNoAccess if user has no grant covering focus
	//   - any other error → 500
	ResolveSubtree(
		ctx context.Context,
		tenant, focus uuid.UUID,
		scopeUp, scopeDown bool,
	) ([]uuid.UUID, error)

	// DefaultFocus returns the user's persisted default focus node, or
	// nil if none set. Reads users.default_focus_node_id (added by S06).
	// A nil-without-error result triggers the tenant-root fallback.
	DefaultFocus(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)

	// FocusWorkspace returns the workspace that owns a live focus node
	// in the tenant. Used to reject stale cross-workspace URL/default
	// focus values before they split the JWT workspace clamp from the
	// scope clamp.
	FocusWorkspace(ctx context.Context, tenant, focus uuid.UUID) (uuid.UUID, error)

	// WorkspaceRoot returns the live root topology node for the resolved
	// workspace. This is the correct fallback when the user has no saved
	// default or their saved default went stale; tenant root is only the
	// final emergency fallback for older single-root tenants.
	WorkspaceRoot(ctx context.Context, tenant, workspaceID uuid.UUID) (uuid.UUID, error)

	// TenantRoot returns the subscription's root topology node — the
	// final fallback when neither ?focus, user default, nor workspace
	// root can be resolved.
	TenantRoot(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)

	// FirstLiveWorkspace returns the actor's first live workspace in
	// their tenant that they hold an active grant on, ordered by
	// created_at ASC. Used as fallback when the JWT carries no
	// workspace_id claim (legacy-token rollout window per PLA-0053 /
	// story 00576, plus any code path that signs a JWT without the
	// claim). The user-grant narrowing (added 2026-05-25 alongside the
	// auth.Refresh re-derivation fix) prevents the fallback from
	// returning a workspace the actor has no grant on — which then
	// 403'd at HasActiveRole one step later.
	//
	// Returns ErrNoWorkspace when the user has zero active grants in
	// the tenant.
	FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error)

	// HasActiveRole returns true if the actor holds an active role on
	// the resolved workspace. Called after workspace resolution to
	// prevent a forged JWT claim (or a token issued before role
	// revocation) from reaching a workspace the actor has no grant on.
	// Returns 403 /errors/sentinel/no-workspace-role when false.
	HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error)

	// GrantOnNode returns true when the user holds an active grant on
	// the node OR any of its ancestors within the tenant (descend-
	// inheritance). Used by the request-time middleware to gate URL
	// ?meg= focus values, and by the PutFocus handler to gate writes to
	// users.default_focus_node_id so a user cannot store a default
	// pointing at a node they have no access to. Matches the
	// PLA-0043 scope-read predicate.
	//
	// roleID — the actor's role UUID. Production resolver short-circuits
	// to (true, nil) when roleID == roles.SystemGrpGlobalID, mirroring
	// the synthetic grant fabric topology.ListMyGrants ships for the
	// platform-support role. Without this gate, gadmin's URL ?meg= would
	// 403 because they hold no real users_roles_topology_nodes rows.
	// padmin and below are NOT short-circuited — they must hold an actual
	// grant row (direct or via ancestor walk).
	GrantOnNode(ctx context.Context, tenant, userID, nodeID, roleID uuid.UUID) (bool, error)

	// SetUserDefaultFocus persists the user's home/default focus node.
	// Pass nil to clear (user falls back to workspace root on next boot).
	// Returns the underlying error verbatim — callers map it to the
	// right HTTP status (sql.ErrNoRows → 401-user-vanished, anything
	// else → 500).
	SetUserDefaultFocus(ctx context.Context, userID uuid.UUID, nodeID *uuid.UUID) error
}
