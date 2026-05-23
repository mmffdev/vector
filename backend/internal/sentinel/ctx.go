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
