package auth

import (
	"context"
	"errors"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountLocked      = errors.New("account locked")
	ErrAccountInactive    = errors.New("account inactive")
	ErrNotFound           = errors.New("not found")
	ErrTokenExpired       = errors.New("token expired or used")
	// ErrWorkspaceForbidden — caller asked SwitchWorkspace for a
	// workspace that either doesn't exist, lives in another subscription,
	// or carries no live role grant for this user. Single sentinel for
	// all three so we don't leak existence (PLA-0053 / story 00576.5).
	ErrWorkspaceForbidden = errors.New("workspace forbidden")
)

// PermissionResolver is the small surface auth.Service needs from the
// permissions package — kept narrow so the handler doesn't have to keep
// holding the resolver itself just to render userPayload. Anything that
// can answer "what permissions does this user have?" satisfies it.
//
// Returns codes as `[]string` (sorted) — auth doesn't need typed codes
// for rendering and this keeps the auth → permissions edge one-way
// (resolver consumes auth's user model, auth consumes a tiny string-list
// projection). The resolver implements this via PermissionCodesFor.
type PermissionResolver interface {
	PermissionCodesFor(ctx context.Context, userID uuid.UUID) ([]string, error)
}

type Service struct {
	Pool     *pgxpool.Pool
	Audit    *audit.Logger
	Mailer   *email.Service
	Resolver PermissionResolver

	// OnLogin is invoked synchronously after a successful Login.
	// Used by Phase 3 to warm the library-releases reconciler cache for
	// the just-authenticated subscription. Wire from main.go to avoid an
	// auth → libraryreleases import cycle. Slice (not single fn) so
	// future cross-cutting concerns (presence, last-seen, analytics)
	// register without rewiring this hook.
	OnLogin []func(ctx context.Context, user *roletypes.User)
}

func NewService(pool *pgxpool.Pool, audit *audit.Logger, mailer *email.Service) *Service {
	return &Service{Pool: pool, Audit: audit, Mailer: mailer}
}

// RolePayload is the wire shape for users.role on auth responses
// (login, refresh, /me). Frontend RBAC reads code/rank/is_external
// directly so it never has to translate the legacy enum into capability.
type RolePayload struct {
	ID         uuid.UUID `json:"id"`
	Code       string    `json:"code"`
	Label      string    `json:"label"`
	Rank       int       `json:"rank"`
	IsSystem   bool      `json:"is_system"`
	IsExternal bool      `json:"is_external"`
}

// LoadRoleAndPermissions returns the user's role row and effective
// permission codes. Returns a zero RolePayload + empty slice (no error)
// rather than failing if the lookup hiccups — auth-payload rendering must
// not break because the catalogue is briefly unavailable.
func (s *Service) LoadRoleAndPermissions(ctx context.Context, userID uuid.UUID) (RolePayload, []string) {
	var roleID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlSelectUserRoleID, userID).Scan(&roleID); err != nil {
		return RolePayload{}, []string{}
	}
	var rp RolePayload
	if err := s.Pool.QueryRow(ctx, sqlSelectRoleByID, roleID).
		Scan(&rp.ID, &rp.Code, &rp.Label, &rp.Rank, &rp.IsSystem, &rp.IsExternal); err != nil {
		return RolePayload{}, []string{}
	}
	perms := []string{}
	if s.Resolver != nil {
		if codes, err := s.Resolver.PermissionCodesFor(ctx, userID); err == nil {
			perms = codes
			sort.Strings(perms)
		}
	}
	return rp, perms
}

