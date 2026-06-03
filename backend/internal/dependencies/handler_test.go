package dependencies

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// TestHandler_MountIsCallable — handler.Mount builds and accepts a
// chi router without panicking. B23.1.4 ships the scaffold with no
// routes registered; this test pins that calling Mount is safe and
// that an arbitrary request returns 404 (no routes mounted yet).
func TestHandler_MountIsCallable(t *testing.T) {
	t.Parallel()

	h := NewHandler(NewService(nil))
	r := chi.NewRouter()
	r.Route("/_site/dependencies", func(sr chi.Router) {
		h.Mount(sr)
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/_site/dependencies/maps")
	if err != nil {
		t.Fatalf("GET /_site/dependencies/maps: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 (no routes mounted yet), got %d", resp.StatusCode)
	}
}
