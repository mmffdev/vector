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
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// PLA-0007 AC #4 (creator-matrix): the route-level OR-gate proves the
// actor can create *some* role; the handler-side discriminator proves
// the actor holds the specific users.create.<target> code matching the
// requested target role. These tests exercise the discriminator
// directly via httptest.

func TestTargetRoleCreateCode(t *testing.T) {
	// PLA-0049 Phase 0 narrowed targetRoleCreateCode from the legacy
	// 5-role enum to the 3 supported wire-shape roles (gadmin/padmin/user
	// → grp_global/grp_portfolio/grp_team_member). The remaining four
	// grp_* roles require a follow-up wire-shape change to accept role_id
	// directly (deferred to Phase 1.x — admin-grid-only until then).
	// Any unknown role (incl. the four deferred grp_*) returns "".
	cases := []struct {
		role roletypes.Role
		want permissions.Code
	}{
		{roletypes.RoleGAdmin, permissions.UsersCreateGrpGlobal},
		{roletypes.RolePAdmin, permissions.UsersCreateGrpPortfolio},
		{roletypes.RoleUser, permissions.UsersCreateGrpTeamMember},
		// Deferred until wire-shape carries role_id directly:
		{"team_lead", ""},
		{"external", ""},
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

// resolveGrpRoleID resolves the grp_* role UUID for a legacy enum role
// by looking up users_roles.code at fixture time. Replaces the retired
// rank-encoded literals (ad05/ad10/ad20/ad25/ad30) that were removed
// in PLA-0049 Phase 0 (TD-TEST-002, refreshed 2026-05-16). Coarse-
// fallback mapping mirrors mig 196:
//   gadmin → grp_global, padmin → grp_portfolio, user → grp_team_member.
func resolveGrpRoleID(t *testing.T, pool *pgxpool.Pool, role roletypes.Role) uuid.UUID {
	t.Helper()
	var code string
	switch role {
	case roletypes.RoleGAdmin:
		code = "grp_global"
	case roletypes.RolePAdmin:
		code = "grp_portfolio"
	case roletypes.RoleUser:
		code = "grp_team_member"
	default:
		t.Fatalf("resolveGrpRoleID: unsupported role %q", role)
	}
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = $1 AND users_roles_id_subscription IS NULL`,
		code,
	).Scan(&id); err != nil {
		t.Fatalf("resolveGrpRoleID(%s → %s): %v", role, code, err)
	}
	return id
}

// mkUserWithRoleID inserts a user with both the legacy enum and the
// grp_* system-role UUID resolved via DB lookup (TD-TEST-002, 2026-05-16).
func mkUserWithRoleID(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, role roletypes.Role) *roletypes.User {
	t.Helper()
	suffix := uuid.NewString()[:8]
	roleID := resolveGrpRoleID(t, pool, role)
	u := &roletypes.User{}
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

func newCreatorMatrixRouter(h *Handler, actor *roletypes.User) http.Handler {
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
	actor := mkUserWithRoleID(t, pool, subID, roletypes.RoleUser)

	h := newHandlerWithResolver(pool)
	srv := httptest.NewServer(newCreatorMatrixRouter(h, actor))
	defer srv.Close()

	body, _ := json.Marshal(createReq{Email: "newgadmin@example.com", Role: roletypes.RoleGAdmin})
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
	actor := mkUserWithRoleID(t, pool, subID, roletypes.RoleGAdmin)

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
