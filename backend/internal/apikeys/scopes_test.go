package apikeys

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

// PLA060 B16.11.2 — HasScope + RequireScope unit tests. Pure context
// manipulation, no DB.

func TestHasScope_EmptyAllows(t *testing.T) {
	ctx := WithScopes(context.Background(), []string{})
	if !HasScope(ctx, ScopeWorkItemsWrite) {
		t.Fatalf("empty scopes must allow any scope (back-compat / TD-SCOPES-DEFAULT)")
	}
}

func TestHasScope_ExactMatch(t *testing.T) {
	ctx := WithScopes(context.Background(), []string{ScopeWorkItemsRead, "other:scope"})
	if !HasScope(ctx, ScopeWorkItemsRead) {
		t.Fatalf("exact-match scope must allow")
	}
}

func TestHasScope_Mismatch(t *testing.T) {
	ctx := WithScopes(context.Background(), []string{ScopeWorkItemsRead})
	if HasScope(ctx, ScopeWorkItemsWrite) {
		t.Fatalf("read-only key must NOT be allowed to write")
	}
}

func TestHasScope_JWTBypass(t *testing.T) {
	// JWT user on ctx — no api-key scopes attached at all.
	ctx := auth.WithUserForTest(context.Background(), &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@pla060.local",
	})
	if !HasScope(ctx, ScopeWorkItemsWrite) {
		t.Fatalf("JWT-authenticated requests must bypass scope enforcement")
	}
}

func TestHasScope_NoAuth_Denies(t *testing.T) {
	// Defensive: if neither api-key scopes nor JWT user is present,
	// we deny rather than allow. RequireAuth upstream should have
	// already rejected, but the gate must not be the weak link.
	ctx := context.Background()
	if HasScope(ctx, ScopeWorkItemsRead) {
		t.Fatalf("no auth on ctx must deny")
	}
}

func TestScopesFromContext_DistinguishesEmptyFromMissing(t *testing.T) {
	// Missing api-key auth altogether: ok == false.
	if _, ok := ScopesFromContext(context.Background()); ok {
		t.Fatalf("expected ScopesFromContext to return (nil, false) when api-key middleware didn't run")
	}
	// Empty scopes attached explicitly: ok == true, slice has len 0.
	ctx := WithScopes(context.Background(), []string{})
	scopes, ok := ScopesFromContext(ctx)
	if !ok {
		t.Fatalf("expected ok=true for explicitly-empty scopes")
	}
	if scopes == nil || len(scopes) != 0 {
		t.Fatalf("expected non-nil zero-length slice; got %v", scopes)
	}
}

// TestRequireScope_Allow + Deny exercise the http.Handler wrap. The
// "real" data-plane integration tests live in scopes_handler_test.go;
// these unit tests pin the middleware contract independently.

func TestRequireScope_Allow(t *testing.T) {
	called := false
	h := RequireScope(ScopeWorkItemsRead)(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest("GET", "/anything", nil)
	req = req.WithContext(WithScopes(req.Context(), []string{ScopeWorkItemsRead}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !called {
		t.Fatalf("expected inner handler to be called when scope matches")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected default 200, got %d", rec.Code)
	}
}

func TestRequireScope_Deny_ProblemJSON(t *testing.T) {
	called := false
	h := RequireScope(ScopeWorkItemsWrite)(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest("POST", "/anything", nil)
	req = req.WithContext(WithScopes(req.Context(), []string{ScopeWorkItemsRead}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if called {
		t.Fatalf("inner handler must NOT run when scope is denied")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
	// Confirm the Problem.Code is the documented value, not just any 403.
	var problem map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &problem); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if problem["code"] != "scope_denied" {
		t.Fatalf("expected Problem.Code=scope_denied; got %v", problem["code"])
	}
}
