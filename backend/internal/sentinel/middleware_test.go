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
//   1. Valid JWT + ?meg=<uuid>          → 200, ctx carries clamp
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
	fixtureWorkspaceInA = uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	fixtureWorkspaceInB = uuid.MustParse("ffffffff-ffff-ffff-ffff-ffffffffffff")
)

// fixtureUserA returns a roletypes.User scoped to tenant A. The
// caller injects this into the request context to simulate
// auth.RequireAuth having already run.
func fixtureUserA() *roletypes.User {
	return &roletypes.User{
		ID:             uuid.MustParse("99999999-aaaa-aaaa-aaaa-999999999999"),
		SubscriptionID: fixtureTenantA,
		WorkspaceID:    fixtureWorkspaceInA, // JWT carries a workspace claim (PLA-0053 era)
		Email:          "alice@tenant-a.test",
		Role:           roletypes.RoleUser,
		IsActive:       true,
	}
}

// fixtureLegacyUserA returns a user whose JWT predates PLA-0053 — no
// workspace_id claim. Used by case 8 to assert the FirstLiveWorkspace
// fallback path.
func fixtureLegacyUserA() *roletypes.User {
	u := fixtureUserA()
	u.WorkspaceID = uuid.Nil
	return u
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

	// firstLiveWorkspaceFn returns the legacy-JWT-fallback workspace.
	// Configured in S05.1 workspace-resolution tests (cases 7/8).
	firstLiveWorkspaceFn func(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)

	// hasActiveRoleFn returns whether the actor has an active role on
	// the resolved workspace. Configured per case.
	hasActiveRoleFn func(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error)

	// grantOnNodeFn returns whether the actor holds an active grant on
	// the node or any ancestor. Used by handler tests (PutFocus); the
	// middleware itself never calls this — added here so stubResolver
	// continues to satisfy the Resolver interface after S26-followup.
	grantOnNodeFn func(ctx context.Context, tenant, userID, nodeID uuid.UUID) (bool, error)

	// setUserDefaultFocusFn captures the write-side of PutFocus.
	// Tests inspect last-call state via the closure they install.
	setUserDefaultFocusFn func(ctx context.Context, userID uuid.UUID, nodeID *uuid.UUID) error
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

// FirstLiveWorkspace satisfies sentinel.Resolver. Returns a default
// fixture workspace when firstLiveWorkspaceFn is unset — cases (1)-(6)
// inject a workspace_id via the fixture user JWT so they never hit
// this fallback.
func (s *stubResolver) FirstLiveWorkspace(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error) {
	if s.firstLiveWorkspaceFn == nil {
		return fixtureWorkspaceInA, nil
	}
	return s.firstLiveWorkspaceFn(ctx, tenant)
}

// HasActiveRole satisfies sentinel.Resolver. Default: true (most
// cases). Cases that want to assert the 403 /no-workspace-role path
// override this with a stub returning false.
func (s *stubResolver) HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error) {
	if s.hasActiveRoleFn == nil {
		return true, nil
	}
	return s.hasActiveRoleFn(ctx, workspaceID, userID)
}

// GrantOnNode satisfies sentinel.Resolver. Defaults to false — handler
// tests for PutFocus install a closure returning true on the happy path.
func (s *stubResolver) GrantOnNode(ctx context.Context, tenant, userID, nodeID uuid.UUID) (bool, error) {
	if s.grantOnNodeFn == nil {
		return false, nil
	}
	return s.grantOnNodeFn(ctx, tenant, userID, nodeID)
}

// SetUserDefaultFocus satisfies sentinel.Resolver. Defaults to nil
// (silently succeeds) so middleware tests don't have to configure it.
func (s *stubResolver) SetUserDefaultFocus(ctx context.Context, userID uuid.UUID, nodeID *uuid.UUID) error {
	if s.setUserDefaultFocusFn == nil {
		return nil
	}
	return s.setUserDefaultFocusFn(ctx, userID, nodeID)
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
// Case 1 — Valid JWT + ?meg=<uuid> → 200, ctx carries full clamp
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

	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInA.String(), nil)
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
	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInB.String(), nil)
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

	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInA.String(), nil)
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

