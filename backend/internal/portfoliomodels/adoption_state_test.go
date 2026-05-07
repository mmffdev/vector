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

// PLA-0026 / Story 00501 (B12): smoke tests for GET
// /api/portfolio-models/adoption-state after the rewrite to read from
// the new substrate (master_record_portfolio + artefact_types).
//
// Skip-on-unreachable discipline matches the rest of portfoliomodels:
// when either the mmff_vector cluster or the vector_artefacts cluster
// is not reachable (e.g. tunnel down) the test skips instead of
// failing. Padmin gating is enforced at the router level
// (RequirePermission) and asserted in auth/middleware tests; these
// tests exercise the handler body directly with a faked-in user.

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

// TestGetAdoptionState_Unauthorized — no user in context returns 401
// without touching the DB. Doesn't need either pool to be reachable.
func TestGetAdoptionState_Unauthorized(t *testing.T) {
	h := NewAdoptionStateHandler(nil, nil)
	r := chi.NewRouter()
	r.Get("/api/portfolio-models/adoption-state", h.GetAdoptionState)

	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models/adoption-state")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d", resp.StatusCode)
	}
}

// TestGetAdoptionState_NoWorkspace — when the caller's subscription
// has no workspace, the handler returns 200 status='notStarted'
// (legitimate empty state, never a 404).
func TestGetAdoptionState_NoWorkspace(t *testing.T) {
	pool, _ := testVectorPoolPadmin(t)
	defer pool.Close()

	// Synthetic user pointing at a fresh subscription_id with no rows
	// in workspaces — guarantees the resolveWorkspace path returns
	// notStarted without polluting real fixtures.
	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "synthetic-noworkspace@adoption-state.test",
		Role:           "padmin",
		IsActive:       true,
	}

	h := NewAdoptionStateHandler(pool, nil) // vaPool nil — should still work
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
	if body.Status != statusNotStarted {
		t.Errorf("status: want %q, got %q", statusNotStarted, body.Status)
	}
	if body.Adopted {
		t.Errorf("adopted: want false, got true")
	}
}

// TestGetAdoptionState_VAPoolNil — when the caller HAS a workspace
// but vaPool is nil (VECTOR_ARTEFACTS_DB_URL unset), the handler
// degrades to notStarted instead of 5xx. Backward-compatible with
// VA-disabled environments.
func TestGetAdoptionState_VAPoolNil(t *testing.T) {
	pool, user := testVectorPoolPadmin(t)
	defer pool.Close()

	// Confirm the caller has at least one live workspace; otherwise
	// the test collapses into NoWorkspace coverage.
	var ws uuid.UUID
	err := pool.QueryRow(context.Background(),
		`SELECT id FROM workspaces
		  WHERE subscription_id = $1 AND archived_at IS NULL
		  ORDER BY id LIMIT 1`,
		user.SubscriptionID,
	).Scan(&ws)
	if err != nil {
		t.Skipf("no live workspace for padmin's subscription: %v", err)
	}

	h := NewAdoptionStateHandler(pool, nil)
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
	if body.Status != statusNotStarted {
		t.Errorf("status: want %q, got %q", statusNotStarted, body.Status)
	}
}

// TestGetAdoptionState_NotStarted — both pools live, no
// master_record_portfolio row AND no scope='strategy' artefact_types
// row for the workspace → status='notStarted'.
func TestGetAdoptionState_NotStarted(t *testing.T) {
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	// Resolve the caller's workspace — same convention the handler uses.
	var ws uuid.UUID
	if err := vec.QueryRow(ctx,
		`SELECT id FROM workspaces
		  WHERE subscription_id = $1 AND archived_at IS NULL
		  ORDER BY id LIMIT 1`,
		user.SubscriptionID,
	).Scan(&ws); err != nil {
		t.Skipf("no live workspace for padmin's subscription: %v", err)
	}

	// Hard-delete any master_record_portfolio row for this workspace —
	// soft-archive would still be filtered out by the handler, but the
	// test guarantees a clean slate. The table is by-design rebuildable
	// from the saga, so a delete here is safe in the dev tunnel.
	if _, err := va.Exec(ctx,
		`DELETE FROM master_record_portfolio WHERE workspace_id = $1`,
		ws,
	); err != nil {
		t.Skipf("cannot reset master_record_portfolio (table may not be deployed): %v", err)
	}

	// Soft-archive any live scope='strategy' artefact_types rows for
	// this workspace so we hit the notStarted branch deterministically.
	// We never hard-delete (other rows may FK at it).
	if _, err := va.Exec(ctx,
		`UPDATE artefact_types
		    SET archived_at = COALESCE(archived_at, now())
		  WHERE workspace_id = $1
		    AND scope = 'strategy'
		    AND archived_at IS NULL`,
		ws,
	); err != nil {
		t.Skipf("cannot archive strategy artefact_types: %v", err)
	}

	h := NewAdoptionStateHandler(vec, va)
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
	if body.Status != statusNotStarted {
		t.Errorf("status: want %q, got %q", statusNotStarted, body.Status)
	}
	if body.Adopted {
		t.Errorf("adopted: want false, got true")
	}
	if body.ModelID != nil || body.AdoptedAt != nil || body.AdoptedByUserID != nil {
		t.Errorf("optional fields should be omitted; got %+v", body)
	}
}

