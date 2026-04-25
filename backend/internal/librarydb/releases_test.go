package librarydb

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Releases tests cover the cross-DB list/ack workflow against the live
// dev cluster. Skip on unreachable — same discipline as fetch_test.go
// and grants_test.go. The seed at db/library_schema/seed/002_test_release.sql
// supplies a single info-severity release; tests use that fixed UUID.
const (
	seededReleaseID = "00000000-0000-0000-0000-00000000ad01"
	// seededAuditUserID — first padmin/gadmin in the dev seed; used as the
	// acknowledged_by_user_id. We rely on whatever user the dev seed put
	// at this slot. If the seed changes we'll fail loudly on FK insert.
)

func TestFindRelease_NotFound(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()
	_, err := FindRelease(context.Background(), pool, uuid.MustParse("00000000-0000-0000-0000-0000deadbeef"))
	if !errors.Is(err, ErrReleaseNotFound) {
		t.Errorf("want ErrReleaseNotFound, got %v", err)
	}
}

func TestFindRelease_Seeded(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	id := uuid.MustParse(seededReleaseID)
	r, err := FindRelease(context.Background(), pool, id)
	if err != nil {
		t.Fatalf("FindRelease: %v", err)
	}
	if r.Severity != SeverityInfo {
		t.Errorf("severity: want %q, got %q", SeverityInfo, r.Severity)
	}
	if r.LibraryVersion != "2026.04.0" {
		t.Errorf("library_version: want 2026.04.0, got %q", r.LibraryVersion)
	}
	// The seed inserts one action ("dismissed").
	if len(r.Actions) < 1 {
		t.Errorf("actions: want >=1, got %d", len(r.Actions))
	}
}

func TestIsValidAction(t *testing.T) {
	for _, ok := range []string{
		ActionUpgradeModel, ActionReviewTerminology, ActionEnableFlag, ActionDismissed,
	} {
		if !IsValidAction(ok) {
			t.Errorf("IsValidAction(%q) = false; want true", ok)
		}
	}
	for _, bad := range []string{"", "delete", "approve", "ignore"} {
		if IsValidAction(bad) {
			t.Errorf("IsValidAction(%q) = true; want false", bad)
		}
	}
}

func TestAckRelease_InvalidAction(t *testing.T) {
	// No DB needed — guard runs before SQL.
	_, err := AckRelease(context.Background(), nil,
		uuid.New(), uuid.New(), uuid.New(), "approve")
	if !errors.Is(err, ErrInvalidAction) {
		t.Errorf("want ErrInvalidAction, got %v", err)
	}
}

// TestListReleasesSinceAck exercises the full cross-DB path: the
// seeded release should appear when no ack exists, and disappear after
// AckRelease writes the row. Cleanup deletes the ack so re-runs work.
func TestListReleasesSinceAck(t *testing.T) {
	libPool := testLibraryRoPool(t)
	defer libPool.Close()
	vecPool, subID, userID, tier := testVectorPoolAndSeed(t)
	defer vecPool.Close()

	releaseID := uuid.MustParse(seededReleaseID)
	ctx := context.Background()

	// Reset any prior ack so the test starts in a known state.
	_, _ = vecPool.Exec(ctx,
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		subID, releaseID)

	// Pre-ack: seeded release must be in the outstanding list.
	rels, err := ListReleasesSinceAck(ctx, libPool, vecPool, subID, tier)
	if err != nil {
		t.Fatalf("ListReleasesSinceAck pre: %v", err)
	}
	if !containsRelease(rels, releaseID) {
		t.Fatalf("pre-ack list missing seeded release %s; got %v", releaseID, releaseIDs(rels))
	}

	// Ack it. Should report Created=true.
	created, err := AckRelease(ctx, vecPool, subID, releaseID, userID, ActionDismissed)
	if err != nil {
		t.Fatalf("AckRelease: %v", err)
	}
	if !created {
		t.Errorf("AckRelease created=false on first call")
	}

	// Re-ack: idempotent, Created=false.
	created2, err := AckRelease(ctx, vecPool, subID, releaseID, userID, ActionDismissed)
	if err != nil {
		t.Fatalf("AckRelease 2: %v", err)
	}
	if created2 {
		t.Errorf("AckRelease created=true on duplicate")
	}

	// Post-ack: seeded release must NOT appear in outstanding list.
	rels2, err := ListReleasesSinceAck(ctx, libPool, vecPool, subID, tier)
	if err != nil {
		t.Fatalf("ListReleasesSinceAck post: %v", err)
	}
	if containsRelease(rels2, releaseID) {
		t.Errorf("post-ack list still contains seeded release %s", releaseID)
	}

	// Cleanup so re-runs start fresh.
	_, _ = vecPool.Exec(ctx,
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		subID, releaseID)
}

