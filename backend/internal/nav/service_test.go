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

	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// Integration tests hit the real Postgres via the SSH tunnel on :5434.
// Per repo convention, we do not mock the DB.
//
// Each test creates its own tenant + user, exercises the service, and
// leaves rows behind for incidental inspection; ON DELETE CASCADE on
// users_nav_prefs + users means dropping the test user wipes all prefs.
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

// mkFixtures creates a throwaway tenant + user, returns their IDs +
// the user's grp_* role UUID + a cleanup func. Placeholder password
// hash is a valid bcrypt string for "test" — meaningless, we never log
// this user in.
//
// Refreshed 2026-05-16 (TD-TEST-002): users.role_id is NOT NULL post-
// mig-088 so the row needs a real grp_* UUID. The legacy enum 'user'
// maps to grp_team_member per the mig 196 coarse-fallback.
func mkFixtures(t *testing.T, pool *pgxpool.Pool) (subscriptionID, userID, roleID uuid.UUID, cleanup func()) {
	t.Helper()
	ctx := context.Background()

	if err := pool.QueryRow(ctx,
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = 'grp_team_member' AND users_roles_id_subscription IS NULL`,
	).Scan(&roleID); err != nil {
		t.Fatalf("resolve grp_team_member users_roles_id: %v", err)
	}

	suffix := uuid.NewString()[:8]
	if err := pool.QueryRow(ctx, `
		INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"nav-test-"+suffix, "nav-test-"+suffix).Scan(&subscriptionID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
		subscriptionID, "nav-test-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		roleID,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cleanup = func() {
		// ON DELETE CASCADE on users.subscription_id is RESTRICT, so we delete
		// user first, then tenant. users_nav_prefs cascades from users.
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
			t.Logf("cleanup user: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, subscriptionID); err != nil {
			t.Logf("cleanup tenant: %v", err)
		}
	}
	return subscriptionID, userID, roleID, cleanup
}

func TestReplacePrefs_HappyPath(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// dashboard + my-vista share tag 'personal'; portfolio is 'planning'.
	// Order the pinned list so same-tag items stay contiguous.
	startKey := "my-vista"
	err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "my-vista", Position: 1},
		{ItemKey: "portfolio", Position: 2},
	}, &startKey, nil, nil)
	if err != nil {
		t.Fatalf("ReplacePrefs: %v", err)
	}

	rows, err := svc.GetPrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID)
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

	href, ok, err := svc.GetStartPageHref(ctx, userID, subscriptionID, roletypes.RoleUser, roleID)
	if err != nil || !ok {
		t.Fatalf("start page lookup: ok=%v err=%v", ok, err)
	}
	if href != "/my-vista" {
		t.Errorf("want href /my-vista, got %s", href)
	}
}


func TestReplacePrefs_RejectsUnknownKey(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "does-not-exist", Position: 0},
	}, nil, nil, nil)
	if !errors.Is(err, ErrUnknownItemKey) {
		t.Fatalf("want ErrUnknownItemKey, got %v", err)
	}
}

func TestReplacePrefs_RejectsStartPageNotInPinned(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	startKey := "planning"
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
	}, &startKey, nil, nil)
	if !errors.Is(err, ErrStartPageNotPinned) {
		t.Fatalf("want ErrStartPageNotPinned, got %v", err)
	}
}