// ---------------------------------------------------------------------
// Case 7 — JWT carries workspace_id claim → clamp.WorkspaceID set to it
// ---------------------------------------------------------------------
// Added by S05.1 (PLA062) absorbing the workspace clamp from
// topology.WorkspaceClampMiddleware into Sentinel. The contract: when
// the JWT carries workspace_id (PLA-0053 era — every token from
// 2026-05-16 onward), Middleware uses it directly without hitting
// FirstLiveWorkspace, but STILL checks HasActiveRole so a forged claim
// cannot reach a workspace the actor has no grant on.

func TestMiddleware_Case7_JWTWorkspaceClaim_SetsWorkspaceID(t *testing.T) {
	firstLiveCalled := false
	hasRoleCalled := false
	resolver := &stubResolver{
		resolveFn: func(_ context.Context, _, focus uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			return []uuid.UUID{focus}, nil
		},
		firstLiveWorkspaceFn: func(_ context.Context, _ uuid.UUID) (uuid.UUID, error) {
			firstLiveCalled = true
			t.Fatal("FirstLiveWorkspace must NOT be called when JWT carries workspace_id")
			return uuid.Nil, nil
		},
		hasActiveRoleFn: func(_ context.Context, ws, _ uuid.UUID) (bool, error) {
			hasRoleCalled = true
			if ws != fixtureWorkspaceInA {
				t.Errorf("HasActiveRole called with ws=%s, want %s (from JWT claim)", ws, fixtureWorkspaceInA)
			}
			return true, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInA.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA())) // JWT has WorkspaceID = fixtureWorkspaceInA
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if firstLiveCalled {
		t.Error("FirstLiveWorkspace was called despite JWT carrying workspace_id")
	}
	if !hasRoleCalled {
		t.Error("HasActiveRole was NOT called — forgery guard skipped")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if insp.clamp == nil {
		t.Fatal("clamp not attached")
	}
	if insp.clamp.WorkspaceID != fixtureWorkspaceInA {
		t.Errorf("clamp.WorkspaceID = %s, want %s", insp.clamp.WorkspaceID, fixtureWorkspaceInA)
	}
}

// ---------------------------------------------------------------------
// Case 8 — Legacy JWT (no workspace_id) → falls back to FirstLiveWorkspace
// ---------------------------------------------------------------------
// PLA-0053 / story 00576 backwards-compatibility window: tokens
// minted before 2026-05-16 carry no workspace_id claim. The
// middleware must fall back to FirstLiveWorkspace for these.

func TestMiddleware_Case8_LegacyJWT_FallsBackToFirstLive(t *testing.T) {
	firstLiveCalled := false
	resolver := &stubResolver{
		resolveFn: func(_ context.Context, _, focus uuid.UUID, _, _ bool) ([]uuid.UUID, error) {
			return []uuid.UUID{focus}, nil
		},
		firstLiveWorkspaceFn: func(_ context.Context, tenant uuid.UUID) (uuid.UUID, error) {
			firstLiveCalled = true
			if tenant != fixtureTenantA {
				t.Errorf("FirstLiveWorkspace called with tenant=%s, want %s", tenant, fixtureTenantA)
			}
			return fixtureWorkspaceInA, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInA.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureLegacyUserA())) // no workspace_id
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !firstLiveCalled {
		t.Fatal("FirstLiveWorkspace was NOT called despite legacy JWT")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if insp.clamp.WorkspaceID != fixtureWorkspaceInA {
		t.Errorf("clamp.WorkspaceID = %s, want %s (first-live)", insp.clamp.WorkspaceID, fixtureWorkspaceInA)
	}
}

// ---------------------------------------------------------------------
// Case 9 — User has no active role on resolved workspace → 403 problem+json
// ---------------------------------------------------------------------
// Even when workspace resolution succeeds (JWT or fallback), the actor
// must hold an active role on the resolved workspace. This guards
// against forged JWT claims and against tokens issued before role
// revocation. Preserves AC#3 from the original PLA-0053 story 00378.

func TestMiddleware_Case9_NoActiveRoleOnWorkspace_403ProblemJSON(t *testing.T) {
	resolver := &stubResolver{
		hasActiveRoleFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
			return false, nil
		},
	}

	mw := Middleware(resolver)
	insp := &inspectorHandler{}
	h := mw(insp)

	req := httptest.NewRequest("GET", "/anything?meg="+fixtureFocusInA.String(), nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if insp.called {
		t.Fatal("inner handler ran when user has no role on workspace — must not")
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
	if body["type"] != "/errors/sentinel/no-workspace-role" {
		t.Errorf("body.type = %v, want /errors/sentinel/no-workspace-role", body["type"])
	}
}
