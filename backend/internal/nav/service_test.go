package nav

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/models"
)

// Integration tests hit the real Postgres via the SSH tunnel on :5434.
// Per repo convention, we do not mock the DB.
//
// Each test creates its own tenant + user, exercises the service, and
// leaves rows behind for incidental inspection; ON DELETE CASCADE on
// user_nav_prefs + users means dropping the test user wipes all prefs.
// We explicitly delete the test tenant at the end to keep the remote
// DB tidy.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	// Walk up from this test file to backend/.env.local
	// (tests run with CWD = package dir)
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

// newSvc builds a Service with a primed registry for tests.
func newSvc(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	reg := NewCachedRegistry(pool, 60*time.Second)
	if _, err := reg.Load(context.Background()); err != nil {
		t.Fatalf("registry load: %v", err)
	}
	return New(pool, reg)
}

// mkFixtures creates a throwaway tenant + user, returns their IDs and a
// cleanup func. Placeholder password hash is a valid bcrypt string for
// "test" — meaningless, we never log this user in.
func mkFixtures(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()

	suffix := uuid.NewString()[:8]
	var subscriptionID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"nav-test-"+suffix, "nav-test-"+suffix).Scan(&subscriptionID)
	if err != nil {
		t.Fatalf("insert tenant: %v", err)
	}

	var userID uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO users (subscription_id, email, password_hash, role)
		VALUES ($1, $2, $3, 'user') RETURNING id`,
		subscriptionID, "nav-test-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd").Scan(&userID)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cleanup := func() {
		// ON DELETE CASCADE on users.subscription_id is RESTRICT, so we delete
		// user first, then tenant. user_nav_prefs cascades from users.
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
			t.Logf("cleanup user: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, subscriptionID); err != nil {
			t.Logf("cleanup tenant: %v", err)
		}
	}
	return subscriptionID, userID, cleanup
}

func TestReplacePrefs_HappyPath(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// dashboard + my-vista share tag 'personal'; portfolio is 'planning'.
	// Order the pinned list so same-tag items stay contiguous.
	startKey := "my-vista"
	err := svc.ReplacePrefs(ctx, userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "my-vista", Position: 1},
		{ItemKey: "portfolio", Position: 2},
	}, &startKey, nil, nil)
	if err != nil {
		t.Fatalf("ReplacePrefs: %v", err)
	}

	rows, err := svc.GetPrefs(ctx, userID, subscriptionID, models.RoleUser)
	if err != nil {
		t.Fatalf("GetPrefs: %v", err)
	}
	// GetPrefs opportunistically backfills default-pinned system pages
	// for the caller's role; assert the explicitly pinned three are present
	// at positions 0..2, not the total row count.
	if len(rows) < 3 {
		t.Fatalf("want at least 3 rows, got %d", len(rows))
	}
	if rows[0].ItemKey != "dashboard" || rows[0].Position != 0 {
		t.Errorf("row 0 mismatch: %+v", rows[0])
	}
	if rows[1].ItemKey != "my-vista" || !rows[1].IsStartPage {
		t.Errorf("row 1 should be start page: %+v", rows[1])
	}

	href, ok, err := svc.GetStartPageHref(ctx, userID, subscriptionID, models.RoleUser)
	if err != nil || !ok {
		t.Fatalf("start page lookup: ok=%v err=%v", ok, err)
	}
	if href != "/my-vista" {
		t.Errorf("want href /my-vista, got %s", href)
	}
}

func TestReplacePrefs_RejectsDevSetup(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dev", Position: 0},
	}, nil, nil, nil)
	if !errors.Is(err, ErrNotPinnable) {
		t.Fatalf("want ErrNotPinnable, got %v", err)
	}
}

func TestReplacePrefs_RejectsUnknownKey(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "does-not-exist", Position: 0},
	}, nil, nil, nil)
	if !errors.Is(err, ErrUnknownItemKey) {
		t.Fatalf("want ErrUnknownItemKey, got %v", err)
	}
}

func TestReplacePrefs_RejectsStartPageNotInPinned(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	startKey := "planning"
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
	}, &startKey, nil, nil)
	if !errors.Is(err, ErrStartPageNotPinned) {
		t.Fatalf("want ErrStartPageNotPinned, got %v", err)
	}
}

func TestReplacePrefs_RejectsNonContiguousPositions(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "my-vista", Position: 2},
	}, nil, nil, nil)
	if !errors.Is(err, ErrBadPositions) {
		t.Fatalf("want ErrBadPositions, got %v", err)
	}
}

func TestReplacePrefs_RejectsDuplicateKey(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "dashboard", Position: 1},
	}, nil, nil, nil)
	if !errors.Is(err, ErrDuplicateKey) {
		t.Fatalf("want ErrDuplicateKey, got %v", err)
	}
}

func TestReplacePrefs_RejectsNonContiguousGroups(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	// dashboard(personal), backlog(planning), my-vista(personal) —
	// the 'personal' tag is split by a 'planning' item in the middle.
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "backlog", Position: 1},
		{ItemKey: "my-vista", Position: 2},
	}, nil, nil, nil)
	if !errors.Is(err, ErrBadGrouping) {
		t.Fatalf("want ErrBadGrouping, got %v", err)
	}
}

func TestReplacePrefs_ReplaceOverwritesPrevious(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// First write: 3 items — dashboard+my-vista (personal), portfolio (planning).
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "my-vista", Position: 1},
		{ItemKey: "portfolio", Position: 2},
	}, nil, nil, nil); err != nil {
		t.Fatalf("first write: %v", err)
	}

	// Second write: 2 items, both 'planning' tag.
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "backlog", Position: 0},
		{ItemKey: "planning", Position: 1},
	}, nil, nil, nil); err != nil {
		t.Fatalf("second write: %v", err)
	}

	rows, _ := svc.GetPrefs(ctx, userID, subscriptionID, models.RoleUser)
	// Backfill may add additional default-pinned rows; assert the two
	// explicitly-set rows lead the list in the order ReplacePrefs placed them.
	if len(rows) < 2 {
		t.Fatalf("want at least 2 rows after overwrite, got %d", len(rows))
	}
	if rows[0].ItemKey != "backlog" || rows[1].ItemKey != "planning" {
		t.Errorf("unexpected leading rows: %+v", rows)
	}
}

func TestDeletePrefs_WipesRows(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	_ = svc.ReplacePrefs(ctx, userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
	}, nil, nil, nil)

	if err := svc.DeletePrefs(ctx, userID, subscriptionID); err != nil {
		t.Fatalf("DeletePrefs: %v", err)
	}
	// After DeletePrefs the prefs row is gone; the next GetPrefs will
	// repopulate every default_pinned=TRUE page allowed for the role.
	// That's the documented behavior — assert the originally-pinned key
	// is back rather than asserting zero rows.
	rows, _ := svc.GetPrefs(ctx, userID, subscriptionID, models.RoleUser)
	found := false
	for _, r := range rows {
		if r.ItemKey == "dashboard" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("dashboard should be re-pinned by backfill after DeletePrefs, got rows: %+v", rows)
	}
}

func TestGetStartPageHref_NoneSet(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	_, ok, err := svc.GetStartPageHref(context.Background(), userID, subscriptionID, models.RoleUser)
	if err != nil {
		t.Fatalf("GetStartPageHref: %v", err)
	}
	if ok {
		t.Fatal("want ok=false when no start page set")
	}
}

func TestReplacePrefs_RejectsItemForbiddenForRole(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	// workspace-settings is gadmin-only; a 'user' role must not pin it.
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, []PinnedInput{
		{ItemKey: "workspace-settings", Position: 0},
	}, nil, nil, nil)
	if !errors.Is(err, ErrRoleForbidden) {
		t.Fatalf("want ErrRoleForbidden, got %v", err)
	}
}

func TestReplacePrefs_RejectsTooManyPinned(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	pinned := make([]PinnedInput, MaxPinned+1)
	for i := range pinned {
		pinned[i] = PinnedInput{ItemKey: "dashboard", Position: i}
	}
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, models.RoleUser, pinned, nil, nil, nil)
	if !errors.Is(err, ErrTooManyPinned) {
		t.Fatalf("want ErrTooManyPinned, got %v", err)
	}
}

func TestGetStartPageHref_FallsBackWhenRoleLosesAccess(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// Seed as gadmin with workspace-settings as start page.
	startKey := "workspace-settings"
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, models.RoleGAdmin, []PinnedInput{
		{ItemKey: "workspace-settings", Position: 0},
	}, &startKey, nil, nil); err != nil {
		t.Fatalf("seed as gadmin: %v", err)
	}

	// Now query as a 'user' (role demoted) — must silently fall back.
	_, ok, err := svc.GetStartPageHref(ctx, userID, subscriptionID, models.RoleUser)
	if err != nil {
		t.Fatalf("GetStartPageHref: %v", err)
	}
	if ok {
		t.Fatal("want ok=false when role no longer permits stored start page")
	}
}

func TestCatalogFor_RoleFiltering(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	svc := newSvc(t, pool)

	reg, err := svc.Registry.Get(context.Background())
	if err != nil {
		t.Fatalf("registry get: %v", err)
	}

	userEntries := reg.CatalogFor("user", uuid.Nil)
	for _, e := range userEntries {
		if e.Key == "workspace-settings" {
			t.Fatal("user role should not see workspace-settings entry")
		}
	}
	gadminEntries := reg.CatalogFor("gadmin", uuid.Nil)
	foundWS := false
	for _, e := range gadminEntries {
		if e.Key == "workspace-settings" {
			foundWS = true
		}
	}
	if !foundWS {
		t.Fatal("gadmin should see workspace-settings entry")
	}
}
