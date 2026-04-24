package portfoliomodels

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Handler tests hit the live mmff_library RO pool via the SSH tunnel
// (same skip-on-unreachable discipline as librarydb/fetch_test.go).
// We don't mock librarydb.Fetch* — the fetcher's contract is asserted
// in fetch_test.go; here we assert the HTTP wrapping.

const (
	seededFamilyID = "00000000-0000-0000-0000-00000000a000"
	seededModelID  = "00000000-0000-0000-0000-00000000aa01"
	missingID      = "00000000-0000-0000-0000-0000deadbeef"
)

func newTestRouter(t *testing.T, h *Handler) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	// Phase 3 wiring uses RequireAuth, but the auth middleware needs
	// a real Service + JWT secrets. The Phase 3 contract is "calls
	// reach the handler iff RequireAuth admits them" — auth is asserted
	// in auth/middleware tests. Here we mount the handlers bare.
	r.Get("/api/portfolio-models/{family}/latest", h.GetLatestByFamily)
	r.Get("/api/portfolio-models/{id}", h.GetByModelID)
	return r
}

func TestGetLatestByFamily_OK(t *testing.T) {
	pool := testRoPool(t)
	defer pool.Close()
	srv := httptest.NewServer(newTestRouter(t, NewHandler(pool)))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/" + seededFamilyID + "/latest")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body bundleDTO
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Model.Key != "mmff" {
		t.Errorf("model.key: want mmff, got %q", body.Model.Key)
	}
	if len(body.Layers) != 5 {
		t.Errorf("layers: want 5, got %d", len(body.Layers))
	}
	// feature_flags must be embedded JSON, never base64. The DTO emits
	// json.RawMessage; assert it parses as an object/null/array, not a
	// quoted string (which would indicate base64 fallback).
	if len(body.Model.FeatureFlags) > 0 && body.Model.FeatureFlags[0] == '"' {
		t.Errorf("feature_flags came through as a quoted string (base64?): %s",
			string(body.Model.FeatureFlags))
	}
}

func TestGetByModelID_NotFound(t *testing.T) {
	pool := testRoPool(t)
	defer pool.Close()
	srv := httptest.NewServer(newTestRouter(t, NewHandler(pool)))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/" + missingID)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}

func TestGetByModelID_OK(t *testing.T) {
	pool := testRoPool(t)
	defer pool.Close()
	srv := httptest.NewServer(newTestRouter(t, NewHandler(pool)))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/" + seededModelID)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body bundleDTO
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Model.ID != uuid.MustParse(seededModelID) {
		t.Errorf("model.id: want %s, got %s", seededModelID, body.Model.ID)
	}
}

func TestGetByModelID_BadUUID(t *testing.T) {
	// Doesn't need DB — UUID parse fails before pool use.
	srv := httptest.NewServer(newTestRouter(t, NewHandler(nil)))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/not-a-uuid")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
	body, _ := readAllString(resp)
	if !strings.Contains(body, "invalid model id") {
		t.Errorf("body: want 'invalid model id', got %q", body)
	}
}

func TestGetLatestByFamily_BadUUID(t *testing.T) {
	srv := httptest.NewServer(newTestRouter(t, NewHandler(nil)))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/not-a-uuid/latest")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

// testRoPool — same skip discipline as librarydb/fetch_test.go.
func testRoPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	host := envOr("LIBRARY_DB_HOST", "localhost")
	port := envOr("LIBRARY_DB_PORT", "5434")
	dbname := envOr("LIBRARY_DB_NAME", "mmff_library")
	user := envOr("LIBRARY_DB_USER", "mmff_library_ro")
	pwd := envOr("LIBRARY_DB_PASSWORD", "change_me_ro")

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=portfoliomodels_handler_test",
		host, port, user, pwd, dbname,
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open library RO pool (cluster down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_library as RO: %v", err)
	}
	return pool
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func readAllString(resp *http.Response) (string, error) {
	buf := make([]byte, 1024)
	n, err := resp.Body.Read(buf)
	if err != nil && err.Error() != "EOF" {
		return "", err
	}
	return string(buf[:n]), nil
}
