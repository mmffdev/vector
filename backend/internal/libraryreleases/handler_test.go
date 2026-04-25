package libraryreleases

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

const (
	seededReleaseID = "00000000-0000-0000-0000-00000000ad01"
	missingID       = "00000000-0000-0000-0000-0000deadbeef"
)

// withUser injects a fake user into the context — matches what
// auth.RequireAuth does at runtime so handlers can be exercised without
// minting a real JWT for every test.
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
	r.Get("/api/library/releases", h.List)
	r.Get("/api/library/releases/count", h.Count)
	r.Post("/api/library/releases/{id}/ack", h.Ack)
	return r
}

func TestList_OK(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, sub, user := testVectorPool(t)
	defer vecPool.Close()

	// Reset ack so seeded release is in the list.
	releaseID := uuid.MustParse(seededReleaseID)
	_, _ = vecPool.Exec(context.Background(),
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		sub.ID, releaseID)

	h := NewHandler(libPool, vecPool, nil, nil)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/library/releases")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body listResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Count < 1 {
		t.Errorf("count: want >=1, got %d", body.Count)
	}
}

func TestAck_BadAction(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, _, user := testVectorPool(t)
	defer vecPool.Close()

	h := NewHandler(libPool, vecPool, nil, nil)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	body := bytes.NewBufferString(`{"action_taken": "not-a-real-action"}`)
	resp, err := http.Post(
		srv.URL+"/api/library/releases/"+seededReleaseID+"/ack",
		"application/json", body,
	)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

func TestAck_NotFound(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, _, user := testVectorPool(t)
	defer vecPool.Close()

	h := NewHandler(libPool, vecPool, nil, nil)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	body := bytes.NewBufferString(`{"action_taken": "dismissed"}`)
	resp, err := http.Post(
		srv.URL+"/api/library/releases/"+missingID+"/ack",
		"application/json", body,
	)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}

func TestAck_OK_Then_Idempotent(t *testing.T) {
	libPool := testLibraryROPool(t)
	defer libPool.Close()
	vecPool, sub, user := testVectorPool(t)
	defer vecPool.Close()

	releaseID := uuid.MustParse(seededReleaseID)
	_, _ = vecPool.Exec(context.Background(),
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		sub.ID, releaseID)

	h := NewHandler(libPool, vecPool, nil, nil)
	srv := httptest.NewServer(newRouter(h, user))
	defer srv.Close()

	post := func() *http.Response {
		body := bytes.NewBufferString(`{"action_taken": "dismissed"}`)
		resp, err := http.Post(
			srv.URL+"/api/library/releases/"+seededReleaseID+"/ack",
			"application/json", body,
		)
		if err != nil {
			t.Fatalf("POST: %v", err)
		}
		return resp
	}

	r1 := post()
	defer r1.Body.Close()
	if r1.StatusCode != http.StatusCreated {
		t.Fatalf("first ack: want 201, got %d", r1.StatusCode)
	}

	r2 := post()
	defer r2.Body.Close()
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("second ack: want 200, got %d", r2.StatusCode)
	}

	// Cleanup so re-runs start fresh.
	_, _ = vecPool.Exec(context.Background(),
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		sub.ID, releaseID)
}

// ─── test plumbing ──────────────────────────────────────────────────

func loadEnv() {
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
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
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=libraryreleases_handler_test",
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

// subRef is a tiny test-only struct holding the ack target — we don't
// need the full Subscription model.
type subRef struct {
	ID   uuid.UUID
	Tier string
}

// testVectorPool returns a pool + a usable gadmin user for ack tests.
func testVectorPool(t *testing.T) (*pgxpool.Pool, *subRef, *models.User) {
	t.Helper()
	loadEnv()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=libraryreleases_handler_test",
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
	var sub subRef
	err = pool.QueryRow(context.Background(), `
		SELECT u.id, u.subscription_id, u.email, u.role, u.is_active, s.id, s.tier
		FROM users u JOIN subscriptions s ON s.id = u.subscription_id
		WHERE u.is_active = TRUE AND u.role = 'gadmin'
		ORDER BY u.created_at
		LIMIT 1`).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &sub.ID, &sub.Tier)
	if err != nil {
		pool.Close()
		t.Skipf("no gadmin user available: %v", err)
	}
	return pool, &sub, &u
}