func TestReplacePrefs_RejectsNonContiguousPositions(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
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
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
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
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	// dashboard(personal), backlog(planning), my-vista(personal) —
	// the 'personal' tag is split by a 'planning' item in the middle.
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
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
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// First write: 3 items — dashboard+my-vista (personal), portfolio (planning).
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
		{ItemKey: "my-vista", Position: 1},
		{ItemKey: "portfolio", Position: 2},
	}, nil, nil, nil); err != nil {
		t.Fatalf("first write: %v", err)
	}

	// Second write: 2 items, both 'planning' tag.
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "backlog", Position: 0},
		{ItemKey: "planning", Position: 1},
	}, nil, nil, nil); err != nil {
		t.Fatalf("second write: %v", err)
	}

	rows, _ := svc.GetPrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID)
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
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	_ = svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
	}, nil, nil, nil)

	if err := svc.DeletePrefs(ctx, userID, subscriptionID); err != nil {
		t.Fatalf("DeletePrefs: %v", err)
	}
	// After DeletePrefs the prefs row is gone; the next GetPrefs will
	// repopulate every default_pinned=TRUE page allowed for the role.
	// That's the documented behavior — assert the originally-pinned key
	// is back rather than asserting zero rows.
	rows, _ := svc.GetPrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID)
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
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	_, ok, err := svc.GetStartPageHref(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID)
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
	subscriptionID, userID, _, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// PLA-0053 refresh: previous version relied on grp_team_member having
	// no dev-security-audits grant. The current seed grants every system
	// role every dev page, so this test now uses an isolated tenant-custom
	// role with zero grants — any pin attempt must hit ErrRoleForbidden.
	var isolatedRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, 'no-grants-role', 'No Grants', 'forbidden-pin test', 5, FALSE, FALSE)
		RETURNING users_roles_id
	`, subscriptionID).Scan(&isolatedRoleID); err != nil {
		t.Fatalf("seed isolated role: %v", err)
	}
	// Point the test user at the isolated role so ReplacePrefs sees a
	// role with no page grants at all.
	if _, err := pool.Exec(ctx, `UPDATE users SET role_id = $1 WHERE id = $2`, isolatedRoleID, userID); err != nil {
		t.Fatalf("repoint user role: %v", err)
	}

	err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, isolatedRoleID, []PinnedInput{
		{ItemKey: "dev-security-audits", Position: 0},
	}, nil, nil, nil)
	if !errors.Is(err, ErrRoleForbidden) {
		t.Fatalf("want ErrRoleForbidden, got %v", err)
	}
}

func TestReplacePrefs_RejectsTooManyPinned(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	pinned := make([]PinnedInput, MaxPinned+1)
	for i := range pinned {
		pinned[i] = PinnedInput{ItemKey: "dashboard", Position: i}
	}
	err := svc.ReplacePrefs(context.Background(), userID, subscriptionID, roletypes.RoleUser, roleID, pinned, nil, nil, nil)
	if !errors.Is(err, ErrTooManyPinned) {
		t.Fatalf("want ErrTooManyPinned, got %v", err)
	}
}

func TestGetStartPageHref_FallsBackWhenRoleLosesAccess(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, _, cleanup := mkFixtures(t, pool)
	defer cleanup()

	svc := newSvc(t, pool)
	ctx := context.Background()

	// Seed as gadmin with dev-security-audits as start.
	var grpGlobalID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = 'grp_global' AND users_roles_id_subscription IS NULL`,
	).Scan(&grpGlobalID); err != nil {
		t.Fatalf("resolve grp_global: %v", err)
	}
	startKey := "dev-security-audits"
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleGAdmin, grpGlobalID, []PinnedInput{
		{ItemKey: "dev-security-audits", Position: 0},
	}, &startKey, nil, nil); err != nil {
		t.Fatalf("seed as gadmin: %v", err)
	}

	// PLA-0053 refresh: switch the user to an isolated tenant role with
	// no grants (previously this test relied on grp_team_member not having
	// dev-security-audits access — now seeded grants make that false).
	var isolatedRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, 'no-grants-fallback', 'No Grants Fallback', 'role-loses-access test', 5, FALSE, FALSE)
		RETURNING users_roles_id
	`, subscriptionID).Scan(&isolatedRoleID); err != nil {
		t.Fatalf("seed isolated role: %v", err)
	}

	// Now query under the isolated role — must silently fall back since
	// the stored start_page_key references a page the new role cannot reach.
	_, ok, err := svc.GetStartPageHref(ctx, userID, subscriptionID, roletypes.RoleUser, isolatedRoleID)
	if err != nil {
		t.Fatalf("GetStartPageHref: %v", err)
	}
	if ok {
		t.Fatal("want ok=false when role no longer permits stored start page")
	}
}

// TestCatalogFor_RoleFiltering — PLA-0053 (B5.12) refresh: previously
// this test asserted hard-coded "grp_team_member can't see dev pages"
// based on the implicit tier gate. After PLA-0053 the tier gate is gone
// and seed grants are authoritative — and the current seed grants every
// system role access to every dev page (a separate issue surfaced by
// B5.15's audit script). To pin role-grant filtering without depending on
// fragile seed state, this test creates an isolated tenant-custom role
// with no page grants, then exercises CatalogFor against it.
func TestCatalogFor_RoleFiltering(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	svc := newSvc(t, pool)

	ctx := context.Background()
	reg, err := svc.Registry.Get(ctx)
	if err != nil {
		t.Fatalf("registry get: %v", err)
	}

	// Create an isolated tenant-custom role with zero page grants. The
	// subscription scope keeps the row out of the system-role pool and
	// out of the way of any seeded grants for system roles.
	tenantID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscriptions (id, name, slug, is_active)
		VALUES ($1, 'nav-test-tenant', $2, true)
	`, tenantID, fmt.Sprintf("nav-test-%s", tenantID.String()[:8])); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	defer pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, tenantID)

	var isolatedRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, 'isolated-test-role', 'Isolated Test Role', 'no grants', 5, FALSE, FALSE)
		RETURNING users_roles_id
	`, tenantID).Scan(&isolatedRoleID); err != nil {
		t.Fatalf("seed isolated role: %v", err)
	}

	// With no grants, the catalogue must be empty.
	entries := reg.CatalogFor(isolatedRoleID, uuid.Nil)
	if len(entries) != 0 {
		var keys []string
		for _, e := range entries {
			keys = append(keys, e.Key)
		}
		t.Fatalf("isolated role with no grants must see zero catalogue entries (got %v)", keys)
	}

	// grp_global is seeded with comprehensive grants; sanity-check we
	// still see at least one admin-tag page (proves the role filter
	// admits, not just denies).
	var grpGlobalID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = 'grp_global' AND users_roles_id_subscription IS NULL`,
	).Scan(&grpGlobalID); err != nil {
		t.Fatalf("resolve grp_global: %v", err)
	}
	gadminEntries := reg.CatalogFor(grpGlobalID, uuid.Nil)
	foundGadminOnly := false
	for _, e := range gadminEntries {
		if e.Key == "dev-security-audits" {
			foundGadminOnly = true
		}
	}
	if !foundGadminOnly {
		t.Fatal("grp_global should see dev-security-audits entry")
	}
}

