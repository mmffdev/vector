//go:build integration

package savedviews

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect to the dev DB. Skips if integration deps aren't set.
func connect(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DSN")
	if dsn == "" {
		dsn = "postgres://mmff_dev:68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi@localhost:5435/vector_artefacts?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func TestIntegration_CheckConstraintRejectsBadScope(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	// Try to INSERT with scope='user' but id_user NULL — must fail CHECK.
	_, err := pool.Exec(ctx, `
		INSERT INTO saved_views (
			saved_views_id_subscription, saved_views_kind, saved_views_scope,
			saved_views_target, saved_views_name, saved_views_id_user_created_by
		) VALUES ($1, 'objecttree', 'user', 'objecttree:test', 'bad', $1)`,
		uuid.New(),
	)
	if err == nil {
		t.Fatalf("expected CHECK violation, got nil")
	}
}

func TestIntegration_BodySizeCapEnforced(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	store := NewPostgresViewStore(pool)
	subID, userID := uuid.New(), uuid.New()
	// Build 65537-byte JSON string body.
	big := make([]byte, 65537)
	for i := range big {
		big[i] = 'x'
	}
	body := json.RawMessage(append(append([]byte(`"`), big...), '"'))
	uid := userID
	_, err := store.Insert(ctx, CreateInput{
		SubscriptionID: subID, Kind: "objecttree", Scope: "user",
		UserID: &uid, Target: "objecttree:test", Name: "big",
		Body: body, ActorUserID: userID,
	})
	if err == nil {
		t.Fatalf("expected size-cap violation, got nil")
	}
}

func TestIntegration_RoundTripUserScope(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	store := NewPostgresViewStore(pool)

	// Use real user + subscription from dev seed.
	// rick@mmffdev.com user UUID is deterministic in dev seed.
	var subID, userID uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT users_id_subscription, users_id
		FROM users
		WHERE users_email = 'rick@mmffdev.com'
		LIMIT 1`).Scan(&subID, &userID); err != nil {
		t.Skipf("dev seed not present (rick@mmffdev.com): %v", err)
	}

	uid := userID
	created, err := store.Insert(ctx, CreateInput{
		SubscriptionID: subID, Kind: "objecttree", Scope: "user",
		UserID: &uid, Target: "objecttree:test:integration", Name: "RT Test",
		Body:        json.RawMessage(`{"visible_columns":["id","title"]}`),
		ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM saved_views WHERE saved_views_id = $1", created.ID)
	})

	got, err := store.GetByID(ctx, subID, created.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != "RT Test" || got.Scope != "user" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}
