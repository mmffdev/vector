package users

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// PLA-0007 AC #4 (creator-matrix): the route-level OR-gate proves the
// actor can create *some* role; the handler-side discriminator proves
// the actor holds the specific users.create.<target> code matching the
// requested target role. These tests exercise the discriminator
// directly via httptest.

func TestTargetRoleCreateCode(t *testing.T) {
	cases := []struct {
		role models.Role
		want permissions.Code
	}{
		{models.RoleGAdmin, permissions.UsersCreateGadmin},
		{models.RolePAdmin, permissions.UsersCreatePadmin},
		{models.RoleUser, permissions.UsersCreateUser},
		{"team_lead", permissions.UsersCreateTeamLead},
		{"external", permissions.UsersCreateExternal},
		{"bogus", ""},
		{"", ""},
	}
	for _, c := range cases {
		got := targetRoleCreateCode(c.role)
		if got != c.want {
			t.Errorf("targetRoleCreateCode(%q): want %q, got %q", c.role, c.want, got)
		}
	}
}

// systemRoleIDFor mirrors the roles package's system-role UUID seeds.
// We don't import internal/roles to avoid an import cycle; this is the
// minimum needed to seed users.role_id (NOT NULL post-migration 088).
func systemRoleIDFor(t *testing.T, role models.Role) uuid.UUID {
	t.Helper()
	switch role {
	case models.RoleGAdmin:
		return uuid.MustParse("00000000-0000-0000-0000-00000000ad30")
	case models.RolePAdmin:
		return uuid.MustParse("00000000-0000-0000-0000-00000000ad25")
	case models.RoleUser:
		return uuid.MustParse("00000000-0000-0000-0000-00000000ad10")
	}
	t.Fatalf("systemRoleIDFor: unsupported role %q", role)
	return uuid.Nil
}

// mkUserWithRoleID inserts a user with both the legacy enum and the
// system-role UUID. Once migration 088 has shipped to all envs, the
// service_test.go mkUser helper can adopt this shape too.
func mkUserWithRoleID(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, role models.Role) *models.User {
	t.Helper()
	suffix := uuid.NewString()[:8]
	roleID := systemRoleIDFor(t, role)
	u := &models.User{}
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, subscription_id, email, role, is_active, force_password_change`,
		subID, "u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		string(role), roleID,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.ForcePasswordChange)
	if err != nil {
		t.Fatalf("insert user (%s): %v", role, err)
	}
	return u
}

func newCreatorMatrixRouter(h *Handler, actor *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), actor)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	r.Post("/api/users", h.Create)
	return r
}

func newHandlerWithResolver(pool *pgxpool.Pool) *Handler {
	mailer := email.New(email.DiscardTransport{}, "test@example.com")
	svc := New(pool, audit.New(pool), mailer)
	res := permissions.NewResolver(pool, 0) // ttl<=0 -> always re-read
	return NewHandler(svc, res)
}

// TestCreate_creatorMatrix_403_whenSpecificCodeMissing covers the case
// where the actor's grid grants users.create.user but they POST a
// request for role="gadmin". Route-level OR gate would let them in
// (they hold *some* create code); handler-side discriminator must
// 403.
//
// We seed the actor with the system "user" role (which does NOT hold
// users.create.gadmin in the seeded grid) and POST role="gadmin".
func TestCreate_creatorMatrix_403_whenSpecificCodeMissing(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "creator-403")
	defer cleanup()

	// Actor is seeded as a regular user — the seed grid for the "user"
	// system role does NOT include users.create.gadmin. They should
	// pass the route-level OR-gate only if they hold *any* create code,
	// which they don't either; so to isolate the *handler* discriminator
	// we bypass the middleware and call the handler directly via a
	// router that doesn't include RequireAnyPermission.
	actor := mkUserWithRoleID(t, pool, subID, models.RoleUser)

	h := newHandlerWithResolver(pool)
	srv := httptest.NewServer(newCreatorMatrixRouter(h, actor))
	defer srv.Close()

	body, _ := json.Marshal(createReq{Email: "newgadmin@example.com", Role: models.RoleGAdmin})
	resp, err := http.Post(srv.URL+"/api/users", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403 (creator matrix), got %d", resp.StatusCode)
	}
}

// TestCreate_creatorMatrix_400_unknownTargetRole covers the bad-input
// path where the request specifies a role string the discriminator
// doesn't recognise.
func TestCreate_creatorMatrix_400_unknownTargetRole(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "creator-400")
	defer cleanup()
	actor := mkUserWithRoleID(t, pool, subID, models.RoleGAdmin)

	h := newHandlerWithResolver(pool)
	srv := httptest.NewServer(newCreatorMatrixRouter(h, actor))
	defer srv.Close()

	body, _ := json.Marshal(createReq{Email: "x@example.com", Role: "bogus"})
	resp, err := http.Post(srv.URL+"/api/users", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("want 400 (unknown target role), got %d", resp.StatusCode)
	}
}