func (s *Service) FindUserByEmail(ctx context.Context, email string) (*roletypes.User, error) {
	u := &roletypes.User{}
	err := s.Pool.QueryRow(ctx, sqlSelectUserByEmail, email).Scan(
		&u.ID, &u.SubscriptionID, &u.Email, &u.PasswordHash, &u.Role, &u.RoleID, &u.IsActive, &u.LastLogin,
		&u.AuthMethod, &u.LdapDN, &u.ForcePasswordChange, &u.PasswordChangedAt,
		&u.FailedLoginCount, &u.LockedUntil,
		&u.MFAEnrolled, &u.MFASecret, &u.MFARecoveryCodes,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Service) FindUserByID(ctx context.Context, id uuid.UUID) (*roletypes.User, error) {
	u := &roletypes.User{}
	err := s.Pool.QueryRow(ctx, sqlSelectUserByID, id).Scan(
		&u.ID, &u.SubscriptionID, &u.Email, &u.PasswordHash, &u.Role, &u.RoleID, &u.IsActive, &u.LastLogin,
		&u.AuthMethod, &u.LdapDN, &u.ForcePasswordChange, &u.PasswordChangedAt,
		&u.FailedLoginCount, &u.LockedUntil,
		&u.MFAEnrolled, &u.MFASecret, &u.MFARecoveryCodes,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

type LoginResult struct {
	User         *roletypes.User
	AccessToken  string
	RefreshRaw   string
	RefreshExpAt time.Time
	// SessionID is the users_sessions row id created (or reused on the
	// successor-grace path) for this login. Populated by every session-
	// issuing entry path: Login, MFAVerifyLogin, Refresh (rotation),
	// refreshFromSuccessor (existing row), SwitchWorkspace. Read by
	// SignAccessToken (B16.8.11 step 2) to stamp the `sid` claim onto
	// the JWT so RequireAuth can per-request check users_sessions for
	// revocation/idle eviction.
	SessionID uuid.UUID
	// MFA challenge path — set when mfa_enrolled=true.
	// MFARequired=true means no refresh cookie should be set; the caller
	// must redirect the user to POST /auth/mfa/verify with MFAChallengeToken.
	MFARequired        bool
	MFAChallengeToken  string
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
	if envInt("LOCKOUT_THRESHOLD", 5) > 0 && u.LockedUntil != nil && u.LockedUntil.After(time.Now()) {
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.login_failed", IPAddress: &ip, Metadata: map[string]any{"reason": "locked"}})
		return nil, ErrAccountLocked
	}

	if !VerifyPassword(u.PasswordHash, password) {
		s.recordFailedLogin(ctx, u, ip)
		return nil, ErrInvalidCredentials
	}

	// Success: reset lockout state, stamp last_login.
	_, _ = s.Pool.Exec(ctx, sqlClearLockoutAndStampLogin, u.ID)

	// B16.8.2 — MFA challenge gate. Password is valid but enrollment is
	// complete: return a short-lived challenge token instead of a full
	// session. The caller must POST /auth/mfa/verify to exchange it.
	// No refresh cookie, no session row, no OnLogin hooks at this stage.
	if u.MFAEnrolled {
		challengeToken, cerr := SignChallengeToken(u.ID)
		if cerr != nil {
			return nil, cerr
		}
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.mfa_challenge_issued", IPAddress: &ip})
		return &LoginResult{User: u, MFARequired: true, MFAChallengeToken: challengeToken}, nil
	}

	// PLA-0053 / story 00575: attach the user's first live workspace
	// to the JWT claim. Failure (no workspaces yet, DB error) is
	// non-fatal — the access token signs without a workspace_id claim
	// and WorkspaceClampMiddleware falls back to FirstLiveWorkspace
	// per the legacy-token rollout window. Login itself never blocks
	// on workspace resolution.
	if wsID, werr := s.resolveDefaultWorkspace(ctx, u.SubscriptionID); werr == nil {
		u.WorkspaceID = wsID
	}

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

	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua),
	).Scan(&sessID); err != nil {
		return nil, err
	}

	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.login", IPAddress: &ip})

	// Fire post-login hooks (cache warming, presence, etc.). Errors
	// inside hooks are the hook's own responsibility — Login's contract
	// is "credentials accepted", not "every downstream cache primed".
	for _, h := range s.OnLogin {
		h(ctx, u)
	}

	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: expAt, SessionID: sessID}, nil
}

// MFAVerifyLogin exchanges a challenge token + TOTP/recovery code for a
// full LoginResult (access token + refresh session). This is the second
// factor of the two-step login — the first factor (password) was validated
// by Login(), which emitted the challenge token.
func (s *Service) MFAVerifyLogin(ctx context.Context, challengeToken, code, ip, ua string) (*LoginResult, error) {
	claims, err := ParseChallengeToken(challengeToken)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	if !u.MFAEnrolled {
		return nil, ErrMFANotEnrolled
	}
	if err := s.MFAVerifyCode(ctx, u, code); err != nil {
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.mfa_verify_failed", IPAddress: &ip})
		return nil, ErrMFAInvalidCode
	}

	// MFA passed — issue full session (mirrors the non-MFA Login tail).
	if wsID, werr := s.resolveDefaultWorkspace(ctx, u.SubscriptionID); werr == nil {
		u.WorkspaceID = wsID
	}
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
	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession, u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua)).Scan(&sessID); err != nil {
		return nil, err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.mfa_verify_success", IPAddress: &ip})
	for _, h := range s.OnLogin {
		h(ctx, u)
	}
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: expAt, SessionID: sessID}, nil
}

