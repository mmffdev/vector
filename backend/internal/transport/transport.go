// Package transport carries the "which HTTP transport admitted this
// request" tag through the request context (PLA-0039 / Story 00531).
//
// Two transports exist after the segregation cutover:
//
//	Site   — BFF mount at /_site; session-cookie auth; UI flows.
//	Public — public API mount at /samantha/v2; key auth; frozen contract.
//
// A handler-side router-middleware tags every request with the
// appropriate Transport before the handler runs. Services / audit /
// authz read it back via FromContext to make per-transport decisions
// without tight coupling to chi mount paths.
//
// The string values match db/schema/143_audit_log_source_transport.sql
// CHECK constraint and the lint:public-dto-mapper exemption ledger.
package transport

import "context"

// Transport identifies the HTTP transport that admitted the request.
type Transport string

const (
	// Site — BFF transport mounted at /_site. Session-cookie auth.
	Site Transport = "site"
	// Public — public API transport mounted at /samantha/v2. Key auth.
	Public Transport = "public"
)

// String returns the wire form ("site" / "public").
func (t Transport) String() string { return string(t) }

// IsValid reports whether t is one of the recognised transports.
func (t Transport) IsValid() bool {
	return t == Site || t == Public
}

// ctxKey is unexported to prevent cross-package collisions.
type ctxKey struct{}

// WithContext returns a new context tagged with t. Callers SHOULD use
// WithSiteContext / WithPublicContext at the router-middleware
// boundary; direct WithContext is reserved for tests.
func WithContext(ctx context.Context, t Transport) context.Context {
	return context.WithValue(ctx, ctxKey{}, t)
}

// WithSiteContext tags ctx as a /_site request. Idiomatic site
// router-middleware:
//
//	func TagSite(next http.Handler) http.Handler {
//	    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//	        next.ServeHTTP(w, r.WithContext(transport.WithSiteContext(r.Context())))
//	    })
//	}
func WithSiteContext(ctx context.Context) context.Context {
	return WithContext(ctx, Site)
}

// WithPublicContext tags ctx as a /samantha/v2 request.
func WithPublicContext(ctx context.Context) context.Context {
	return WithContext(ctx, Public)
}

// FromContext returns the Transport tagged on ctx, or false if no
// transport was tagged. Services that need a per-transport decision
// (e.g. audit.Record) treat absence as a configuration bug — every
// request SHOULD pass through the router middleware.
func FromContext(ctx context.Context) (Transport, bool) {
	v, ok := ctx.Value(ctxKey{}).(Transport)
	return v, ok
}

// FromContextOr returns the tagged transport, or fallback if none was
// set. Use when a transport is required for telemetry but a missing
// tag should not fail the request (e.g. legacy auth flows still being
// migrated under PLA-0039).
func FromContextOr(ctx context.Context, fallback Transport) Transport {
	if v, ok := FromContext(ctx); ok {
		return v
	}
	return fallback
}
