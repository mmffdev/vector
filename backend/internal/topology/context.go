package topology

// Context helpers + sentinel types for the topology clamp middleware.
//
// Split out of middleware.go on 2026-05-21 (per COD002 / W1 finding):
// middleware.go was conflating three layers in one 436-line file —
// context helpers (here), the HTTP middlewares (still in middleware.go),
// and the DB lookup adapter (workspace_lookup.go). This file is the
// pure-context surface every handler imports.

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────
// Per-node clamp (PLA-0006 grants)
// ─────────────────────────────────────────────────────────────────────

// ClampMode describes the result of computing the clamp predicate for
// the current request. Three states the consumer must distinguish
// because the SQL each one generates is different.
type ClampMode int

const (
	// ClampUnscoped means no clamp middleware ran for this request.
	// Consumers MUST treat this as "no Topology filter applied" and
	// fall back to subscription-only scoping. This is the case for
	// admin / system tools that bypass the substrate.
	ClampUnscoped ClampMode = iota

	// ClampAll means the user has a grant at or above the tenant root,
	// so they see every node in their subscription. The SQL helper
	// returns no extra predicate — subscription_id alone is enough.
	ClampAll

	// ClampSubset means the user has at least one grant on a non-root
	// node. NodeIDs is the union of every subtree they can reach. SQL
	// must add `org_node_id = ANY($N)`.
	ClampSubset

	// ClampEmpty means the user has zero active grants — they see
	// nothing. SQL must short-circuit to an empty result.
	ClampEmpty
)

// Clamp is the value the middleware writes to the request context.
// Read it with ClampFromCtx in any list endpoint that touches a table
// carrying org_node_id.
type Clamp struct {
	Mode    ClampMode
	NodeIDs []uuid.UUID
}

type clampCtxKey struct{}

// ClampFromCtx returns the clamp computed by ClampMiddleware. When the
// middleware did not run (ClampUnscoped) the caller must decide whether
// to allow the request — list endpoints inside the user surface should
// consider that an error; admin tools may proceed.
func ClampFromCtx(ctx context.Context) Clamp {
	c, ok := ctx.Value(clampCtxKey{}).(Clamp)
	if !ok {
		return Clamp{Mode: ClampUnscoped}
	}
	return c
}

// withClamp seeds the clamp into the request context. Test-only — the
// middleware is the prod path.
func withClamp(ctx context.Context, c Clamp) context.Context {
	return context.WithValue(ctx, clampCtxKey{}, c)
}

// WithClampForTest is the public test seam. Used by handler tests in
// other packages so they don't have to spin up a real orgdesign
// service to exercise their clamp branches.
func WithClampForTest(ctx context.Context, c Clamp) context.Context {
	return withClamp(ctx, c)
}

// ─────────────────────────────────────────────────────────────────────
// Workspace clamp (PLA-0006 / story 00378)
//
// Above the per-node grant clamp sits a coarser scope: every list
// endpoint that reads topology_nodes must narrow to a single workspace.
// The workspace is resolved per-request from `?ws=<slug>` (or, when
// absent, the actor's first live workspace in their tenant). Cross-
// tenant access returns 404, in-tenant access without a role on the
// target workspace returns 403 — explicitly NOT an empty list, so a
// caller can't probe slug existence by diffing 200 vs 200-empty.
//
// The middleware seeds workspaceCtxKey on the request context; the
// service-layer reads (Subtree / ListDisconnected / ArchivedDescendants
// / Tree-root resolution) splice it into their WHERE clauses through
// WorkspaceIDFromCtx. Write paths do NOT consume this — writes go
// through orgdesign.Service whose tenant scope is already enforced
// per-call by subscription_id.
// ─────────────────────────────────────────────────────────────────────

type workspaceCtxKey struct{}

// WorkspaceIDFromCtx returns the workspace_id seeded by
// WorkspaceClampMiddleware. The bool reports whether a workspace
// clamp ran for this request — list-style reads call it with the
// understanding that, when false, the route was not mounted under
// the clamp middleware (admin tools / migrations) and the read may
// fall back to the unclamped form.
func WorkspaceIDFromCtx(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(workspaceCtxKey{}).(uuid.UUID)
	return id, ok
}

// WithWorkspaceIDForTest seeds a workspace_id into context the way
// WorkspaceClampMiddleware would. Test-only — production code paths
// must go through the middleware so the role check actually runs.
func WithWorkspaceIDForTest(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, workspaceCtxKey{}, id)
}

// Workspace-clamp sentinels. The middleware translates these to
// 403/404 status codes per the AC matrix; the lookup adapter returns
// the typed errors so the lookup itself stays HTTP-agnostic.
var (
	ErrNoWorkspace       = errors.New("orgdesign: actor has no live workspace in this tenant")
	ErrWorkspaceNotFound = errors.New("orgdesign: workspace slug not found in tenant")
)