// TestTagsFor_PageGrantDerived — PLA-0053 (B5.12): server-side authoritative
// gate for the nav rail's tag buckets. The previous tier filter (rank →
// auth_level vs. min_auth_level) is gone; tag visibility is now derived
// from page-grant fan-out — a tag is emitted iff the caller has at least
// one page granted under it via users_roles_pages.
//
// Procurement / SOC2 narrative: a tampered client cannot re-introduce
// admin tags it has zero granted pages for. The server never emits those
// tag enums; enumerating admin surfaces is impossible without a grant.
//
// Uses an isolated tenant-custom role rather than system roles so the
// seeded grant state of grp_team_member / grp_global doesn't drift the
// assertions over time. The isolated role starts with zero grants and
// the test grants exactly one page to it; only that tag must surface.
func TestTagsFor_PageGrantDerived(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	svc := newSvc(t, pool)

	ctx := context.Background()

	tenantID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscriptions (id, name, slug, is_active)
		VALUES ($1, 'tagsfor-test-tenant', $2, true)
	`, tenantID, fmt.Sprintf("tagsfor-test-%s", tenantID.String()[:8])); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	defer pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, tenantID)

	var isolatedRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, 'tagsfor-isolated', 'TagsFor Isolated', 'one-grant test role', 5, FALSE, FALSE)
		RETURNING users_roles_id
	`, tenantID).Scan(&isolatedRoleID); err != nil {
		t.Fatalf("seed isolated role: %v", err)
	}

	enums := func(tags []TagGroup) map[string]bool {
		m := make(map[string]bool, len(tags))
		for _, t := range tags {
			m[t.Enum] = true
		}
		return m
	}

	t.Run("no grants → empty tag list", func(t *testing.T) {
		// Refresh the registry so the new role is in the rank map.
		if _, err := svc.Registry.Load(ctx); err != nil {
			t.Fatalf("registry load: %v", err)
		}
		reg, _ := svc.Registry.Get(ctx)
		got := enums(reg.TagsFor(isolatedRoleID, uuid.Nil))
		if len(got) != 0 {
			t.Errorf("isolated role with zero grants must see no tags (got %v)", got)
		}
	})

	t.Run("one grant under personal → only personal tag appears", func(t *testing.T) {
		// Grant the role exactly one page (dashboard, under 'personal').
		if _, err := pool.Exec(ctx, `
			INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
			SELECT id, $1 FROM pages WHERE key_enum = 'dashboard' AND created_by IS NULL AND subscription_id IS NULL
		`, isolatedRoleID); err != nil {
			t.Fatalf("grant dashboard: %v", err)
		}
		if _, err := svc.Registry.Load(ctx); err != nil {
			t.Fatalf("registry load: %v", err)
		}
		reg, _ := svc.Registry.Get(ctx)
		got := enums(reg.TagsFor(isolatedRoleID, uuid.Nil))
		if !got["personal"] {
			t.Errorf("expected 'personal' tag visible (have %v)", got)
		}
		for _, banned := range []string{"vector_admin", "user_management", "workspace_admin", "dev_tools", "planning"} {
			if got[banned] {
				t.Errorf("tag %q must not appear — no grants under it (have %v)", banned, got)
			}
		}
	})

	t.Run("unknown roleID sees nothing", func(t *testing.T) {
		reg, _ := svc.Registry.Get(ctx)
		got := enums(reg.TagsFor(uuid.New(), uuid.Nil))
		if len(got) != 0 {
			t.Errorf("unknown role must not see any tags (got %v)", got)
		}
	})
}

