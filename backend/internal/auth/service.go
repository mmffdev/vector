package auth

import (
	"context"
	"errors"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/email"
	"github.com/mmffdev/vector-backend/internal/models"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountLocked      = errors.New("account locked")
	ErrAccountInactive    = errors.New("account inactive")
	ErrNotFound           = errors.New("not found")
	ErrTokenExpired       = errors.New("token expired or used")
)

type Service struct {
	Pool   *pgxpool.Pool
	Audit  *audit.Logger
	Mailer email.Sender
}

func NewService(pool *pgxpool.Pool, audit *audit.Logger, mailer email.Sender) *Service {
	return &Service{Pool: pool, Audit: audit, Mailer: mailer}
}

func (s *Service) FindUserByEmail(ctx context.Context, email string) (*models.User, error) {
	u := &models.User{}
	err := s.Pool.QueryRow(ctx, `
		SELECT id, tenant_id, email, password_hash, role, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until, created_at, updated_at
		FROM users WHERE email = $1`, email).Scan(
		&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.IsActive, &u.LastLogin,
		&u.AuthMethod, &u.LdapDN, &u.ForcePasswordChange, &u.PasswordChangedAt,
		&u.FailedLoginCount, &u.LockedUntil, &u.CreatedAt, &u.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Service) FindUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	u := &models.User{}
	err := s.Pool.QueryRow(ctx, `
		SELECT id, tenant_id, email, password_hash, role, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until, created_at, updated_at
		FROM users WHERE id = $1`, id).Scan(
		&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.IsActive, &u.LastLogin,
		&u.AuthMethod, &u.LdapDN, &u.ForcePasswordChange, &u.PasswordChangedAt,
		&u.FailedLoginCount, &u.LockedUntil, &u.CreatedAt, &u.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

type LoginResult struct {
	User         *models.User
	AccessToken  string
	RefreshRaw   string
	RefreshExpAt time.Time
}

func (s *Service) Login(ctx context.Context, emailIn, password, ip, ua string) (*LoginResult, error) {
	u, err := s.FindUserByEmail(ctx, emailIn)
	if err != nil {
		s.Audit.Log(ctx, audit.Entry{Action: "auth.login_failed", IPAddress: &ip, Metadata: map[string]any{"email": emailIn, "reason": "no_user"}})
		return nil, ErrInvalidCredentials
	}

	if !u.IsActive {
		return nil, ErrAccountInactive
	}
	if u.LockedUntil != nil && u.LockedUntil.After(time.Now()) {
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.login_failed", IPAddress: &ip, Metadata: map[string]any{"reason": "locked"}})
		return nil, ErrAccountLocked
	}

	if !VerifyPassword(u.PasswordHash, password) {
		s.recordFailedLogin(ctx, u, ip)
		return nil, ErrInvalidCredentials
	}

	// Success: reset lockout state, stamp last_login.
	_, _ = s.Pool.Exec(ctx, `
		UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login = NOW()
		WHERE id = $1`, u.ID)

	access, err := SignAccessToken(u)
	if err != nil {
		return nil, err
	}
	raw, hash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	expAt := time.Now().Add(refreshTTL)

	_, err = s.Pool.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5)`,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua),
	)
	if err != nil {
		return nil, err
	}

	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.login", IPAddress: &ip})
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: expAt}, nil
}

func (s *Service) recordFailedLogin(ctx context.Context, u *models.User, ip string) {
	threshold := envInt("LOCKOUT_THRESHOLD", 5)
	dur := parseDurationEnv("LOCKOUT_DURATION", 15*time.Minute)

	newCount := u.FailedLoginCount + 1
	if newCount >= threshold {
		lockUntil := time.Now().Add(dur)
		_, _ = s.Pool.Exec(ctx, `
			UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3`,
			newCount, lockUntil, u.ID)
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.account_locked", IPAddress: &ip})
	} else {
		_, _ = s.Pool.Exec(ctx, `UPDATE users SET failed_login_count = $1 WHERE id = $2`, newCount, u.ID)
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.login_failed", IPAddress: &ip})
}

func (s *Service) Refresh(ctx context.Context, rawRefresh, ip, ua string) (*LoginResult, error) {
	hash := Sha256Hex(rawRefresh)

	var sessID, userID uuid.UUID
	var expiresAt time.Time
	var revoked bool
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, expires_at, revoked FROM sessions WHERE token_hash = $1`, hash,
	).Scan(&sessID, &userID, &expiresAt, &revoked)
	if err == pgx.ErrNoRows {
		return nil, ErrTokenExpired
	}
	if err != nil {
		return nil, err
	}
	if revoked {
		// Reuse of a revoked token: possible theft. Nuke all sessions for this user
		// and audit. The legitimate user will have to log in again.
		_, _ = s.Pool.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1`, userID)
		s.Audit.Log(ctx, audit.Entry{UserID: &userID, Action: "auth.refresh_token_reuse", IPAddress: &ip, Metadata: map[string]any{"session_id": sessID.String()}})
		return nil, ErrTokenExpired
	}
	if expiresAt.Before(time.Now()) {
		return nil, ErrTokenExpired
	}

	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Rotate: revoke old, insert new.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE id = $1`, sessID); err != nil {
		return nil, err
	}

	raw, newHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	newExp := time.Now().Add(refreshTTL)
	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5)`, u.ID, newHash, newExp, nilIfEmpty(ip), nilIfEmpty(ua),
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	access, err := SignAccessToken(u)
	if err != nil {
		return nil, err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.token_refresh", IPAddress: &ip})
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: newExp}, nil
}

func (s *Service) Logout(ctx context.Context, rawRefresh, ip string) error {
	if rawRefresh == "" {
		return nil
	}
	hash := Sha256Hex(rawRefresh)
	var userID uuid.UUID
	err := s.Pool.QueryRow(ctx, `
		UPDATE sessions SET revoked = TRUE WHERE token_hash = $1 RETURNING user_id`, hash,
	).Scan(&userID)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &userID, Action: "auth.logout", IPAddress: &ip})
	return nil
}

func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, current, newPwd, ip string) error {
	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if !VerifyPassword(u.PasswordHash, current) {
		return ErrInvalidCredentials
	}
	if err := ValidatePassword(newPwd, u.Email); err != nil {
		return err
	}
	hash, err := HashPassword(newPwd)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE users SET password_hash = $1, force_password_change = FALSE, password_changed_at = NOW()
		WHERE id = $2`, hash, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &userID, TenantID: &u.TenantID, Action: "auth.password_change", IPAddress: &ip})
	return nil
}

