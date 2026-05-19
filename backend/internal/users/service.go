package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

var (
	ErrDuplicateEmail  = errors.New("user with that email already exists in tenant")
	ErrNotFound        = errors.New("not found")
	ErrScopeNotGranted = errors.New("user holds no grant on the requested scope node")
	// ErrRoleCeiling is returned when the actor tries to act on a target
	// whose current role outranks them, OR tries to assign a role that
	// outranks them. Maps to HTTP 403. See feedback_role_ceiling.md.
	ErrRoleCeiling = errors.New("role ceiling: cannot act on or assign a role above your own")
)

type Service struct {
	Pool   *pgxpool.Pool
	Audit  *audit.Logger
	Mailer *email.Service
}

func New(pool *pgxpool.Pool, audit *audit.Logger, mailer *email.Service) *Service {
	return &Service{Pool: pool, Audit: audit, Mailer: mailer}
}

type CreateInput struct {
	Email    string
	Role     roletypes.Role
	SubscriptionID uuid.UUID
}

// Create makes a new account with a random hashed placeholder password and
// issues a password_resets token; the user sets their real password via the link.
//
// actorRole is the role of the caller, used to enforce the role ceiling
// (cannot create an account whose role outranks you). See
// feedback_role_ceiling.md.
func (s *Service) Create(ctx context.Context, in CreateInput, actorRole roletypes.Role, createdBy uuid.UUID, ip string) (*roletypes.User, string, error) {
	if in.Role.Rank() > actorRole.Rank() {
		return nil, "", ErrRoleCeiling
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))

	// Placeholder password — user must reset via the emailed link.
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return nil, "", err
	}
	placeholder := hex.EncodeToString(buf)
	hash, err := auth.HashPassword(placeholder)
	if err != nil {
		return nil, "", err
	}

	// Issue initial reset token before the transaction so we can roll back cleanly on token-gen failure.
	raw, tokHash, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, "", err
	}
	exp := time.Now().Add(24 * time.Hour) // longer window for initial setup

	// role_id is NOT NULL after migration 088. We translate the legacy
	// role enum to the corresponding system-role UUID via subquery so a
	// future schema change (e.g. dropping the enum column) needs to
	// touch only one place. PLA-0007 G4 retires the enum entirely.
	u := &roletypes.User{}
	err = pgx.BeginTxFunc(ctx, s.Pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		// The legacy `role` enum column only knows ('user','padmin','gadmin');
		// codes outside that set (team_lead, external, future custom roles)
		// are pinned to 'user' in the enum and carried by role_id. The
		// Z-migration that drops users.role retires this branch — same
		// pattern as migration 095. PLA-0007 G4 follow-up.
		legacyRole := string(in.Role)
		if legacyRole != string(roletypes.RoleUser) && legacyRole != string(roletypes.RolePAdmin) && legacyRole != string(roletypes.RoleGAdmin) {
			legacyRole = string(roletypes.RoleUser)
		}
		if err := tx.QueryRow(ctx, sqlInsertUser,
			in.SubscriptionID, email, hash, legacyRole, legacyRoleToGrpCode(in.Role),
		).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.AuthMethod, &u.ForcePasswordChange, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, sqlInsertPasswordReset, u.ID, tokHash, exp, nilIfEmpty(ip))
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "users_email_tenant_unique") {
			return nil, "", ErrDuplicateEmail
		}
		return nil, "", err
	}
	link := os.Getenv("FRONTEND_ORIGIN") + "/login/reset/confirm?token=" + raw
	_ = s.Mailer.SendPasswordReset(ctx, u.Email, link)

	s.Audit.Log(ctx, audit.Entry{
		UserID: &createdBy, SubscriptionID: &u.SubscriptionID,
		Action: "user.created", Resource: strPtr("user"), ResourceID: strPtr(u.ID.String()),
		IPAddress: nilIfEmpty(ip),
		Metadata:  map[string]any{"email": u.Email, "role": u.Role},
	})
	return u, link, nil
}