// TestCatalogFor_PageGrantIsSoleGate — PLA-0053 (B5.12): the catalogue
// gate is now exclusively users_roles_pages. A role with one grant must
// see exactly that page; revoking the grant must remove it. No silent
// tier override exists.
func TestCatalogFor_PageGrantIsSoleGate(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	svc := newSvc(t, pool)

	ctx := context.Background()

	tenantID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscriptions (id, name, slug, is_active)
		VALUES ($1, 'sole-gate-tenant', $2, true)
	`, tenantID, fmt.Sprintf("sole-gate-%s", tenantID.String()[:8])); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	defer pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, tenantID)

	var roleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, 'sole-gate-role', 'Sole Gate Role', 'grant/revoke test', 5, FALSE, FALSE)
		RETURNING users_roles_id
	`, tenantID).Scan(&roleID); err != nil {
		t.Fatalf("seed role: %v", err)
	}

	// Step 1 — no grants, empty catalogue.
	if _, err := svc.Registry.Load(ctx); err != nil {
		t.Fatalf("registry load 1: %v", err)
	}
	reg, _ := svc.Registry.Get(ctx)
	if entries := reg.CatalogFor(roleID, uuid.Nil); len(entries) != 0 {
		t.Errorf("step 1: expected empty catalogue, got %d entries", len(entries))
	}

	// Step 2 — grant dev-security-audits (an admin-tag page). It must appear.
	if _, err := pool.Exec(ctx, `
		INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
		SELECT id, $1 FROM pages WHERE key_enum = 'dev-security-audits' AND created_by IS NULL AND subscription_id IS NULL
	`, roleID); err != nil {
		t.Fatalf("grant dev-security-audits: %v", err)
	}
	if _, err := svc.Registry.Load(ctx); err != nil {
		t.Fatalf("registry load 2: %v", err)
	}
	reg, _ = svc.Registry.Get(ctx)
	entries := reg.CatalogFor(roleID, uuid.Nil)
	foundSA := false
	for _, e := range entries {
		if e.Key == "dev-security-audits" {
			foundSA = true
		}
	}
	if !foundSA {
		t.Error("step 2: after granting dev-security-audits the page must appear in catalogue (no tier override)")
	}

	// Step 3 — revoke. The page must disappear.
	if _, err := pool.Exec(ctx, `
		DELETE FROM users_roles_pages WHERE users_roles_pages_id_role = $1
	`, roleID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.Registry.Load(ctx); err != nil {
		t.Fatalf("registry load 3: %v", err)
	}
	reg, _ = svc.Registry.Get(ctx)
	if entries := reg.CatalogFor(roleID, uuid.Nil); len(entries) != 0 {
		t.Errorf("step 3: after revoke catalogue must be empty (got %d entries)", len(entries))
	}
}

