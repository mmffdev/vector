package sentinel

import (
	"context"
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
