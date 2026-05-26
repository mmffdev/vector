package apikeys

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// PLA060 B16.11.3 — Middleware must stash scopes on ctx so RequireScope
// can read them downstream. Integration-shape: seeds a real key with
// non-empty scopes via the service, runs the middleware, asserts the
// scopes survive on the inner handler's request context.

func testPoolForMiddleware(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.dev", "../../.env.dev", "../../../.env.dev"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("cannot ping: %v", err)
	}
	return pool
}

func TestMiddleware_StashesScopesOnContext(t *testing.T) {
	pool := testPoolForMiddleware(t)
	defer pool.Close()
	svc := New(pool)
	ctx := context.Background()

	// Seed a subscription and a key with explicit scopes.
	slug := "_test-pla060-mw-" + uuid.NewString()[:8]
	var subID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (subscriptions_name, subscriptions_slug) VALUES ($1, $2) RETURNING subscriptions_id`,
		"PLA060 middleware test", slug,
	).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM subscriptions WHERE subscriptions_id = $1`, subID)
	})

	want := []string{ScopeWorkItemsRead, ScopePortfolioItemsWrite}
	key, err := svc.Issue(ctx, subID.String(), nil, want)
	if err != nil {
		t.Fatalf("issue key: %v", err)
	}

	// Capture the request context inside an inner handler.
	var got []string
	var ok bool
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, ok = ScopesFromContext(r.Context())
	})
	h := Middleware(svc, nil)(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+key.RawKey)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !ok {
		t.Fatalf("middleware did not call WithScopes — ScopesFromContext returned !ok")
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("scopes on ctx = %v, want %v", got, want)
	}
}

func TestMiddleware_EmptyScopesAttachedAsZeroLengthSlice(t *testing.T) {
	pool := testPoolForMiddleware(t)
	defer pool.Close()
	svc := New(pool)
	ctx := context.Background()

	slug := "_test-pla060-mw-empty-" + uuid.NewString()[:8]
	var subID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (subscriptions_name, subscriptions_slug) VALUES ($1, $2) RETURNING subscriptions_id`,
		"PLA060 middleware test empty", slug,
	).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM subscriptions WHERE subscriptions_id = $1`, subID)
	})

	// Issue with explicitly empty scopes (back-compat path).
	key, err := svc.Issue(ctx, subID.String(), nil, nil)
	if err != nil {
		t.Fatalf("issue key: %v", err)
	}

	var got []string
	var ok bool
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, ok = ScopesFromContext(r.Context())
	})
	h := Middleware(svc, nil)(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+key.RawKey)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !ok {
		t.Fatalf("expected ok=true even for empty-scopes key (distinguishes 'no auth' from 'empty grants')")
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("expected non-nil zero-length slice; got %v", got)
	}
}