func (s *Service) recordFailedLogin(ctx context.Context, u *roletypes.User, ip string) {
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.login_failed", IPAddress: &ip})
	threshold := envInt("LOCKOUT_THRESHOLD", 5)
	if threshold == 0 {
		return
	}
	dur := parseDurationEnv("LOCKOUT_DURATION", 15*time.Minute)
	newCount := u.FailedLoginCount + 1
	if newCount >= threshold {
		lockUntil := time.Now().Add(dur)
		_, _ = s.Pool.Exec(ctx, sqlBumpFailedLoginAndLock, newCount, lockUntil, u.ID)
		s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.account_locked", IPAddress: &ip})
	} else {
		_, _ = s.Pool.Exec(ctx, sqlBumpFailedLogin, newCount, u.ID)
	}
}

func (s *Service) Refresh(ctx context.Context, rawRefresh, ip, ua string) (*LoginResult, error) {
	hash := Sha256Hex(rawRefresh)

	var sessID, userID uuid.UUID
	var expiresAt time.Time
	var revoked bool
	var rotatedAt *time.Time
	var successorHash *string
	err := s.Pool.QueryRow(ctx, sqlSelectSessionByHash, hash).
		Scan(&sessID, &userID, &expiresAt, &revoked, &rotatedAt, &successorHash)
	if err == pgx.ErrNoRows {
		return nil, ErrTokenExpired
	}
	if err != nil {
		return nil, err
	}
	if revoked {
		// Grace-window check: duplicate tabs and HMR both send the same rt cookie
		// immediately after rotation. If the old token was rotated within the grace
		// window AND has a known successor, return the successor session instead of
		// treating this as theft. Outside the window (or with no successor), it IS
		// a reuse attack → nuke all sessions.
		graceSecs := parseDurationEnv("REFRESH_GRACE_SECONDS", 30*time.Second)
		if rotatedAt != nil && successorHash != nil && time.Since(*rotatedAt) <= graceSecs {
			return s.refreshFromSuccessor(ctx, *successorHash, ip, ua)
		}
		_, _ = s.Pool.Exec(ctx, sqlRevokeAllUserSessions, userID)
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

	// Rotate: revoke old (stamping rotation metadata), insert new.
	raw, newHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	newExp := time.Now().Add(refreshTTL)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, sqlRotateSession, newHash, sessID); err != nil {
		return nil, err
	}
	var newSessID uuid.UUID
	if err := tx.QueryRow(ctx, sqlInsertSession,
		u.ID, newHash, newExp, nilIfEmpty(ip), nilIfEmpty(ua),
	).Scan(&newSessID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	access, err := SignAccessToken(u)
	if err != nil {
		return nil, err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.token_refresh", IPAddress: &ip})
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: newExp, SessionID: newSessID}, nil
}

// refreshFromSuccessor is called when a revoked token is reused within the
// grace window. It finds the successor session and re-issues tokens from it
// without rotating again, so concurrent tab bootstraps share one valid session.
func (s *Service) refreshFromSuccessor(ctx context.Context, successorHash, ip, ua string) (*LoginResult, error) {
	var sessID, userID uuid.UUID
	var expiresAt time.Time
	var revoked bool
	err := s.Pool.QueryRow(ctx, sqlSelectSuccessorSession, successorHash).
		Scan(&sessID, &userID, &expiresAt, &revoked)
	if err == pgx.ErrNoRows || revoked || expiresAt.Before(time.Now()) {
		return nil, ErrTokenExpired
	}
	if err != nil {
		return nil, err
	}

	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	access, err := SignAccessToken(u)
	if err != nil {
		return nil, err
	}

	// Re-set the successor cookie so the caller's browser holds the current token.
	// We do NOT rotate again here — the successor is still live.
	// SessionID is the existing successor row id (loaded above) — no new
	// insert on this path, so we surface the row already in play.
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.token_refresh_grace", IPAddress: &ip})
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: "", RefreshExpAt: expiresAt, SessionID: sessID}, nil
}

