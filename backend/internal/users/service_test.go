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
	"github.com/mmffdev/vector-backend/internal/email"
	"github.com/mmffdev/vector-backend/internal/models"
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

// silentMailer satisfies email.Sender without sending anything.
type silentMailer struct{}

func (silentMailer) SendResetLink(_, _ string) error { return nil }

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
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE subscription_id = $1)`, subscriptionID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE subscription_id = $1`, subscriptionID)
		if _, err := pool.Exec(ctx, `DELETE FROM subscriptions WHERE id = $1`, subscriptionID); err != nil {
			t.Logf("cleanup tenant %s: %v", label, err)
		}
	}
	return subscriptionID, cleanup
}

// mkUser inserts a user with the given role into the tenant.
func mkUser(t *testing.T, pool *pgxpool.Pool, subscriptionID uuid.UUID, role models.Role) uuid.UUID {
	t.Helper()
	suffix := uuid.NewString()[:8]
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (subscription_id, email, password_hash, role)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		subscriptionID, "u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		string(role),
	).Scan(&id); err != nil {
		t.Fatalf("insert user (%s): %v", role, err)
	}
	return id
}

func newSvc(pool *pgxpool.Pool) *Service {
	var mailer email.Sender = silentMailer{}
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
	actor := mkUser(t, pool, subscriptionID, models.RolePAdmin)

	_, _, err := svc.Create(context.Background(), CreateInput{
		Email: "new-gadmin@example.com", Role: models.RoleGAdmin, SubscriptionID: subscriptionID,
	}, models.RolePAdmin, actor, "")
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
	actor := mkUser(t, pool, subscriptionID, models.RoleGAdmin)

	for _, role := range []models.Role{models.RoleUser, models.RolePAdmin, models.RoleGAdmin} {
		suffix := uuid.NewString()[:6]
		_, _, err := svc.Create(context.Background(), CreateInput{
			Email: "new-" + suffix + "@example.com", Role: role, SubscriptionID: subscriptionID,
		}, models.RoleGAdmin, actor, "")
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
	actor := mkUser(t, pool, a, models.RoleGAdmin)
	target := mkUser(t, pool, b, models.RoleUser)

	active := false
	err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		models.RoleGAdmin, a, actor, "")
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
	actor := mkUser(t, pool, subscriptionID, models.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, models.RoleGAdmin)

	active := false
	err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		models.RolePAdmin, subscriptionID, actor, "")
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
	actor := mkUser(t, pool, subscriptionID, models.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, models.RoleUser)

	gadmin := models.RoleGAdmin
	err := svc.Update(context.Background(), target,
		UpdateInput{Role: &gadmin},
		models.RolePAdmin, subscriptionID, actor, "")
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
	actor := mkUser(t, pool, subscriptionID, models.RoleGAdmin)
	target := mkUser(t, pool, subscriptionID, models.RolePAdmin)

	active := false
	if err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		models.RoleGAdmin, subscriptionID, actor, "",
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
	actor := mkUser(t, pool, subscriptionID, models.RolePAdmin)
	target := mkUser(t, pool, subscriptionID, models.RoleUser)

	active := false
	if err := svc.Update(context.Background(), target,
		UpdateInput{IsActive: &active},
		models.RolePAdmin, subscriptionID, actor, "",
	); err != nil {
		t.Fatalf("padmin deactivate user: %v", err)
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
	target := mkUser(t, pool, b, models.RoleUser)

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
