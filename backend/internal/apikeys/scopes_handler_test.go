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

// PLA060 B16.11.6 — four-branch matrix for the scope gate, exercised
// at the http.Handler level. We don't need a full chi router + DB stack
// to prove the contract; the middleware just decorates the inner handler
// with HasScope. These tests pin: read-only-can-read, read-only-cannot-
// write, write-can-write, missing-scope-denied, plus JWT bypass.

// stubArtefactsHandler emulates the (artefactitems.Handler).List / .Create
// endpoints with status codes that match the live routes (200 for GET,
// 201 for POST). The body is empty; only the status code matters for
// these assertions.
func stubGet(w http.ResponseWriter, _ *http.Request)  { w.WriteHeader(http.StatusOK) }
func stubPost(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) }

// mountWorkItemsStub wires the same Read/Write split as main.go's
// mountArtefactRoutes for /samantha/v2/work-items.
func mountWorkItemsStub() http.Handler {
	mux := http.NewServeMux()
	read := RequireScope(ScopeWorkItemsRead)(http.HandlerFunc(stubGet))
	write := RequireScope(ScopeWorkItemsWrite)(http.HandlerFunc(stubPost))
	mux.Handle("GET /work_items", read)
	mux.Handle("POST /work_items", write)
	return mux
}

// callWithScopes builds a request, attaches the given api-key scopes,
// and runs it through the stub mux.
func callWithScopes(t *testing.T, method, path string, scopes []string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	req = req.WithContext(WithScopes(req.Context(), scopes))
	rec := httptest.NewRecorder()
	mountWorkItemsStub().ServeHTTP(rec, req)
	return rec
}

func TestScope_ReadOnlyKey_CanGetWorkItems(t *testing.T) {
	rec := callWithScopes(t, "GET", "/work_items", []string{ScopeWorkItemsRead})
	if rec.Code != http.StatusOK {
		t.Fatalf("read-only key on GET expected 200; got %d", rec.Code)
	}
}

func TestScope_ReadOnlyKey_CannotPostWorkItems(t *testing.T) {
	rec := callWithScopes(t, "POST", "/work_items", []string{ScopeWorkItemsRead})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read-only key on POST expected 403; got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
	var problem map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &problem); err != nil {
		t.Fatalf("body not valid JSON: %v", err)
	}
	if problem["code"] != "scope_denied" {
		t.Fatalf("expected Problem.Code=scope_denied; got %v", problem["code"])
	}
}

func TestScope_WriteKey_CanPostWorkItems(t *testing.T) {
	rec := callWithScopes(t, "POST", "/work_items", []string{ScopeWorkItemsWrite})
	if rec.Code != http.StatusCreated {
		t.Fatalf("write key on POST expected 201; got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestScope_MissingScope_Denied(t *testing.T) {
	rec := callWithScopes(t, "GET", "/work_items", []string{"unrelated:scope"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unrelated scope on GET expected 403; got %d", rec.Code)
	}
	var problem map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &problem)
	if problem["code"] != "scope_denied" {
		t.Fatalf("expected Problem.Code=scope_denied; got %v", problem["code"])
	}
}

func TestScope_JWTUser_BypassesScopeCheck(t *testing.T) {
	// No api-key scopes attached; a JWT user IS on the ctx. The scope
	// gate must let this through (scopes are an api-key-only construct).
	req := httptest.NewRequest("POST", "/work_items", nil)
	ctx := auth.WithUserForTest(req.Context(), &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@pla060.local",
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	mountWorkItemsStub().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("JWT user expected to bypass scope on POST; got %d", rec.Code)
	}
}

// Sanity guard: the same code path works for portfolio-items scopes
// (lets a future regression in the constant naming or the helper signature
// surface here rather than only in /work-items).
func TestScope_PortfolioItemsConstants_ReadWriteSplit(t *testing.T) {
	mux := http.NewServeMux()
	mux.Handle("GET /portfolio_items", RequireScope(ScopePortfolioItemsRead)(http.HandlerFunc(stubGet)))
	mux.Handle("POST /portfolio_items", RequireScope(ScopePortfolioItemsWrite)(http.HandlerFunc(stubPost)))

	// Read-only portfolio_items key can GET but cannot POST.
	for _, c := range []struct {
		method     string
		scopes     []string
		wantStatus int
		label      string
	}{
		{"GET", []string{ScopePortfolioItemsRead}, http.StatusOK, "read on read"},
		{"POST", []string{ScopePortfolioItemsRead}, http.StatusForbidden, "read on write"},
		{"POST", []string{ScopePortfolioItemsWrite}, http.StatusCreated, "write on write"},
	} {
		req := httptest.NewRequest(c.method, "/portfolio_items", nil)
		req = req.WithContext(WithScopes(context.Background(), c.scopes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != c.wantStatus {
			t.Errorf("portfolio_items %s: expected %d; got %d", c.label, c.wantStatus, rec.Code)
		}
	}
}