// TestLoadRegistry_EnvFiltersDevToolsOutOfStaging (TD-NAV-001):
// pages_tags row 'dev_tools' has pages_tags_env_only='dev'. When
// BACKEND_ENV='staging' or 'production' the registry must drop the tag
// AND every page that belonged to it.
func TestLoadRegistry_EnvFiltersDevToolsOutOfStaging(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	// Sanity: dev_tools tag carries env_only='dev'.
	var envOnly *string
	if err := pool.QueryRow(ctx,
		`SELECT pages_tags_env_only FROM pages_tags WHERE pages_tags_tag_enum = 'dev_tools'`,
	).Scan(&envOnly); err != nil {
		t.Fatalf("query dev_tools env_only: %v", err)
	}
	if envOnly == nil || *envOnly != "dev" {
		t.Skipf("dev_tools tag env_only is %v — migration 219 not applied?", envOnly)
	}

	// Load under BACKEND_ENV=dev: dev_tools tag must be present.
	t.Setenv("BACKEND_ENV", "dev")
	devReg, err := LoadRegistry(ctx, pool)
	if err != nil {
		t.Fatalf("LoadRegistry dev: %v", err)
	}
	var foundDevTagInDev bool
	for _, tg := range devReg.Tags() {
		if tg.Enum == "dev_tools" {
			foundDevTagInDev = true
		}
	}
	if !foundDevTagInDev {
		t.Fatal("dev env: registry must include dev_tools tag")
	}

	// Load under BACKEND_ENV=staging: dev_tools tag must be filtered out.
	t.Setenv("BACKEND_ENV", "staging")
	stgReg, err := LoadRegistry(ctx, pool)
	if err != nil {
		t.Fatalf("LoadRegistry staging: %v", err)
	}
	for _, tg := range stgReg.Tags() {
		if tg.Enum == "dev_tools" {
			t.Fatal("staging env: registry must NOT include dev_tools tag")
		}
	}
	// And every page that lived under dev_tools must be gone too.
	for _, e := range stgReg.CatalogFor(uuid.Nil, uuid.Nil) {
		if e.TagEnum == "dev_tools" {
			t.Fatalf("staging env: page %q under dev_tools must be filtered out", e.Key)
		}
	}
}

// TestPageBookmarks_PinUnpin verifies the full lifecycle:
//   - PinPage inserts a pref row with is_bookmark=true
//   - GetPrefs returns that row with IsBookmark=true
//   - UnpinPage removes it (idempotent second call is a no-op)
//   - PinPage on a non-pinnable key returns ErrPageNotFound
func TestPageBookmarks_PinUnpin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, _, cleanup := mkFixtures(t, pool)
	defer cleanup()

	ctx := context.Background()
	reg := NewCachedRegistry(pool, 60*time.Second)
	if _, err := reg.Load(ctx); err != nil {
		t.Fatalf("registry load: %v", err)
	}
	svc := New(pool, reg)
	pb := NewPageBookmarks(pool, reg, svc)

	// "dashboard" is kind='static' and pinnable=true in the system pages.
	t.Run("pin dashboard", func(t *testing.T) {
		if err := pb.PinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("PinPage: %v", err)
		}
	})

	t.Run("prefs row has is_bookmark=true", func(t *testing.T) {
		profileID, err := svc.ResolveProfile(ctx, userID, subscriptionID, nil)
		if err != nil {
			t.Fatalf("ResolveProfile: %v", err)
		}
		var isBookmark bool
		err = pool.QueryRow(ctx,
			`SELECT users_nav_prefs_is_bookmark FROM users_nav_prefs
			 WHERE users_nav_prefs_id_user=$1
			   AND users_nav_prefs_id_subscription=$2
			   AND users_nav_prefs_id_profile=$3
			   AND users_nav_prefs_item_key='dashboard'`,
			userID, subscriptionID, profileID,
		).Scan(&isBookmark)
		if err != nil {
			t.Fatalf("query pref row: %v", err)
		}
		if !isBookmark {
			t.Fatal("want is_bookmark=true, got false")
		}
	})

	t.Run("GetPrefs row carries IsBookmark=true", func(t *testing.T) {
		rows, err := svc.GetPrefs(ctx, userID, subscriptionID, roletypes.RoleUser, uuid.Nil)
		if err != nil {
			t.Fatalf("GetPrefs: %v", err)
		}
		var found bool
		for _, r := range rows {
			if r.ItemKey == "dashboard" && r.IsBookmark {
				found = true
			}
		}
		if !found {
			t.Fatal("dashboard row with IsBookmark=true not found in GetPrefs output")
		}
	})

	t.Run("pin is idempotent", func(t *testing.T) {
		if err := pb.PinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("second PinPage: %v", err)
		}
	})

	t.Run("unpin dashboard", func(t *testing.T) {
		if err := pb.UnpinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("UnpinPage: %v", err)
		}
	})

	t.Run("unpin is idempotent", func(t *testing.T) {
		if err := pb.UnpinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("second UnpinPage: %v", err)
		}
	})

	t.Run("unknown key returns ErrPageNotFound", func(t *testing.T) {
		err := pb.PinPage(ctx, userID, subscriptionID, "does-not-exist")
		if !errors.Is(err, ErrPageNotFound) {
			t.Fatalf("want ErrPageNotFound, got %v", err)
		}
	})
}