func (s *Service) List(ctx context.Context, subscriptionID uuid.UUID) ([]roletypes.User, error) {
	rows, err := s.Pool.Query(ctx, sqlListUsersBySubscription, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []roletypes.User{}
	for rows.Next() {
		u := roletypes.User{}
		if err := rows.Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.RoleID, &u.IsActive,
			&u.FirstName, &u.LastName, &u.Department,
			&u.LastLogin, &u.AuthMethod, &u.ForcePasswordChange, &u.PasswordChangedAt,
			&u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}

type UpdateInput struct {
	Role       *roletypes.Role
	IsActive   *bool
	FirstName  *string
	LastName   *string
	Department *string
}

// Update mutates a user's role and/or is_active flag.
//
// actorRole and actorTenant come from the verified session, never the
// payload. Pre-flight checks (in order):
//   1. Target must exist in actor's tenant — otherwise ErrNotFound
//      (cross-subscription existence is hidden).
//   2. Target's CURRENT role must not outrank actor — otherwise
//      ErrRoleCeiling (a padmin cannot poke a gadmin record).
//   3. If a NEW role is requested, it must not outrank actor —
//      otherwise ErrRoleCeiling (no privilege escalation).
// See feedback_role_ceiling.md.
func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput, actorRole roletypes.Role, actorTenant, actor uuid.UUID, ip string) error {
	var (
		targetTenant uuid.UUID
		targetRole   roletypes.Role
	)
	err := s.Pool.QueryRow(ctx, sqlSelectUserTenantAndRole, id).
		Scan(&targetTenant, &targetRole)
	if err == pgx.ErrNoRows || (err == nil && targetTenant != actorTenant) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if targetRole.Rank() > actorRole.Rank() {
		return ErrRoleCeiling
	}
	if in.Role != nil && in.Role.Rank() > actorRole.Rank() {
		return ErrRoleCeiling
	}

	sets := []string{}
	args := []any{}
	i := 1
	if in.Role != nil {
		// Mirror Create: legacy enum column is pinned to 'user' for codes
		// outside ('user','padmin','gadmin'), and role_id is updated via a
		// subquery against the roles table so the structured side stays
		// authoritative. Both columns must move together until the Z
		// migration drops users.role.
		legacyRole := string(*in.Role)
		if legacyRole != string(roletypes.RoleUser) && legacyRole != string(roletypes.RolePAdmin) && legacyRole != string(roletypes.RoleGAdmin) {
			legacyRole = string(roletypes.RoleUser)
		}
		sets = append(sets, "role = $"+itoa(i))
		args = append(args, legacyRole)
		i++
		sets = append(sets, fmt.Sprintf(sqlUpdateUserRoleIDFragmentTemplate, "$"+itoa(i)))
		args = append(args, legacyRoleToGrpCode(*in.Role))
		i++
	}
	if in.IsActive != nil {
		sets = append(sets, "is_active = $"+itoa(i))
		args = append(args, *in.IsActive)
		i++
	}
	if in.FirstName != nil {
		sets = append(sets, "first_name = $"+itoa(i))
		args = append(args, nilIfEmpty(strings.TrimSpace(*in.FirstName)))
		i++
	}
	if in.LastName != nil {
		sets = append(sets, "last_name = $"+itoa(i))
		args = append(args, nilIfEmpty(strings.TrimSpace(*in.LastName)))
		i++
	}
	if in.Department != nil {
		sets = append(sets, "department = $"+itoa(i))
		args = append(args, nilIfEmpty(strings.TrimSpace(*in.Department)))
		i++
	}
	if len(sets) == 0 {
		return nil
	}

	// PLA-0010 / story 00367 — role change must revoke active sessions in
	// the same transaction as the role write, so a downgraded user cannot
	// keep using their old elevated token until expiry. We compare against
	// targetRole loaded above; assigning the same role is a no-op.
	roleChanged := in.Role != nil && *in.Role != targetRole

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	args = append(args, id)
	sql := fmt.Sprintf(sqlUpdateUserTemplate, strings.Join(sets, ", "), "$"+itoa(i))
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return err
	}

	if roleChanged {
		if _, err := tx.Exec(ctx, sqlRevokeActiveUserSessions, id); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	action := "user.updated"
	if in.IsActive != nil && !*in.IsActive {
		action = "user.deactivated"
	}
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: action,
		Resource: strPtr("user"), ResourceID: strPtr(id.String()),
		IPAddress: nilIfEmpty(ip),
	})
	if roleChanged {
		s.Audit.Log(ctx, audit.Entry{
			UserID: &actor, Action: "user.role_changed",
			Resource: strPtr("user"), ResourceID: strPtr(id.String()),
			Metadata: map[string]any{
				"from": string(targetRole),
				"to":   string(*in.Role),
			},
			IPAddress: nilIfEmpty(ip),
		})
	}
	return nil
}

