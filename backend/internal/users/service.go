package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/models"
)

var (
	ErrDuplicateEmail = errors.New("user with that email already exists in tenant")
	ErrNotFound       = errors.New("not found")
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
	Role     models.Role
	SubscriptionID uuid.UUID
}

// Create makes a new account with a random hashed placeholder password and
// issues a password_resets token; the user sets their real password via the link.
//
// actorRole is the role of the caller, used to enforce the role ceiling
// (cannot create an account whose role outranks you). See
// feedback_role_ceiling.md.
func (s *Service) Create(ctx context.Context, in CreateInput, actorRole models.Role, createdBy uuid.UUID, ip string) (*models.User, string, error) {
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

	u := &models.User{}
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO users (subscription_id, email, password_hash, role, force_password_change)
		VALUES ($1, $2, $3, $4, TRUE)
		RETURNING id, subscription_id, email, role, is_active, auth_method, force_password_change, created_at, updated_at`,
		in.SubscriptionID, email, hash, string(in.Role),
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.AuthMethod, &u.ForcePasswordChange, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "users_email_tenant_unique") {
			return nil, "", ErrDuplicateEmail
		}
		return nil, "", err
	}

	// Issue initial reset token.
	raw, tokHash, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, "", err
	}
	exp := time.Now().Add(24 * time.Hour) // longer window for initial setup
	if _, err := s.Pool.Exec(ctx, `
		INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
		VALUES ($1, $2, $3, $4)`, u.ID, tokHash, exp, nilIfEmpty(ip)); err != nil {
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

func (s *Service) List(ctx context.Context, subscriptionID uuid.UUID) ([]models.User, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, subscription_id, email, role, is_active, last_login, auth_method,
		       force_password_change, password_changed_at, created_at, updated_at
		FROM users WHERE subscription_id = $1 ORDER BY created_at DESC`, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.User{}
	for rows.Next() {
		u := models.User{}
		if err := rows.Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.LastLogin,
			&u.AuthMethod, &u.ForcePasswordChange, &u.PasswordChangedAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}

type UpdateInput struct {
	Role     *models.Role
	IsActive *bool
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
func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput, actorRole models.Role, actorTenant, actor uuid.UUID, ip string) error {
	var (
		targetTenant uuid.UUID
		targetRole   models.Role
	)
	err := s.Pool.QueryRow(ctx,
		`SELECT subscription_id, role FROM users WHERE id = $1`, id,
	).Scan(&targetTenant, &targetRole)
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
		sets = append(sets, "role = $"+itoa(i))
		args = append(args, string(*in.Role))
		i++
	}
	if in.IsActive != nil {
		sets = append(sets, "is_active = $"+itoa(i))
		args = append(args, *in.IsActive)
		i++
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err = s.Pool.Exec(ctx,
		"UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = $"+itoa(i), args...,
	)
	if err != nil {
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
	return nil
}

// FindByID returns the user iff they belong to actorTenant. Cross-tenant
// existence is hidden — same ErrNotFound either way.
func (s *Service) FindByID(ctx context.Context, id, actorTenant uuid.UUID) (*models.User, error) {
	u := &models.User{}
	err := s.Pool.QueryRow(ctx, `
		SELECT id, subscription_id, email, role, is_active, created_at, updated_at
		FROM users WHERE id = $1 AND subscription_id = $2`, id, actorTenant,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
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