func TestCountOutstanding(t *testing.T) {
	libPool := testLibraryRoPool(t)
	defer libPool.Close()
	vecPool, subID, userID, tier := testVectorPoolAndSeed(t)
	defer vecPool.Close()

	releaseID := uuid.MustParse(seededReleaseID)
	ctx := context.Background()
	_, _ = vecPool.Exec(ctx,
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		subID, releaseID)

	pre, err := CountOutstandingForSubscription(ctx, libPool, vecPool, subID, tier)
	if err != nil {
		t.Fatalf("Count pre: %v", err)
	}
	if pre < 1 {
		t.Errorf("Count pre: want >=1, got %d", pre)
	}

	if _, err := AckRelease(ctx, vecPool, subID, releaseID, userID, ActionDismissed); err != nil {
		t.Fatalf("AckRelease: %v", err)
	}

	post, err := CountOutstandingForSubscription(ctx, libPool, vecPool, subID, tier)
	if err != nil {
		t.Fatalf("Count post: %v", err)
	}
	if post != pre-1 {
		t.Errorf("Count post: want %d, got %d", pre-1, post)
	}

	_, _ = vecPool.Exec(ctx,
		`DELETE FROM library_acknowledgements WHERE subscription_id = $1 AND release_id = $2`,
		subID, releaseID)
}

func containsRelease(rels []Release, id uuid.UUID) bool {
	for _, r := range rels {
		if r.ID == id {
			return true
		}
	}
	return false
}

func releaseIDs(rels []Release) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(rels))
	for _, r := range rels {
		out = append(out, r.ID)
	}
	return out
}

// testVectorPoolAndSeed opens a pool against mmff_vector as the dev
// user and resolves a (subscription, user, tier) triple suitable for
// writing acks. Skips when unreachable.
func testVectorPoolAndSeed(t *testing.T) (*pgxpool.Pool, uuid.UUID, uuid.UUID, string) {
	t.Helper()

	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	host := envOrDefault("DB_HOST", "localhost")
	port := envOrDefault("DB_PORT", "5434")
	dbname := envOrDefault("DB_NAME", "mmff_vector")
	user := envOrDefault("DB_USER", "mmff_dev")
	pwd := os.Getenv("DB_PASSWORD")

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=librarydb_releases_test",
		host, port, user, pwd, dbname,
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector: %v", err)
	}

	// Pick the first gadmin-owned subscription (any seeded subscription
	// works for the test). If the seed has no gadmin, fall back to any
	// active subscription + any active user.
	var subID, userID uuid.UUID
	var tier string
	err = pool.QueryRow(context.Background(), `
		SELECT u.subscription_id, u.id, s.tier
		FROM users u JOIN subscriptions s ON s.id = u.subscription_id
		WHERE u.is_active = TRUE AND u.role = 'gadmin'
		ORDER BY u.created_at
		LIMIT 1`).Scan(&subID, &userID, &tier)
	if err != nil {
		pool.Close()
		t.Skipf("no gadmin user available for ack test: %v", err)
	}
	return pool, subID, userID, tier
}
