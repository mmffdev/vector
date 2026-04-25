package portfoliomodels

import (
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

// Smoke test for GET /api/portfolio-models/adoption-state.
//
// Mirrors the skip-on-unreachable discipline used by the Phase 3
// handler tests above — when the cluster is down the test skips
// instead of failing. Padmin gating is enforced at the router level
// (RequireRole) and asserted in auth/middleware tests; this test
// exercises the handler body directly with a faked-in user.

func newAdoptionStateRouter(h *AdoptionStateHandler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	r.Get("/api/portfolio-models/adoption-state", h.GetAdoptionState)
	return r
}

// TestGetAdoptionState_NoRow — when the caller's subscription has no
// completed adoption row, the handler returns {"adopted": false} and
// omits the optional fields.
func TestGetAdoptionState_NoRow(t *testing.T) {
	pool, user := testVectorPoolPadmin(t)
	defer pool.Close()

	// Soft-archive any rows for this subscription to guarantee a clean
	// "not adopted" state. We never hard-delete (RESTRICT FK on user).
	_, err := pool.Exec(context.Background(),
		`UPDATE subscription_portfolio_model_state
		    SET archived_at = NOW()
		  WHERE subscription_id = $1
		    AND archived_at IS NULL`,
		user.SubscriptionID)
	if err != nil {
		t.Skipf("cannot reset adoption state (table may not be deployed): %v", err)
	}

	h := NewAdoptionStateHandler(pool)
	srv := httptest.NewServer(newAdoptionStateRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/adoption-state")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body adoptionStateDTO
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Adopted {
		t.Errorf("adopted: want false, got true")
	}
	if body.ModelID != nil || body.AdoptedAt != nil || body.AdoptedByUserID != nil {
		t.Errorf("optional fields should be omitted when adopted=false; got %+v", body)
	}
}

// TestGetAdoptionState_Completed — when a completed, non-archived row
// exists, the handler returns {adopted:true, model_id, adopted_at,
// adopted_by_user_id}.
func TestGetAdoptionState_Completed(t *testing.T) {
	pool, user := testVectorPoolPadmin(t)
	defer pool.Close()

	ctx := context.Background()

	// Clean slate — archive any prior live rows so the partial unique
	// index doesn't fire when we INSERT.
	if _, err := pool.Exec(ctx,
		`UPDATE subscription_portfolio_model_state
		    SET archived_at = NOW()
		  WHERE subscription_id = $1
		    AND archived_at IS NULL`,
		user.SubscriptionID); err != nil {
		t.Skipf("cannot reset adoption state (table may not be deployed): %v", err)
	}

	modelID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscription_portfolio_model_state
		    (subscription_id, adopted_model_id, adopted_by_user_id, status)
		VALUES ($1, $2, $3, 'completed')`,
		user.SubscriptionID, modelID, user.ID); err != nil {
		t.Skipf("cannot insert adoption row: %v", err)
	}
	defer func() {
		_, _ = pool.Exec(ctx,
			`UPDATE subscription_portfolio_model_state
			    SET archived_at = NOW()
			  WHERE subscription_id = $1
			    AND adopted_model_id = $2`,
			user.SubscriptionID, modelID)
	}()

	h := NewAdoptionStateHandler(pool)
	srv := httptest.NewServer(newAdoptionStateRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/adoption-state")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body adoptionStateDTO
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Adopted {
		t.Fatalf("adopted: want true, got false")
	}
	if body.ModelID == nil || *body.ModelID != modelID {
		t.Errorf("model_id: want %s, got %v", modelID, body.ModelID)
	}
	if body.AdoptedAt == nil {
		t.Errorf("adopted_at: want non-nil")
	}
	if body.AdoptedByUserID == nil || *body.AdoptedByUserID != user.ID {
		t.Errorf("adopted_by_user_id: want %s, got %v", user.ID, body.AdoptedByUserID)
	}
}

// testVectorPoolPadmin opens the vector pool and returns a padmin user
// for the request. Skips when the cluster or a usable padmin is absent.
func testVectorPoolPadmin(t *testing.T) (*pgxpool.Pool, *models.User) {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=portfoliomodels_adoption_state_test",
		envOrDef("DB_HOST", "localhost"),
		envOrDef("DB_PORT", "5434"),
		envOrDef("DB_USER", "mmff_dev"),
		os.Getenv("DB_PASSWORD"),
		envOrDef("DB_NAME", "mmff_vector"),
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
		   AND role = 'padmin'
		 ORDER BY created_at
		 LIMIT 1`,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive)
	if err != nil {
		pool.Close()
		t.Skipf("no padmin user available: %v", err)
	}
	return pool, &u
}

func envOrDef(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
