package errorsreport

import (
	"bytes"
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

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// Smoke tests follow the same skip-on-unreachable discipline as
// libraryreleases/handler_test.go. They exercise the wire contract +
// cross-DB validate-then-write flow against the real tunnel; they do
// NOT mock pgx.

// withUser injects a fake user into the context so handlers can be
// invoked without minting a real JWT.
func withUser(u *models.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func newRouter(h *Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(withUser(u))
	r.Post("/api/errors/report", h.Report)
	return r
}

func TestReport_OK(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, user := testVectorPool(t)
	defer vecPool.Close()

	h := NewHandler(libPool, vecPool)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	body := `{"code":"ADOPT_INTERNAL","context":{"handler":"smoke_test","detail":"ok"}}`
	resp, err := http.Post(srv.URL+"/api/errors/report", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status: want 204, got %d", resp.StatusCode)
	}

	// Verify a row landed for this subscription with the expected code.
	var found int
	err = vecPool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM error_events WHERE subscription_id = $1 AND code = $2 AND context->>'handler' = $3`,
		user.SubscriptionID, "ADOPT_INTERNAL", "smoke_test",
	).Scan(&found)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if found < 1 {
		t.Errorf("error_events row not inserted (found=%d)", found)
	}

	// Tidy: drop the rows this test created. error_events has an
	// append-only trigger that rejects DELETE — so we can't clean up.
	// That's a deliberate property of the table; the test harness lives
	// with it (rows are scoped to the test subscription_id and short).
}

func TestReport_UnknownCode(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, user := testVectorPool(t)
	defer vecPool.Close()

	h := NewHandler(libPool, vecPool)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	body := `{"code":"DEFINITELY_NOT_A_REAL_CODE_XYZ","context":{}}`
	resp, err := http.Post(srv.URL+"/api/errors/report", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
	var out map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["error"] != "unknown_error_code" {
		t.Errorf("error body: want unknown_error_code, got %q", out["error"])
	}
}

func TestReport_MissingCode(t *testing.T) {
	// No DB needed — we reject before the lookup.
	h := NewHandler(nil, nil)
	user := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RoleUser, IsActive: true}
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/errors/report", "application/json", strings.NewReader(`{"context":{}}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

func TestReport_OversizeContext(t *testing.T) {
	// No DB needed — we reject before the lookup.
	h := NewHandler(nil, nil)
	user := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RoleUser, IsActive: true}
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	// Build a JSON object whose encoded size exceeds MaxContextBytes.
	big := bytes.Repeat([]byte("a"), MaxContextBytes+1)
	body := fmt.Sprintf(`{"code":"ADOPT_INTERNAL","context":{"blob":%q}}`, big)
	resp, err := http.Post(srv.URL+"/api/errors/report", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

// ----- shared fixtures -----

func loadEnv() {
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			return
		}
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func testLibraryROPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	loadEnv()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=errorsreport_handler_test",
		envOr("LIBRARY_DB_HOST", "localhost"),
		envOr("LIBRARY_DB_PORT", "5434"),
		envOr("LIBRARY_DB_USER", "mmff_library_ro"),
		envOr("LIBRARY_DB_PASSWORD", "change_me_ro"),
		envOr("LIBRARY_DB_NAME", "mmff_library"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open library RO pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_library: %v", err)
	}
	return pool
}

// testVectorPool returns a pool + an authenticated user from any role.
// We pick the first active user; error reporting is generic across
// padmin/gadmin/user, so role doesn't matter here.
func testVectorPool(t *testing.T) (*pgxpool.Pool, *models.User) {
	t.Helper()
	loadEnv()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=errorsreport_handler_test",
		envOr("DB_HOST", "localhost"),
		envOr("DB_PORT", "5434"),
		envOr("DB_USER", "mmff_dev"),
		os.Getenv("DB_PASSWORD"),
		envOr("DB_NAME", "mmff_vector"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector: %v", err)
	}

	var u models.User
	err = pool.QueryRow(context.Background(), `
		SELECT id, subscription_id, email, role, is_active
		FROM users
		WHERE is_active = TRUE
		ORDER BY created_at
		LIMIT 1`).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive)
	if err != nil {
		pool.Close()
		t.Skipf("no active user available: %v", err)
	}
	return pool, &u
}
