// Package sentinel — RED test for PLA062 S03.
//
// This file is intentionally RED on first compile because the package
// it tests (`sentinel`) is empty — see PLA062 sentinel_revision_history.md
// "Replace decision". S04 closes these tests by implementing the package
// substrate (own resolver, own SQL, own ctx helpers; duplicated from
// topology.ClampMiddleware + topology.WorkspaceClampMiddleware which
// get deleted in S25).
//
// The six test cases below pin the contract from the AC of S03:
//   1. Valid JWT + ?focus=<uuid>          → 200, ctx carries clamp
//   2. Valid JWT, no ?focus, user default → 200, focus = user's default
//   3. Valid JWT, no ?focus, no default   → 200, focus = tenant root
//   4. Focus outside tenant               → 403 problem+json
//   5. Focus user has no grant on         → 403 problem+json
//   6. No JWT at all                      → 401 problem+json
//
// All assertions follow the existing topology.middleware_problemjson_test
// pattern (header content-type, response code, inner-handler-not-called
// invariant) so coverage parity is maintained when topology's
// middleware is deleted in S25.

package sentinel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// ---------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------

// fixtureTenantA / fixtureTenantB are the two test subscriptions used by
// the cross-tenant cases. fixtureFocusInA / fixtureFocusInB are topology
// node UUIDs known to belong to each. fixtureUserDefaultFocus is set on
// fixtureUserA so case (2) can verify the user-default fallback.
var (
	fixtureTenantA      = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	fixtureTenantB      = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	fixtureFocusInA     = uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	fixtureFocusInB     = uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	fixtureUserDefault  = uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	fixtureTenantARootA = uuid.MustParse("dddddddd-dddd-dddd-dddd-dddddddddddd")
)

// fixtureUserA returns a roletypes.User scoped to tenant A. The
// caller injects this into the request context to simulate
// auth.RequireAuth having already run.
func fixtureUserA() *roletypes.User {
	return &roletypes.User{
		ID:             uuid.MustParse("99999999-aaaa-aaaa-aaaa-999999999999"),
		SubscriptionID: fixtureTenantA,
		WorkspaceID:    fixtureTenantARootA, // placeholder; sentinel uses topology, not workspace_id
		Email:          "alice@tenant-a.test",
		Role:           roletypes.RoleUser,
		IsActive:       true,
	}
}

// withFixtureUser shoves a *roletypes.User onto ctx the way auth.RequireAuth
// would. Mirrors auth.UserFromCtx's key (see backend/internal/auth/middleware.go).
func withFixtureUser(ctx context.Context, u *roletypes.User) context.Context {
	return auth.WithUserForTest(ctx, u)
}

// stubResolver is the topology-shaped dependency the middleware accepts.
// Implements the interface sentinel.Middleware needs at construction
// time so the test never touches a real DB.
//
// S04 must define this interface name as sentinel.Resolver and accept
// it as the Middleware constructor argument. The test refers to the
// concrete struct here only because the interface lives in a sibling
// file that S04 creates.
type stubResolver struct {
	// resolveFn returns the allowed subtree IDs for a given (tenant,
	// focus, scope_up, scope_down). Per-case behaviour configured by
	// each test below.
	resolveFn func(ctx context.Context, tenant, focus uuid.UUID, scopeUp, scopeDown bool) ([]uuid.UUID, error)

	// defaultFocusFn returns the per-user persisted default focus.
	// nil = no default (falls back to tenant root).
	defaultFocusFn func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)

	// tenantRootFn returns the tenant-root node for fallback case (3).
	tenantRootFn func(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)
}

// ResolveSubtree satisfies sentinel.Resolver. Delegates to resolveFn;
// returns ErrFocusNotInTenant if not configured (signals "test forgot
// to set this up" rather than panicking silently).
func (s *stubResolver) ResolveSubtree(ctx context.Context, tenant, focus uuid.UUID, scopeUp, scopeDown bool) ([]uuid.UUID, error) {
	if s.resolveFn == nil {
		return nil, ErrFocusNotInTenant
	}
	return s.resolveFn(ctx, tenant, focus, scopeUp, scopeDown)
}

// DefaultFocus satisfies sentinel.Resolver. Returns (nil, nil) when
// defaultFocusFn is unset — meaning "user has no default", which the
// middleware treats as fall-through to tenant root.
func (s *stubResolver) DefaultFocus(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	if s.defaultFocusFn == nil {
		return nil, nil
	}
	return s.defaultFocusFn(ctx, userID)
}

// TenantRoot satisfies sentinel.Resolver. Returns a default fixture
// when tenantRootFn is unset so test cases (1), (2), (4), (5), (6) —
// which don't exercise the tenant-root fallback — don't have to
// configure it.
func (s *stubResolver) TenantRoot(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error) {
	if s.tenantRootFn == nil {
		return fixtureTenantARootA, nil
	}
	return s.tenantRootFn(ctx, tenant)
}

// inspectorHandler is the inner handler the middleware wraps. Each test
// reads .clamp afterwards to assert the middleware attached the right
// values. .called pins the "inner must not run when auth/clamp fails"
// invariant.
type inspectorHandler struct {
	called bool
	clamp  *Clamp
}

func (h *inspectorHandler) ServeHTTP(_ http.ResponseWriter, r *http.Request) {
	h.called = true
	c := FromCtx(r.Context())
	h.clamp = &c
}

// ---------------------------------------------------------------------
// Case 1 — Valid JWT + ?focus=<uuid> → 200, ctx carries full clamp
// ---------------------------------------------------------------------