func (s *Service) Logout(ctx context.Context, rawRefresh, ip string) error {
	if rawRefresh == "" {
		return nil
	}
	hash := Sha256Hex(rawRefresh)
	var userID uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlRevokeSessionByHashReturningUser, hash).
		Scan(&userID)
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
	if _, err := tx.Exec(ctx, sqlUpdatePasswordHashAndClearForceFlag, hash, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlRevokeAllUserSessions, userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &userID, SubscriptionID: &u.SubscriptionID, Action: "auth.password_change", IPAddress: &ip})
	_ = s.Mailer.SendPasswordChanged(ctx, u.Email)
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
	_, err = s.Pool.Exec(ctx, sqlInsertPasswordReset, u.ID, hash, expAt, nilIfEmpty(ip))
	if err != nil {
		return err
	}
	origin := os.Getenv("FRONTEND_ORIGIN")
	link := origin + "/login/reset/confirm?token=" + raw
	_ = s.Mailer.SendPasswordReset(ctx, u.Email, link)
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.password_reset_requested", IPAddress: &ip})
	return nil
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, token, newPwd, ip string) error {
	hash := Sha256Hex(token)
	var id, userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.Pool.QueryRow(ctx, sqlSelectPasswordResetByHash, hash).
		Scan(&id, &userID, &expiresAt, &usedAt)
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
	if _, err := tx.Exec(ctx, sqlUpdatePasswordHashAndClearLockout, pwHash, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlMarkPasswordResetUsed, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlRevokeAllUserSessions, userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: &userID, SubscriptionID: &u.SubscriptionID, Action: "auth.password_reset_completed", IPAddress: &ip})
	_ = s.Mailer.SendPasswordChanged(ctx, u.Email)
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

// resolveDefaultWorkspace returns the subscription's first live workspace
// (earliest created_at) — same predicate as topology.PoolWorkspaceLookup's
// FirstLiveWorkspace. The SQL lives in sql.go (sqlSelectFirstLiveWorkspaceID)
// per the lint:sql-in-sqlfile-only rule. Kept inside auth package rather
// than importing topology so the dependency edge stays one-way (topology
// → auth, never auth → topology).
//
// Called at login time to seed the JWT's workspace_id claim (PLA-0053 /
// story 00575). Non-fatal: failures return the zero UUID + error and the
// caller signs without a workspace_id claim — WorkspaceClampMiddleware
// falls back to FirstLiveWorkspace per the legacy-token rollout window.
func (s *Service) resolveDefaultWorkspace(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlSelectFirstLiveWorkspaceID, subscriptionID).Scan(&id); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// SwitchWorkspace re-mints the access token + rotates the refresh
// session with the target workspace stamped into the JWT claim.
// PLA-0053 / story 00576.5.
//
// Authoritative membership check (sqlAssertWorkspaceMemberLive) runs
// in one round trip and excludes:
//   - workspaces in another subscription (cross-tenant leak guard),
//   - archived workspaces,
//   - users with no non-revoked users_roles_workspaces grant.
//
// All three failure modes collapse to ErrWorkspaceForbidden so the
// handler returns the same 403 regardless of root cause (no existence
// leak — same shape as fields.AssertCallerMayRead). On success, the
// returned LoginResult carries a new access token + rotated refresh
// raw; the handler updates the rt cookie + returns the userPayload
// the frontend uses to refresh AuthContext.
//
// The original refresh session is NOT revoked here — only rotated.
// This keeps the user logged in if the new JWT fails to round-trip
// for any reason; the previous session expires normally on its TTL.
func (s *Service) SwitchWorkspace(ctx context.Context, u *roletypes.User, workspaceID uuid.UUID, ip, ua string) (*LoginResult, error) {
	if u == nil {
		return nil, ErrInvalidCredentials
	}

	var ok int
	err := s.Pool.QueryRow(ctx, sqlAssertWorkspaceMemberLive,
		u.SubscriptionID, workspaceID, u.ID,
	).Scan(&ok)
	if err != nil {
		// pgx.ErrNoRows is the expected miss; any other err is also
		// collapsed to forbidden so SQL hiccups don't leak.
		return nil, ErrWorkspaceForbidden
	}

	// Re-stamp the user's workspace before signing — the new JWT claim
	// comes off this struct.
	u.WorkspaceID = workspaceID

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

	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua),
	).Scan(&sessID); err != nil {
		return nil, err
	}

	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.workspace_switched",
		IPAddress:      &ip,
		Metadata:       map[string]any{"workspace_id": workspaceID.String()},
	})

	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: expAt, SessionID: sessID}, nil
}
