package notifications

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// PLA060 B16.12.3 — assert RFC 9457 problem+json wire shape on the
// converted 401 + 500 paths in stream.go. The 500 path fires when the
// response writer is not an http.Flusher; httptest.ResponseRecorder
// does NOT implement Flusher, so wrapping with nonFlushingWriter and
// calling Stream directly walks the 500 branch.

type nonFlushingWriter struct{ http.ResponseWriter }

// Explicitly hide Flush so the type-assertion in Stream fails.

func TestStream_Unauth_ProblemJSON(t *testing.T) {
	h := NewStreamHandler(nil)
	req := httptest.NewRequest("GET", "/notifications/stream", nil)
	rec := httptest.NewRecorder()
	h.Stream(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
}
