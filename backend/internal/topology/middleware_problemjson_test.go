package topology

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// PLA060 B16.12.2 — assert RFC 9457 problem+json wire shape on the
// converted ClampMiddleware unauthenticated path. The inner handler
// must never run when auth is absent; the response carries
// application/problem+json content type.

func TestClampMiddleware_Unauth_ProblemJSON(t *testing.T) {
	s := &Service{}
	innerCalled := false
	inner := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		innerCalled = true
	})
	h := s.ClampMiddleware(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if innerCalled {
		t.Fatalf("inner handler must not run when auth is absent")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
}

func TestWorkspaceClampMiddleware_Unauth_ProblemJSON(t *testing.T) {
	innerCalled := false
	inner := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		innerCalled = true
	})
	h := WorkspaceClampMiddleware(nil)(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if innerCalled {
		t.Fatalf("inner handler must not run when auth is absent")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
}