// Delete hard-removes a user row. Tenant + role-ceiling rules apply
// the same way as Update — actor cannot delete themselves, cannot
// delete across tenants, and cannot delete a target whose role
// outranks them.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actorRole roletypes.Role, actorTenant, actor uuid.UUID, ip string) error {
	if id == actor {
		return errors.New("cannot delete your own account")
	}
	var (
		targetTenant uuid.UUID
		targetRole   roletypes.Role
		targetEmail  string
	)
	err := s.Pool.QueryRow(ctx, sqlSelectUserTenantRoleEmail, id).
		Scan(&targetTenant, &targetRole, &targetEmail)
	if err == pgx.ErrNoRows || (err == nil && targetTenant != actorTenant) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if targetRole.Rank() > actorRole.Rank() {
		return ErrRoleCeiling
	}
	if _, err := s.Pool.Exec(ctx, sqlDeleteUser, id); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, SubscriptionID: &actorTenant,
		Action: "user.deleted", Resource: strPtr("user"), ResourceID: strPtr(id.String()),
		IPAddress: nilIfEmpty(ip),
		Metadata:  map[string]any{"email": targetEmail, "role": targetRole},
	})
	return nil
}

// IssueResetLink generates a one-hour password-reset token for the
// target user and emails them the link. Returns the link string for
// the gadmin UI (only meaningful in dev/console mailer mode; prod
// should rely on the email send and ignore the returned URL).
func (s *Service) IssueResetLink(ctx context.Context, id uuid.UUID, actorRole roletypes.Role, actorTenant, actor uuid.UUID, ip string) (string, error) {
	var (
		targetTenant uuid.UUID
		targetRole   roletypes.Role
		targetEmail  string
	)
	err := s.Pool.QueryRow(ctx, sqlSelectUserTenantRoleEmail, id).
		Scan(&targetTenant, &targetRole, &targetEmail)
	if err == pgx.ErrNoRows || (err == nil && targetTenant != actorTenant) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if targetRole.Rank() > actorRole.Rank() {
		return "", ErrRoleCeiling
	}

	raw, tokHash, err := auth.GenerateRefreshToken()
	if err != nil {
		return "", err
	}
	exp := time.Now().Add(1 * time.Hour)
	_, err = s.Pool.Exec(ctx, sqlInsertPasswordReset, id, tokHash, exp, nilIfEmpty(ip))
	if err != nil {
		return "", err
	}
	link := os.Getenv("FRONTEND_ORIGIN") + "/login/reset/confirm?token=" + raw
	_ = s.Mailer.SendPasswordReset(ctx, targetEmail, link)

	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, SubscriptionID: &actorTenant,
		Action: "user.password_reset_issued", Resource: strPtr("user"), ResourceID: strPtr(id.String()),
		IPAddress: nilIfEmpty(ip),
		Metadata:  map[string]any{"email": targetEmail},
	})
	return link, nil
}

// FindByID returns the user iff they belong to actorTenant. Cross-tenant
// existence is hidden — same ErrNotFound either way.
func (s *Service) FindByID(ctx context.Context, id, actorTenant uuid.UUID) (*roletypes.User, error) {
	u := &roletypes.User{}
	err := s.Pool.QueryRow(ctx, sqlSelectUserByIDInTenant, id, actorTenant).
		Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

// legacyRoleToGrpCode maps the legacy users.role enum value to the
// users_roles.users_roles_code that PLA-0049 Phase 0 introduced. The
// subquery in sqlInsertUser / sqlUpdateUserRoleIDFragmentTemplate looks up
// by code; passing the legacy enum string returns NULL → NOT NULL violation.
// Codes outside the three coarse buckets pass through unchanged (e.g.
// future grp_* custom roles) so Service.Create with a grp_* value also works.
func legacyRoleToGrpCode(role roletypes.Role) string {
	switch role {
	case roletypes.RoleGAdmin:
		return "grp_global"
	case roletypes.RolePAdmin:
		return "grp_portfolio"
	case roletypes.RoleUser:
		return "grp_team_member"
	default:
		return string(role)
	}
}

func strPtr(s string) *string    { return &s }
func nilIfEmpty(s string) *string { if s == "" { return nil }; return &s }
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	buf := [20]byte{}
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