func (s *Service) RequestPasswordReset(ctx context.Context, emailIn, ip string) error {
	u, err := s.FindUserByEmail(ctx, emailIn)
	if err != nil {
		// Silent: respond 200 either way to avoid email enumeration.
		// Burn comparable bcrypt time so response timing doesn't reveal whether
		// the account exists. Cost matches login's VerifyPassword path.
		equalizeResetTiming()
		return nil
	}
	raw, hash, err := GenerateRefreshToken()
	if err != nil {
		return err
	}
	ttl := parseDurationEnv("RESET_TOKEN_TTL", time.Hour)
	expAt := time.Now().Add(ttl)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
		VALUES ($1, $2, $3, $4)`, u.ID, hash, expAt, nilIfEmpty(ip))
	if err != nil {
		return err
	}
	origin := os.Getenv("FRONTEND_ORIGIN")
	link := origin + "/login/reset/confirm?token=" + raw
	_ = s.Mailer.SendResetLink(u.Email, link)
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, TenantID: &u.TenantID, Action: "auth.password_reset_requested", IPAddress: &ip})
	return nil
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, token, newPwd, ip string) error {
	hash := Sha256Hex(token)
	var id, userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1`, hash,
	).Scan(&id, &userID, &expiresAt, &usedAt)
	if err == pgx.ErrNoRows {
		return ErrTokenExpired
	}
	if err != nil {
		return err
	}
	if usedAt != nil || expiresAt.Before(time.Now()) {
		return ErrTokenExpired
	}

	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := ValidatePassword(newPwd, u.Email); err != nil {
		return err
	}
	pwHash, err := HashPassword(newPwd)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE users SET password_hash = $1, force_password_change = FALSE, password_changed_at = NOW(),
		                 failed_login_count = 0, locked_until = NULL
		WHERE id = $2`, pwHash, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE password_resets SET used_at = NOW() WHERE id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &userID, TenantID: &u.TenantID, Action: "auth.password_reset_completed", IPAddress: &ip})
	return nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