// TestGetAdoptionState_InProgress — strategy artefact_types rows
// exist for the workspace but no master_record_portfolio row →
// status='inProgress' (saga partway through; B6 finalize hasn't run).
func TestGetAdoptionState_InProgress(t *testing.T) {
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	var ws uuid.UUID
	if err := vec.QueryRow(ctx,
		`SELECT id FROM workspaces
		  WHERE subscription_id = $1 AND archived_at IS NULL
		  ORDER BY id LIMIT 1`,
		user.SubscriptionID,
	).Scan(&ws); err != nil {
		t.Skipf("no live workspace for padmin's subscription: %v", err)
	}

	// Clean slate — no master record.
	if _, err := va.Exec(ctx,
		`DELETE FROM master_record_portfolio WHERE workspace_id = $1`,
		ws,
	); err != nil {
		t.Skipf("cannot reset master_record_portfolio: %v", err)
	}

	// Insert a single live scope='strategy' artefact_types row for this
	// workspace. Use a unique prefix to avoid conflicting with the
	// (workspace_id, scope, prefix) WHERE archived_at IS NULL unique.
	suffix := uuid.NewString()[:6]
	prefix := "TI" + suffix[:3]
	typeID := uuid.New()
	if _, err := va.Exec(ctx, `
		INSERT INTO artefact_types
		    (id, subscription_id, workspace_id,
		     scope, source, name, prefix,
		     allows_children, sort_order)
		VALUES ($1, $2, $3, 'strategy', 'tenant', $4, $5, true, 100)`,
		typeID, user.SubscriptionID, ws,
		"InProgressType_"+suffix, prefix,
	); err != nil {
		t.Skipf("cannot insert strategy artefact_type: %v", err)
	}
	defer func() {
		_, _ = va.Exec(ctx,
			`UPDATE artefact_types SET archived_at = now() WHERE id = $1`,
			typeID)
	}()

	h := NewAdoptionStateHandler(vec, va)
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
	if body.Status != statusInProgress {
		t.Errorf("status: want %q, got %q", statusInProgress, body.Status)
	}
	if body.Adopted {
		t.Errorf("adopted: want false, got true")
	}
}

// TestGetAdoptionState_Adopted — master_record_portfolio row exists
// for the workspace → status='adopted' with model_id, adopted_at,
// adopted_by_user_id populated.
func TestGetAdoptionState_Adopted(t *testing.T) {
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	var ws uuid.UUID
	if err := vec.QueryRow(ctx,
		`SELECT id FROM workspaces
		  WHERE subscription_id = $1 AND archived_at IS NULL
		  ORDER BY id LIMIT 1`,
		user.SubscriptionID,
	).Scan(&ws); err != nil {
		t.Skipf("no live workspace for padmin's subscription: %v", err)
	}

	// Capture/restore: don't trample a real adoption row. We DELETE
	// here, run the test against an inserted row, then DELETE again
	// in defer. The saga can re-insert if needed.
	_, _ = va.Exec(ctx,
		`DELETE FROM master_record_portfolio WHERE workspace_id = $1`, ws)
	defer func() {
		_, _ = va.Exec(ctx,
			`DELETE FROM master_record_portfolio WHERE workspace_id = $1`, ws)
	}()

	modelID := uuid.New()
	if _, err := va.Exec(ctx, `
		INSERT INTO master_record_portfolio
		    (workspace_id, model_id, model_name, adopted_by_user_id)
		VALUES ($1, $2, 'AdoptedTestModel', $3)`,
		ws, modelID, user.ID,
	); err != nil {
		t.Skipf("cannot insert master_record_portfolio: %v", err)
	}

	h := NewAdoptionStateHandler(vec, va)
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
	if body.Status != statusAdopted {
		t.Fatalf("status: want %q, got %q", statusAdopted, body.Status)
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
