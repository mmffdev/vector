package users

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

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// Integration tests hit the real Postgres via the SSH tunnel on :5434.
// Per repo convention, we do not mock the DB.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"),
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

// silentMailer wraps the DiscardTransport so tests don't ship reset links.

// mkTenant inserts a throwaway tenant and returns its id + cleanup.
func mkTenant(t *testing.T, pool *pgxpool.Pool, label string) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	var subscriptionID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"users-test-"+label+"-"+suffix, "users-test-"+label+"-"+suffix,
	).Scan(&subscriptionID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	// Dependency-ordered teardown. Subscriptions can accumulate portfolio-stack +
	// item-type seed data whose FKs RESTRICT both `users` and `subscriptions`, so a
	// users/subscription delete alone leaves orphans and silently fails. Delete from
	// the leaves up; let CASCADE handle users_sessions/perms/nav off `users`.
	cleanup := func() {
		stmts := []string{
			`DELETE FROM execution_item_types        WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_stakeholders  WHERE subscriptions_stakeholders_id_subscription = $1`,
			`DELETE FROM product                     WHERE subscription_id = $1`,
			`DELETE FROM portfolio                   WHERE subscription_id = $1`,
			`DELETE FROM workspace                   WHERE subscription_id = $1`,
			`DELETE FROM company_roadmap             WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_sequence      WHERE subscriptions_sequence_id_subscription = $1`,
			`DELETE FROM users_password_resets             WHERE users_password_resets_id_user IN (SELECT id FROM users WHERE subscription_id = $1)`,
			`DELETE FROM users                       WHERE subscription_id = $1`,
			`DELETE FROM subscriptions               WHERE id = $1`,
		}
		for _, sql := range stmts {
			if _, err := pool.Exec(ctx, sql, subscriptionID); err != nil {
				t.Errorf("cleanup tenant %s: %s: %v", label, sql, err)
			}
		}
	}
	return subscriptionID, cleanup
}

// mkUser inserts a user with the given role into the tenant.
// role_id is NOT NULL post-migration 088, so we resolve the grp_* UUID
// at fixture time via the users_roles code lookup. The rank-encoded ad05
// /ad10/ad20/ad25/ad30 literals were retired by PLA-0049 Phase 0
// (TD-TEST-002, refreshed 2026-05-16).
func mkUser(t *testing.T, pool *pgxpool.Pool, subscriptionID uuid.UUID, role roletypes.Role) uuid.UUID {
	t.Helper()
	suffix := uuid.NewString()[:8]
	roleID := resolveGrpRoleID(t, pool, role)
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		subscriptionID, "u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		string(role), roleID,
	).Scan(&id); err != nil {
		t.Fatalf("insert user (%s): %v", role, err)
	}
	return id
}

func newSvc(pool *pgxpool.Pool) *Service {
	mailer := email.New(email.DiscardTransport{}, "test@example.com")
	return New(pool, audit.New(pool), mailer)
}

// ----------------------------------------------------------------
// Create — role-ceiling
// ----------------------------------------------------------------

func TestCreate_PadminCannotCreateGAdmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "create-ceiling")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RolePAdmin)

	_, _, err := svc.Create(context.Background(), CreateInput{
		Email: "new-gadmin@example.com", Role: roletypes.RoleGAdmin, SubscriptionID: subscriptionID,
	}, roletypes.RolePAdmin, actor, "")
	if !errors.Is(err, ErrRoleCeiling) {
		t.Fatalf("expected ErrRoleCeiling, got %v", err)
	}
}

func TestCreate_GAdminCanCreateAnyRole(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "create-allowed")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)

	for _, role := range []roletypes.Role{roletypes.RoleUser, roletypes.RolePAdmin, roletypes.RoleGAdmin} {
		suffix := uuid.NewString()[:6]
		_, _, err := svc.Create(context.Background(), CreateInput{
			Email: "new-" + suffix + "@example.com", Role: role, SubscriptionID: subscriptionID,
		}, roletypes.RoleGAdmin, actor, "")
		if err != nil {
			t.Fatalf("gadmin create %s: %v", role, err)
		}
	}
}

// ----------------------------------------------------------------
// Update — tenant isolation
// ----------------------------------------------------------------

func TestUpdate_RejectsCrossTenantTarget(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenant(t, pool, "upd-a")
	defer cleanA()
	b, cleanB := mkTenant(t, pool, "upd-b")
	defer cleanB()

	svc := newSvc(pool)
	actor := mkUser(t, pool, a, roletypes.RoleGAdmin)
	target := mkUser(t, pool, b, roletypes.RoleUser)

	active := false
	err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		roletypes.RoleGAdmin, a, actor, "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on cross-subscription Update, got %v", err)
	}
}

// ----------------------------------------------------------------
// Update — role ceiling on TARGET role
// ----------------------------------------------------------------

func TestUpdate_PadminCannotPokeGAdmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-target-ceiling")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)

	active := false
	err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		roletypes.RolePAdmin, subscriptionID, actor, "")
	if !errors.Is(err, ErrRoleCeiling) {
		t.Fatalf("expected ErrRoleCeiling, got %v", err)
	}
}

// ----------------------------------------------------------------
// Update — role ceiling on REQUESTED role (privilege escalation)
// ----------------------------------------------------------------

func TestUpdate_PadminCannotPromoteUserToGAdmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-promote-ceiling")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleUser)

	gadmin := roletypes.RoleGAdmin
	err := svc.Update(context.Background(), target,
		UpdateInput{Role: &gadmin},
		roletypes.RolePAdmin, subscriptionID, actor, "")
	if !errors.Is(err, ErrRoleCeiling) {
		t.Fatalf("expected ErrRoleCeiling on padmin→gadmin promotion, got %v", err)
	}
}

// ----------------------------------------------------------------
// Update — happy paths
// ----------------------------------------------------------------

func TestUpdate_GAdminCanModifyAnyone(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-gadmin-happy")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RolePAdmin)

	active := false
	if err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		roletypes.RoleGAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("gadmin update padmin: %v", err)
	}
}

func TestUpdate_PadminCanDeactivateUser(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-padmin-happy")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleUser)

	active := false
	if err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		roletypes.RolePAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("padmin deactivate user: %v", err)
	}
}

// ----------------------------------------------------------------
// PLA-0010 / story 00367 — role change revokes active users_sessions
// ----------------------------------------------------------------

// insertSession seeds a non-revoked users_sessions row for the given user.
// Token hash is unique per call so tenant cleanup ordering is safe.
func insertSession(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	hash := uuid.NewString()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users_sessions (users_sessions_id_user, users_sessions_token_hash, users_sessions_expires_at, users_sessions_ip_address, users_sessions_user_agent)
		VALUES ($1, $2, NOW() + INTERVAL '1 hour', '127.0.0.1', 'test')`,
		userID, hash,
	)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}
}

func sessionRevoked(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) bool {
	t.Helper()
	var revoked bool
	if err := pool.QueryRow(context.Background(),
		`SELECT users_sessions_revoked FROM users_sessions WHERE users_sessions_id_user = $1 ORDER BY users_sessions_created_at DESC LIMIT 1`,
		userID,
	).Scan(&revoked); err != nil {
		t.Fatalf("read session.revoked: %v", err)
	}
	return revoked
}

func TestUpdate_RoleChange_RevokesSessions(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-role-revoke")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleUser)
	insertSession(t, pool, target)

	padmin := roletypes.RolePAdmin
	if err := svc.Update(context.Background(), target,
		UpdateInput{Role: &padmin},
		roletypes.RoleGAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("gadmin promote user→padmin: %v", err)
	}

	if !sessionRevoked(t, pool, target) {
		t.Fatal("expected session.revoked = TRUE after role change, got FALSE")
	}
}

func TestUpdate_NoRoleChange_DoesNotRevokeSessions(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-no-revoke")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleUser)
	insertSession(t, pool, target)

	active := true
	if err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		roletypes.RoleGAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("gadmin update IsActive: %v", err)
	}

	if sessionRevoked(t, pool, target) {
		t.Fatal("expected session.revoked = FALSE when role unchanged, got TRUE")
	}
}

// Same role assigned again — the role string equals the loaded targetRole,
// so we should NOT revoke (defensive: a no-op update must not nuke
// users_sessions and force re-login).
func TestUpdate_SameRole_DoesNotRevokeSessions(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subscriptionID, cleanup := mkTenant(t, pool, "upd-same-role")
	defer cleanup()

	svc := newSvc(pool)
	actor := mkUser(t, pool, subscriptionID, roletypes.RoleGAdmin)
	target := mkUser(t, pool, subscriptionID, roletypes.RoleUser)
	insertSession(t, pool, target)

	user := roletypes.RoleUser
	if err := svc.Update(context.Background(), target,
		UpdateInput{Role: &user},
		roletypes.RoleGAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("gadmin reassign user→user: %v", err)
	}

	if sessionRevoked(t, pool, target) {
		t.Fatal("expected session.revoked = FALSE when same role assigned, got TRUE")
	}
}

// ----------------------------------------------------------------
// FindByID — tenant scoping
// ----------------------------------------------------------------

func TestFindByID_RejectsCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenant(t, pool, "find-a")
	defer cleanA()
	b, cleanB := mkTenant(t, pool, "find-b")
	defer cleanB()

	svc := newSvc(pool)
	target := mkUser(t, pool, b, roletypes.RoleUser)

	if _, err := svc.FindByID(context.Background(), target, a); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on cross-subscription FindByID, got %v", err)
	}

	// Sanity: same-tenant lookup works.
	got, err := svc.FindByID(context.Background(), target, b)
	if err != nil {
		t.Fatalf("same-tenant FindByID: %v", err)
	}
	if got.ID != target {
		t.Fatalf("returned wrong user")
	}
}
