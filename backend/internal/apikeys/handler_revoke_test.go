package apikeys

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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// PLA060 B16.10.3 — cross-tenant revoke must 404, same-tenant must 204.
// DB-backed because the bug it pins lives in SQL: the missing
// AND admin_api_keys_id_subscription = $2 clause. Skips when the tunnel
// is down (matches the addressables / ranking convention).

func loadDevEnv(t *testing.T) {
	t.Helper()
	for _, rel := range []string{".env.dev", "../../.env.dev", "../../../.env.dev"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
}

func testPoolRevoke(t *testing.T) *pgxpool.Pool {
	t.Helper()
	loadDevEnv(t)
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("cannot ping (tunnel down?): %v", err)
	}
	return pool
}

// testVAPoolRevoke opens a pool against vector_artefacts where audit_logs
// lives (RF1.4.2.audit). Skips on missing env or unreachable tunnel.
func testVAPoolRevoke(t *testing.T) *pgxpool.Pool {
	t.Helper()
	loadDevEnv(t)
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("VA_DB_NAME"))
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vaPool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("cannot ping vaPool: %v", err)
	}
	return pool
}

// seedSubAndKey inserts one synthetic subscription + one active API key,
// returning their UUIDs. Synthetic slug keeps rows isolated; cleanup
// cascades via subscriptions.ON DELETE CASCADE on admin_api_keys.
func seedSubAndKey(t *testing.T, pool *pgxpool.Pool, label string) (subID, keyID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	slug := fmt.Sprintf("_test-pla060-%s-%s", label, uuid.NewString()[:8])
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (subscriptions_name, subscriptions_slug) VALUES ($1, $2) RETURNING subscriptions_id`,
		"PLA060 test "+label, slug,
	).Scan(&subID); err != nil {
		t.Fatalf("seed subscription %s: %v", label, err)
	}
	prefix := "sam_test_" + uuid.NewString()[:8]
	hash := make([]byte, 32)
	copy(hash, uuid.New().NodeID())
	if err := pool.QueryRow(ctx,
		`INSERT INTO admin_api_keys (
		    admin_api_keys_id_subscription,
		    admin_api_keys_prefix,
		    admin_api_keys_hash,
		    admin_api_keys_scopes
		 ) VALUES ($1, $2, $3, '{}')
		 RETURNING admin_api_keys_id`,
		subID, prefix, hash,
	).Scan(&keyID); err != nil {
		t.Fatalf("seed key %s: %v", label, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM subscriptions WHERE subscriptions_id = $1`, subID)
	})
	return subID, keyID
}

func TestRevoke_SameTenant_204(t *testing.T) {
	pool := testPoolRevoke(t)
	defer pool.Close()
	vaPool := testVAPoolRevoke(t)
	defer vaPool.Close()
	svc := New(pool)
	auditLog := audit.New(vaPool)
	h := NewHandler(svc, auditLog)

	subA, keyA := seedSubAndKey(t, pool, "A")

	body, _ := json.Marshal(RevokeRequest{ID: keyA.String()})
	req := httptest.NewRequest("POST", "/admin/api-keys/revoke", strings.NewReader(string(body)))
	ctx := auth.WithUserForTest(req.Context(), &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: subA,
		Email:          "test-a@pla060.local",
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Revoke(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var revokedAt *string
	if err := pool.QueryRow(req.Context(),
		`SELECT admin_api_keys_revoked_at::text FROM admin_api_keys WHERE admin_api_keys_id = $1`,
		keyA,
	).Scan(&revokedAt); err != nil {
		t.Fatalf("post-revoke select: %v", err)
	}
	if revokedAt == nil {
		t.Fatalf("expected admin_api_keys_revoked_at to be set; got NULL")
	}

	// B16.10.4: exactly one audit row, outcome=success.
	var count int
	var outcome string
	if err := vaPool.QueryRow(req.Context(),
		`SELECT count(*), max(audit_logs_metadata->>'outcome')
		 FROM audit_logs
		 WHERE audit_logs_action = 'api_key.revoke'
		   AND audit_logs_resource_id = $1`,
		keyA.String(),
	).Scan(&count, &outcome); err != nil {
		t.Fatalf("audit select (success path): %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 audit row for success revoke; got %d", count)
	}
	if outcome != "success" {
		t.Fatalf("expected audit outcome=success; got %q", outcome)
	}
}

func TestRevoke_CrossTenant_404(t *testing.T) {
	pool := testPoolRevoke(t)
	defer pool.Close()
	vaPool := testVAPoolRevoke(t)
	defer vaPool.Close()
	svc := New(pool)
	auditLog := audit.New(vaPool)
	h := NewHandler(svc, auditLog)

	subA, _ := seedSubAndKey(t, pool, "A")
	_, keyB := seedSubAndKey(t, pool, "B")

	body, _ := json.Marshal(RevokeRequest{ID: keyB.String()})
	req := httptest.NewRequest("POST", "/admin/api-keys/revoke", strings.NewReader(string(body)))
	ctx := auth.WithUserForTest(req.Context(), &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: subA,
		Email:          "test-a@pla060.local",
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Revoke(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
	if strings.Contains(rec.Body.String(), "api key not found") {
		t.Fatalf("response body leaked sentinel err.Error() text: %s", rec.Body.String())
	}

	var revokedAt *string
	if err := pool.QueryRow(req.Context(),
		`SELECT admin_api_keys_revoked_at::text FROM admin_api_keys WHERE admin_api_keys_id = $1`,
		keyB,
	).Scan(&revokedAt); err != nil {
		t.Fatalf("post-failed-revoke select: %v", err)
	}
	if revokedAt != nil {
		t.Fatalf("cross-tenant revoke must NOT mutate target row; revoked_at = %v", *revokedAt)
	}

	// B16.10.4: exactly one audit row, outcome=denied, reason=cross_tenant_or_missing,
	// metadata carries both actor and target subscription ids.
	var count int
	var outcome, reason, targetSub, actorSub string
	if err := vaPool.QueryRow(req.Context(),
		`SELECT
		   count(*),
		   max(audit_logs_metadata->>'outcome'),
		   max(audit_logs_metadata->>'reason'),
		   max(audit_logs_metadata->>'target_subscription_id'),
		   max(audit_logs_metadata->>'actor_subscription_id')
		 FROM audit_logs
		 WHERE audit_logs_action = 'api_key.revoke'
		   AND audit_logs_resource_id = $1`,
		keyB.String(),
	).Scan(&count, &outcome, &reason, &targetSub, &actorSub); err != nil {
		t.Fatalf("audit select (denial path): %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 audit row for denied revoke; got %d", count)
	}
	if outcome != "denied" {
		t.Fatalf("expected audit outcome=denied; got %q", outcome)
	}
	if reason != "cross_tenant_or_missing" {
		t.Fatalf("expected reason=cross_tenant_or_missing; got %q", reason)
	}
	if targetSub == "" || actorSub == "" {
		t.Fatalf("cross-tenant denial must record both subscription IDs; target=%q actor=%q", targetSub, actorSub)
	}
	if targetSub == actorSub {
		t.Fatalf("target and actor subscription ids must differ on cross-tenant denial; both=%s", targetSub)
	}
}
