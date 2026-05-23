package realtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// PLA060 B16.12.4 — assert RFC 9457 problem+json wire shape on the
// unauthenticated WS-upgrade path. ServeWS short-circuits to 401 before
// the upgrade fires, so we only need the unauthenticated request.

func TestServeWS_Unauth_ProblemJSON(t *testing.T) {
	handler := ServeWS(nil)

	req := httptest.NewRequest("GET", "/realtime/ws", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
}