func TestMiddleware_Case1_ValidJWTWithFocus_AttachesFullClamp(t *testing.T) {
	resolver := &stubResolver{
		resolveFn: func(_ context.Context, tenant, focus uuid.UUID, up, down bool) ([]uuid.UUID, error) {
			if tenant != fixtureTenantA {
				t.Fatalf("expected tenant A (%s), got %s", fixtureTenantA, tenant)
			}
			if focus != fixtureFocusInA {
				t.Fatalf("expected focus %s, got %s", fixtureFocusInA, focus)
			}
			return []uuid.UUID{focus, uuid.New(), uuid.New()}, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything?focus="+fixtureFocusInA.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !insp.called {
		t.Fatalf("inner handler must run for valid request, got skipped")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if insp.clamp == nil {
		t.Fatal("clamp not attached to ctx")
	}
	if insp.clamp.TenantID != fixtureTenantA {
		t.Errorf("clamp.TenantID = %s, want %s", insp.clamp.TenantID, fixtureTenantA)
	}
	if insp.clamp.FocusNodeID != fixtureFocusInA {
		t.Errorf("clamp.FocusNodeID = %s, want %s", insp.clamp.FocusNodeID, fixtureFocusInA)
	}
	if !insp.clamp.ScopeUp {
		t.Errorf("clamp.ScopeUp = false, want true (default)")
	}
	if !insp.clamp.ScopeDown {
		t.Errorf("clamp.ScopeDown = false, want true (default)")
	}
	if len(insp.clamp.AllowedSubtreeIDs) != 3 {
		t.Errorf("clamp.AllowedSubtreeIDs len = %d, want 3", len(insp.clamp.AllowedSubtreeIDs))
	}
}

// ---------------------------------------------------------------------
// Case 2 — Valid JWT, no ?focus, user has a default → falls back to default
// ---------------------------------------------------------------------

func TestMiddleware_Case2_NoFocusFallsBackToUserDefault(t *testing.T) {
	resolver := &stubResolver{
		defaultFocusFn: func(_ context.Context, userID uuid.UUID) (*uuid.UUID, error) {
			return &fixtureUserDefault, nil
		},
		resolveFn: func(_ context.Context, tenant, focus uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			if focus != fixtureUserDefault {
				t.Fatalf("expected focus %s (user default), got %s", fixtureUserDefault, focus)
			}
			return []uuid.UUID{focus}, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything", nil) // no ?focus
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if insp.clamp == nil || insp.clamp.FocusNodeID != fixtureUserDefault {
		t.Fatalf("expected clamp.FocusNodeID = user default, got %+v", insp.clamp)
	}
}

// ---------------------------------------------------------------------
// Case 3 — Valid JWT, no ?focus, no user default → falls back to tenant root
// ---------------------------------------------------------------------

func TestMiddleware_Case3_NoFocusNoDefaultFallsBackToTenantRoot(t *testing.T) {
	resolver := &stubResolver{
		defaultFocusFn: func(_ context.Context, _ uuid.UUID) (*uuid.UUID, error) {
			return nil, nil // user has no default
		},
		tenantRootFn: func(_ context.Context, tenant uuid.UUID) (uuid.UUID, error) {
			return fixtureTenantARootA, nil
		},
		resolveFn: func(_ context.Context, _, focus uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			if focus != fixtureTenantARootA {
				t.Fatalf("expected focus = tenant root, got %s", focus)
			}
			return []uuid.UUID{focus}, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything", nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if insp.clamp.FocusNodeID != fixtureTenantARootA {
		t.Errorf("clamp.FocusNodeID = %s, want %s (tenant root)", insp.clamp.FocusNodeID, fixtureTenantARootA)
	}
}

// ---------------------------------------------------------------------
// Case 4 — Focus outside tenant → 403 problem+json (cross-tenant)
// ---------------------------------------------------------------------

func TestMiddleware_Case4_FocusOutsideTenant_403ProblemJSON(t *testing.T) {
	resolver := &stubResolver{
		resolveFn: func(_ context.Context, _, _ uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			return nil, ErrFocusNotInTenant
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	// Alice (tenant A) asking for focus belonging to tenant B
	req := httptest.NewRequest("GET", "/anything?focus="+fixtureFocusInB.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if insp.called {
		t.Fatal("inner handler ran on cross-tenant focus — must not")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v (raw=%s)", err, rec.Body.String())
	}
	if body["type"] != "/errors/sentinel/focus-not-in-tenant" {
		t.Errorf("body.type = %v, want /errors/sentinel/focus-not-in-tenant", body["type"])
	}
}

// ---------------------------------------------------------------------
// Case 5 — Focus user has no grant on → 403 problem+json (no-access)
// ---------------------------------------------------------------------

func TestMiddleware_Case5_FocusNoAccess_403ProblemJSON(t *testing.T) {
	resolver := &stubResolver{
		resolveFn: func(_ context.Context, _, _ uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			return nil, ErrFocusNoAccess
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything?focus="+fixtureFocusInA.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if insp.called {
		t.Fatal("inner handler ran when user has no grant on focus — must not")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["type"] != "/errors/sentinel/focus-no-access" {
		t.Errorf("body.type = %v, want /errors/sentinel/focus-no-access", body["type"])
	}
}

// ---------------------------------------------------------------------
// Case 6 — No JWT (no auth.UserFromCtx user) → 401 problem+json
// ---------------------------------------------------------------------

func TestMiddleware_Case6_NoJWT_401ProblemJSON(t *testing.T) {
	resolver := &stubResolver{}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything", nil) // no user on ctx
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if insp.called {
		t.Fatal("inner handler ran with no auth — must not")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["type"] != "/errors/sentinel/unauthorized" {
		t.Errorf("body.type = %v, want /errors/sentinel/unauthorized", body["type"])
	}
}
