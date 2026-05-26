package sentinel

import (
	"context"

	"github.com/google/uuid"
)

// ctxKey is a private type so external packages cannot collide on the
// same string-key. Mirrors the auth package's userCtxKey discipline.
type ctxKey string

const clampCtxKey ctxKey = "sentinel-clamp"

// withClamp attaches a Clamp to ctx. Only Middleware should call this;
// it stays unexported deliberately so the only public path to attach a
// Clamp is through the middleware.
func withClamp(ctx context.Context, c Clamp) context.Context {
	return context.WithValue(ctx, clampCtxKey, c)
}

// FromCtx returns the Clamp attached by Middleware. If the middleware
// is NOT mounted on the handler chain, this returns a zero-value Clamp
// (no panic) — but in production every artefact-touching handler must
// be downstream of sentinel.Middleware, enforced by the
// lint:sentinel-clamp-required ratchet (S20).
//
// Tests can detect "clamp not attached" via the AllowedSubtreeIDs == nil
// invariant — a real clamp always has at least the focus itself in
// AllowedSubtreeIDs (S04 ensures this).
func FromCtx(ctx context.Context) Clamp {
	c, _ := ctx.Value(clampCtxKey).(Clamp)
	return c
}

// WorkspaceIDFromCtx is a convenience facade that mirrors the prior
// topology.WorkspaceIDFromCtx(ctx) two-value return — UUID + bool
// "is clamp attached". Handlers migrated by S05.5 use this signature
// drop-in, then we can simplify call sites incrementally to read
// FromCtx(ctx).WorkspaceID directly when more fields are needed.
//
// Returns (workspaceID, true) when the Sentinel middleware mounted
// upstream attached a Clamp. Returns (uuid.Nil, false) when the route
// is not behind Middleware — handlers MUST treat false as "no
// workspace clamp" and either 403 or skip the workspace narrowing,
// per the existing pre-Sentinel contract.
func WorkspaceIDFromCtx(ctx context.Context) (uuid.UUID, bool) {
	c, ok := ctx.Value(clampCtxKey).(Clamp)
	if !ok {
		return uuid.Nil, false
	}
	return c.WorkspaceID, true
}

// TestingWithClamp attaches a Clamp to ctx for test fixtures. Production
// code MUST use Middleware — only the middleware should ever attach a
// Clamp on the request path. This helper exists so package-level unit
// tests in OTHER packages (artefactitems, etc.) can simulate the
// middleware's contract without booting a full HTTP stack.
//
// The function is exported but the name carries a "Testing" prefix so
// any non-test call site stands out in code review. A lint rule may
// later forbid TestingWithClamp outside `*_test.go` files; for now the
// naming convention is the gate.
func TestingWithClamp(ctx context.Context, c Clamp) context.Context {
	return withClamp(ctx, c)
}

// WithBypassedSubtreeClamp returns a derived context whose Clamp keeps
// every field EXCEPT AllowedSubtreeIDs, which is set to nil so the
// post-SELECT subtree gate in getWorkItemImpl no-ops. Use ONLY on the
// read that immediately follows a write the actor was already
// authorised for (e.g. PatchWorkItem's post-UPDATE GetWorkItem) — so
// the response can return the row even when the write moved it out of
// the entry-time focus subtree.
//
// Other invariants stay intact: WorkspaceID, TenantID, UserID, Role,
// RoleID, FocusNodeID, ScopeUp, ScopeDown — handlers that rely on
// these still see the right values. The bypass is narrow by construction:
// only the AllowedSubtreeIDs field is cleared, and only on the derived
// ctx. The parent ctx (and any work that branches off it) keeps the
// original clamp.
//
// SAFETY: the caller MUST have already performed an authorisation
// check on the affected row (e.g. topology.CanReadScope on the new
// node, or a successful UPDATE on a row gated by some other means).
// Bypassing the read clamp without a prior write-gate would defeat
// the existence-leak invariant the subtree clamp protects.
func WithBypassedSubtreeClamp(ctx context.Context) context.Context {
	c, ok := ctx.Value(clampCtxKey).(Clamp)
	if !ok {
		return ctx
	}
	c.AllowedSubtreeIDs = nil
	return context.WithValue(ctx, clampCtxKey, c)
}