// TestPageBookmarks_PinExistingSectionPref covers the case where the page is
// already in the user's section nav prefs (is_bookmark=FALSE). PinPage must
// flip the flag to TRUE rather than silently doing nothing (ON CONFLICT DO UPDATE).
// UnpinPage must flip it back to FALSE without deleting the row.
func TestPageBookmarks_PinExistingSectionPref(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, userID, roleID, cleanup := mkFixtures(t, pool)
	defer cleanup()

	ctx := context.Background()
	reg := NewCachedRegistry(pool, 60*time.Second)
	if _, err := reg.Load(ctx); err != nil {
		t.Fatalf("registry load: %v", err)
	}
	svc := New(pool, reg)
	pb := NewPageBookmarks(pool, reg, svc)

	// Put "dashboard" into section prefs first (is_bookmark=FALSE).
	if err := svc.ReplacePrefs(ctx, userID, subscriptionID, roletypes.RoleUser, roleID, []PinnedInput{
		{ItemKey: "dashboard", Position: 0},
	}, nil, nil, nil); err != nil {
		t.Fatalf("ReplacePrefs: %v", err)
	}

	profileID, err := svc.ResolveProfile(ctx, userID, subscriptionID, nil)
	if err != nil {
		t.Fatalf("ResolveProfile: %v", err)
	}

	checkBookmark := func(want bool) {
		t.Helper()
		var isBookmark bool
		var rowExists bool
		err := pool.QueryRow(ctx,
			`SELECT users_nav_prefs_is_bookmark FROM users_nav_prefs
			 WHERE users_nav_prefs_id_user=$1 AND users_nav_prefs_id_subscription=$2
			   AND users_nav_prefs_id_profile=$3 AND users_nav_prefs_item_key='dashboard'`,
			userID, subscriptionID, profileID,
		).Scan(&isBookmark)
		rowExists = err == nil
		if !rowExists {
			t.Fatalf("pref row missing — want is_bookmark=%v", want)
		}
		if isBookmark != want {
			t.Fatalf("want is_bookmark=%v, got %v", want, isBookmark)
		}
	}

	checkBookmark(false) // section pref, not yet bookmarked

	t.Run("pin flips existing row to is_bookmark=true", func(t *testing.T) {
		if err := pb.PinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("PinPage: %v", err)
		}
		checkBookmark(true)
	})

	t.Run("unpin clears flag without deleting row", func(t *testing.T) {
		if err := pb.UnpinPage(ctx, userID, subscriptionID, "dashboard"); err != nil {
			t.Fatalf("UnpinPage: %v", err)
		}
		checkBookmark(false) // row still exists, just no longer bookmarked
	})
}
