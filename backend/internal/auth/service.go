package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/geo"
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
	// ErrSessionAnomaly — refresh detected a country or ASN drift
	// from the session's first_* baseline. The session family has
	// been revoked by the time this is returned; handler.Refresh
	// emits 401 + Problem.Code=CodeSessionAnomaly so the frontend
	// hardLogout cascade lands with a banner explaining the location
	// change. Distinct from ErrTokenExpired so callers can branch
	// on the specific failure if needed (audit-trail enrichment
	// already names the action 'auth.refresh_session_anomaly').
	ErrSessionAnomaly = errors.New("session anomaly")
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

	// JTICache backs RFC 9449 § 4.3 item 11 (DPoP proof jti replay
	// prevention). Wired by main.go to a Postgres-backed cache against
	// the dpop_jti_cache table (migration 212). Nil-safe for tests —
	// extractAndValidateUnboundProof and RequireAuth both skip the
	// replay-reservation step when JTICache is nil. Production always
	// has it set.
	JTICache *JTICache

	// Geo resolves an IP to country + ASN at login/refresh time.
	// Wired by main.go from env paths (GEOIP_CITY_DB, GEOIP_ASN_DB).
	// Nil-safe: when the receiver is nil OR the databases failed to
	// load, every lookup returns empty strings and the session-anomaly
	// drift check fails open (no enforcement signal, no false positive).
	// See TD-SEC-SESSION-ANOMALY and backend/internal/geo.
	Geo *geo.Resolver

	// OnLogin is invoked synchronously after a successful Login.
	// Used by Phase 3 to warm the library-releases reconciler cache for
	// the just-authenticated subscription. Wire from main.go to avoid an
	// auth → libraryreleases import cycle. Slice (not single fn) so
	// future cross-cutting concerns (presence, last-seen, analytics)
	// register without rewiring this hook.
	OnLogin []func(ctx context.Context, user *roletypes.User)
}

func NewService(pool *pgxpool.Pool, audit *audit.Logger, mailer *email.Service) *Service {
	return &Service{Pool: pool, Audit: audit, Mailer: mailer, JTICache: NewJTICache(pool)}
}

// sessionFingerprint is the bundle the session-anomaly layer
// (TD-SEC-SESSION-ANOMALY) captures at every login + refresh.
// Country and ASN may be "" when the MaxMind databases aren't loaded
// (dev without GEOIP_* env, or a private/loopback IP that doesn't
// resolve) — callers treat empty values as "no signal" and skip the
// drift check.
type sessionFingerprint struct {
	IP      string // raw IP (storing as text so audit_logs JSON keeps a clean string; sqlInsertSession casts to inet)
	UA      string // raw User-Agent string for forensics
	UAFP    string // base64url SHA-256(UA) for cheap equality
	Country string // ISO-3166-1 alpha-2, may be ""
	ASN     string // decimal string, may be ""
}

// buildFingerprint resolves the geo bundle and hashes the UA in one
// place so every auth-event emitter stays consistent. Nil-safe on
// Service.Geo — production wires a real Resolver; tests can leave
// it nil and the fingerprint just has empty country/ASN.
func (s *Service) buildFingerprint(ip, ua string) sessionFingerprint {
	fp := sessionFingerprint{IP: ip, UA: ua, UAFP: hashUA(ua)}
	if s != nil && s.Geo != nil {
		geoLookup := s.Geo.Resolve(ip)
		fp.Country = geoLookup.Country
		fp.ASN = geoLookup.ASN
	}
	return fp
}

// auditMetadata flattens the fingerprint plus the caller-supplied
// session_id (when known) into the map shape audit.Logger expects.
// Empty fields are still included so a downstream forensic query
// like `WHERE metadata->>'country' IS NULL` returns expected rows.
func (fp sessionFingerprint) auditMetadata(extra map[string]any) map[string]any {
	out := map[string]any{
		"ip":      fp.IP,
		"ua":      fp.UA,
		"ua_fp":   fp.UAFP,
		"country": fp.Country,
		"asn":     fp.ASN,
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// hashUA computes the SHA-256 of the User-Agent string as a base64url
// no-pad string. Used as a cheap-equality fingerprint to detect
// browser/device drift between login and refresh without storing
// the full UA in two places. Empty UA → empty hash (no signal).
func hashUA(ua string) string {
	if ua == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ua))
	return base64.RawURLEncoding.EncodeToString(sum[:])
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

// SessionState captures the per-request session signals RequireAuth needs
// alongside the user row. Revoked = user was signed out from another
// device or revoked by an admin. LastActivityAt = the timestamp the
// idle-timeout check compares NOW() against; COALESCE'd from
// users_sessions_rotated_at (set on every refresh) falling back to
// users_sessions_created_at for brand-new sessions that haven't rotated
// yet. B16.8.11 step 3.
type SessionState struct {
	Revoked        bool
	LastActivityAt time.Time
}

// FindUserBySessionID is the JOIN variant of FindUserByID used by
// RequireAuth when the access token carries a `sid` claim. Returns
// ErrNotFound when (id, sid) don't both resolve to a live row — the
// caller treats that as 401, identical wire shape to an expired token,
// so an attacker can't distinguish "user gone" from "session detached
// from user" from "session never existed." B16.8.11 step 3.
func (s *Service) FindUserBySessionID(ctx context.Context, userID, sessionID uuid.UUID) (*roletypes.User, SessionState, error) {
	u := &roletypes.User{}
	var st SessionState
	err := s.Pool.QueryRow(ctx, sqlSelectUserBySessionID, userID, sessionID).Scan(
		&u.ID, &u.SubscriptionID, &u.Email, &u.PasswordHash, &u.Role, &u.RoleID, &u.IsActive, &u.LastLogin,
		&u.AuthMethod, &u.LdapDN, &u.ForcePasswordChange, &u.PasswordChangedAt,
		&u.FailedLoginCount, &u.LockedUntil,
		&u.MFAEnrolled, &u.MFASecret, &u.MFARecoveryCodes,
		&u.CreatedAt, &u.UpdatedAt,
		&st.Revoked, &st.LastActivityAt,
	)
	if err == pgx.ErrNoRows {
		return nil, SessionState{}, ErrNotFound
	}
	return u, st, err
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

// dpopJKT (TD-SEC-DPOP-BINDING Phase 3) is the RFC 7638 thumbprint
// extracted by the handler from the inbound DPoP proof header. Stamped
// onto users_sessions_dpop_jkt and emitted as the access token's
// cnf.jkt claim. Empty string disables binding (test paths only) —
// production handlers always pass a non-empty thumbprint and would
// have already 401'd the request in the middleware-equivalent
// pre-handler check if the proof failed to parse.
func (s *Service) Login(ctx context.Context, emailIn, password, ip, ua, dpopJKT string) (*LoginResult, error) {
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

	raw, hash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	expAt := time.Now().Add(refreshTTL)

	// Order matters: insert the session row first so we can stamp the
	// returned users_sessions_id as the `sid` claim on the access token.
	// Reordered 2026-05-18 for B16.8.11 step 2.
	// TD-SEC-SESSION-ANOMALY: stamp the geo+UA fingerprint onto the
	// new row so subsequent refreshes can drift-check against this
	// baseline.
	fp := s.buildFingerprint(ip, ua)
	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua), dpopJKT,
		fp.IP, fp.ASN, fp.Country, fp.UAFP,
	).Scan(&sessID); err != nil {
		return nil, err
	}

	access, err := SignAccessToken(u, sessID, dpopJKT)
	if err != nil {
		return nil, err
	}

	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.login",
		IPAddress:      &ip,
		Metadata:       fp.auditMetadata(map[string]any{"session_id": sessID.String()}),
	})

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
// by Login(), which emitted the challenge token. dpopJKT semantics match
// Login: the handler-extracted thumbprint binds the new session and
// every subsequent access token minted from it.
func (s *Service) MFAVerifyLogin(ctx context.Context, challengeToken, code, ip, ua, dpopJKT string) (*LoginResult, error) {
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
	raw, hash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	expAt := time.Now().Add(refreshTTL)
	// Insert session row before signing the access token so the sid
	// claim points at this row (B16.8.11 step 2).
	// TD-SEC-SESSION-ANOMALY: same fingerprint stamp as Login.
	fp := s.buildFingerprint(ip, ua)
	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua), dpopJKT,
		fp.IP, fp.ASN, fp.Country, fp.UAFP,
	).Scan(&sessID); err != nil {
		return nil, err
	}
	access, err := SignAccessToken(u, sessID, dpopJKT)
	if err != nil {
		return nil, err
	}
	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.mfa_verify_success",
		IPAddress:      &ip,
		Metadata:       fp.auditMetadata(map[string]any{"session_id": sessID.String()}),
	})
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

// incomingJKT (TD-SEC-DPOP-BINDING Phase 4) is the RFC 7638 thumbprint
// from the DPoP proof the caller presented on the inbound refresh
// request. It MUST equal the session's stored users_sessions_dpop_jkt
// or the refresh is rejected as a binding-attack and the entire
// session family is revoked. RFC 9449 § 5 forbids mid-stream key
// rotation: the key that signed login is the only key allowed to
// refresh. Empty string is reserved for legacy sessions whose
// stored jkt is also empty (pre-DPoP) — those still work until
// Phase 6 cutover deletes them all.
func (s *Service) Refresh(ctx context.Context, rawRefresh, ip, ua, incomingJKT string) (*LoginResult, error) {
	hash := Sha256Hex(rawRefresh)

	var sessID, userID uuid.UUID
	var expiresAt time.Time
	var revoked bool
	var rotatedAt *time.Time
	var successorHash *string
	var boundJKT string           // RFC 9449 cnf.jkt inherited onto the new session
	var firstCountry, firstASN string // TD-SEC-SESSION-ANOMALY drift baseline
	err := s.Pool.QueryRow(ctx, sqlSelectSessionByHash, hash).
		Scan(&sessID, &userID, &expiresAt, &revoked, &rotatedAt, &successorHash, &boundJKT, &firstCountry, &firstASN)
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
			return s.refreshFromSuccessor(ctx, *successorHash, ip, ua, incomingJKT)
		}
		_, _ = s.Pool.Exec(ctx, sqlRevokeAllUserSessions, userID)
		s.Audit.Log(ctx, audit.Entry{UserID: &userID, Action: "auth.refresh_token_reuse", IPAddress: &ip, Metadata: map[string]any{"session_id": sessID.String()}})
		return nil, ErrTokenExpired
	}
	if expiresAt.Before(time.Now()) {
		return nil, ErrTokenExpired
	}
	// TD-SEC-DPOP-BINDING Phase 4 — refresh-token binding. The
	// session row's bound JKT was stamped at login; the inbound
	// proof's JKT must match it. A mismatch is the
	// "stolen-rt-from-another-device" attack — treat exactly like
	// the rotation reuse-detection path: revoke every session for
	// this user (forces re-login everywhere), audit-log it, return
	// the same generic ErrTokenExpired so no information leaks back
	// to the attacker about which check failed.
	//
	// Phase 6 cutover (migration 213) made users_sessions_dpop_jkt
	// NOT NULL, so boundJKT is always non-empty in production. The
	// `boundJKT != ""` guard is belt-and-braces against a hypothetical
	// future migration that re-introduces nullability — without it,
	// such a regression would silently disable refresh binding.
	if boundJKT != "" && incomingJKT != boundJKT {
		_, _ = s.Pool.Exec(ctx, sqlRevokeAllUserSessions, userID)
		s.Audit.Log(ctx, audit.Entry{
			UserID:    &userID,
			Action:    "auth.refresh_dpop_binding_violation",
			IPAddress: &ip,
			Metadata: map[string]any{
				"session_id":   sessID.String(),
				"bound_jkt":    boundJKT,
				"incoming_jkt": incomingJKT,
			},
		})
		return nil, ErrTokenExpired
	}

	// TD-SEC-SESSION-ANOMALY Stage 2 — geo drift detection. Resolve
	// the inbound IP's country + ASN; compare against the session's
	// first_country / first_asn baseline stamped at login. A change
	// in EITHER signal revokes the session family (same defence as
	// the DPoP binding violation above), audit-logs the drift with
	// both fingerprints, and emits Problem.Code=session_anomaly so
	// the frontend's hardLogout path can render an explanatory
	// banner on /login. Empty values from the baseline (geo DB not
	// loaded at login time) or the new lookup (DB went missing
	// since) skip the check on that axis — fail-open at the detection
	// layer is the correct stance to avoid locking out every user
	// when MaxMind data is unavailable.
	fp := s.buildFingerprint(ip, ua)
	driftCountry := firstCountry != "" && fp.Country != "" && firstCountry != fp.Country
	driftASN := firstASN != "" && fp.ASN != "" && firstASN != fp.ASN
	if driftCountry || driftASN {
		_, _ = s.Pool.Exec(ctx, sqlRevokeAllUserSessions, userID)
		s.Audit.Log(ctx, audit.Entry{
			UserID:    &userID,
			Action:    "auth.refresh_session_anomaly",
			IPAddress: &ip,
			Metadata: fp.auditMetadata(map[string]any{
				"session_id":     sessID.String(),
				"first_country":  firstCountry,
				"first_asn":      firstASN,
				"drift_country":  driftCountry,
				"drift_asn":      driftASN,
			}),
		})
		return nil, ErrSessionAnomaly
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
	// Inherit the DPoP binding from the old session row onto the new
	// one. RFC 9449 § 5 forbids mid-stream key rotation: every access
	// token minted from a refresh-token chain must carry the SAME
	// cnf.jkt as the original login. Phase 4 adds the proof-vs-binding
	// equality check; Phase 3 just preserves the value through rotation.
	// TD-SEC-SESSION-ANOMALY: also inherit the first_* fingerprints
	// from the parent session row so the drift baseline stays anchored
	// at the original login, not the rotation point. (We pass the OLD
	// firstCountry/firstASN here, not fp.* — Drift detection compares
	// against where the session STARTED, not where it last rotated.)
	var newSessID uuid.UUID
	if err := tx.QueryRow(ctx, sqlInsertSession,
		u.ID, newHash, newExp, nilIfEmpty(ip), nilIfEmpty(ua), boundJKT,
		fp.IP, firstASN, firstCountry, fp.UAFP,
	).Scan(&newSessID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	access, err := SignAccessToken(u, newSessID, boundJKT)
	if err != nil {
		return nil, err
	}
	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.token_refresh",
		IPAddress:      &ip,
		Metadata:       fp.auditMetadata(map[string]any{"session_id": newSessID.String(), "from_session_id": sessID.String()}),
	})
	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: newExp, SessionID: newSessID}, nil
}

// refreshFromSuccessor is called when a revoked token is reused within the
// grace window. It finds the successor session and re-issues tokens from it
// without rotating again, so concurrent tab bootstraps share one valid session.
// Same binding check as Refresh — the successor session's stored jkt must
// match the proof on the inbound request, otherwise we're dealing with a
// stolen-during-grace reuse and the whole family is revoked.
func (s *Service) refreshFromSuccessor(ctx context.Context, successorHash, ip, ua, incomingJKT string) (*LoginResult, error) {
	var sessID, userID uuid.UUID
	var expiresAt time.Time
	var revoked bool
	var boundJKT string // inherited binding for the re-emitted access token
	err := s.Pool.QueryRow(ctx, sqlSelectSuccessorSession, successorHash).
		Scan(&sessID, &userID, &expiresAt, &revoked, &boundJKT)
	if err == pgx.ErrNoRows || revoked || expiresAt.Before(time.Now()) {
		return nil, ErrTokenExpired
	}
	if err != nil {
		return nil, err
	}

	// Grace-window binding check (matches Refresh; same revoke + audit shape).
	if boundJKT != "" && incomingJKT != boundJKT {
		_, _ = s.Pool.Exec(ctx, sqlRevokeAllUserSessions, userID)
		s.Audit.Log(ctx, audit.Entry{
			UserID:    &userID,
			Action:    "auth.refresh_dpop_binding_violation_grace",
			IPAddress: &ip,
			Metadata: map[string]any{
				"session_id":   sessID.String(),
				"bound_jkt":    boundJKT,
				"incoming_jkt": incomingJKT,
			},
		})
		return nil, ErrTokenExpired
	}

	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Successor session is already live — stamp its id as the sid claim
	// and re-emit the same cnf.jkt the parent rotation set on the row.
	access, err := SignAccessToken(u, sessID, boundJKT)
	if err != nil {
		return nil, err
	}

	// Re-set the successor cookie so the caller's browser holds the current token.
	// We do NOT rotate again here — the successor is still live.
	// SessionID is the existing successor row id (loaded above) — no new
	// insert on this path, so we surface the row already in play.
	// TD-SEC-SESSION-ANOMALY: grace-window successor reuse skips the
	// drift check because the successor is by definition already
	// authenticated and bound — log the fingerprint for forensics but
	// don't enforce drift on this path (the parent Refresh already
	// did, or this is a legitimate tab race within REFRESH_GRACE_SECONDS).
	fp := s.buildFingerprint(ip, ua)
	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.token_refresh_grace",
		IPAddress:      &ip,
		Metadata:       fp.auditMetadata(map[string]any{"session_id": sessID.String()}),
	})
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
	// B16.8 P4 — HIBP breach-password check. No-op when
	// HIBP_CHECK_MODE=disabled (default); telemetry-only logs hits;
	// enforce returns ErrBreachedPassword which the handler maps to
	// a user-facing message.
	if err := s.CheckPasswordNotBreached(ctx, newPwd, userID); err != nil {
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
	// TD-SEC-RESET-TOKEN-FRAGMENT — email link now points at the backend
	// redeem endpoint (cookie handoff path). The redeem hop validates
	// the raw token server-side, sets a 5-min HttpOnly handoff cookie,
	// and 302s to /login/reset/confirm with no token in the address bar.
	// The raw token never lands in the user-visible URL, browser
	// history, Referer headers, or any client-side surface past the
	// initial GET.
	apiOrigin := os.Getenv("API_PUBLIC_ORIGIN")
	if apiOrigin == "" {
		apiOrigin = "http://localhost:5100"
	}
	link := apiOrigin + "/_site/auth/password-reset/redeem?t=" + raw
	_ = s.Mailer.SendPasswordReset(ctx, u.Email, link)
	s.Audit.Log(ctx, audit.Entry{UserID: &u.ID, SubscriptionID: &u.SubscriptionID, Action: "auth.password_reset_requested", IPAddress: &ip})
	return nil
}

// RedeemPasswordResetToken validates a raw reset token from the email
// link and returns the matching reset_id when alive. The id is then
// stamped into a signed handoff cookie by the redeem HTTP handler so
// the raw token can be dropped before the user-visible redirect to
// /login/reset/confirm (TD-SEC-RESET-TOKEN-FRAGMENT).
//
// Does NOT mark the row used — the row is only consumed at the
// confirm POST after a successful password set. This means a user
// can hit the redeem endpoint multiple times within the 1h reset
// TTL (e.g. they closed the tab after clicking the email link); only
// the final confirm POST burns the row.
func (s *Service) RedeemPasswordResetToken(ctx context.Context, token string) (uuid.UUID, error) {
	hash := Sha256Hex(token)
	var id, userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.Pool.QueryRow(ctx, sqlSelectPasswordResetByHash, hash).
		Scan(&id, &userID, &expiresAt, &usedAt)
	if err == pgx.ErrNoRows {
		return uuid.Nil, ErrTokenExpired
	}
	if err != nil {
		return uuid.Nil, err
	}
	if usedAt != nil || expiresAt.Before(time.Now()) {
		return uuid.Nil, ErrTokenExpired
	}
	return id, nil
}

// ConfirmPasswordResetByID is the cookie-handoff confirm path. The
// caller has already proven possession of the raw token (via the
// redeem endpoint) and now carries reset_id in a signed cookie.
// Same row-lookup + transaction shape as ConfirmPasswordReset but
// looks the row up by id rather than by hashed token.
func (s *Service) ConfirmPasswordResetByID(ctx context.Context, resetID uuid.UUID, newPwd, ip string) error {
	var id, userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.Pool.QueryRow(ctx, sqlSelectPasswordResetByID, resetID).
		Scan(&id, &userID, &expiresAt, &usedAt)
	if err == pgx.ErrNoRows {
		return ErrTokenExpired
	}
	if err != nil {
		return err
	}
	return s.applyPasswordReset(ctx, id, userID, expiresAt, usedAt, newPwd, ip)
}

// ConfirmPasswordReset is the legacy token-in-body path. Retained for
// back-compat in case any out-of-band caller (mobile client,
// integration test) still POSTs the raw token directly. The browser
// frontend uses the handoff flow above. Remove this once we've
// confirmed no live caller depends on it.
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
	return s.applyPasswordReset(ctx, id, userID, expiresAt, usedAt, newPwd, ip)
}

// applyPasswordReset is the shared core: validate expiry/used, validate
// new-password policy, hash, update + mark-used + revoke-sessions in
// one tx, audit + notify. Both confirm paths funnel through here.
func (s *Service) applyPasswordReset(
	ctx context.Context,
	id, userID uuid.UUID,
	expiresAt time.Time,
	usedAt *time.Time,
	newPwd, ip string,
) error {
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
	// B16.8 P4 — HIBP breach-password check (same gate as ChangePassword).
	// Reset flow already knows the userID via the token row, so the audit
	// entry can be attributed even though the request is unauthenticated.
	if err := s.CheckPasswordNotBreached(ctx, newPwd, userID); err != nil {
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
func (s *Service) SwitchWorkspace(ctx context.Context, u *roletypes.User, workspaceID uuid.UUID, ip, ua, dpopJKT string) (*LoginResult, error) {
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

	raw, hash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
	expAt := time.Now().Add(refreshTTL)

	// Insert session row first so we can stamp its id as the sid claim
	// (B16.8.11 step 2). SwitchWorkspace mints a fresh session so the
	// old workspace context doesn't leak across the cut. dpopJKT
	// (Phase 3) is the same thumbprint the caller's outgoing request
	// already carries — RequireAuth verified the proof above, so by
	// the time SwitchWorkspace is invoked we know the binding is good.
	// TD-SEC-SESSION-ANOMALY: stamp a fresh fingerprint baseline on
	// the new session. The user has just proved DPoP possession at
	// the current IP, so this IP becomes the new drift baseline —
	// not the parent session's, since SwitchWorkspace mints a fresh
	// row, not a rotation.
	fp := s.buildFingerprint(ip, ua)
	var sessID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertSession,
		u.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(ua), dpopJKT,
		fp.IP, fp.ASN, fp.Country, fp.UAFP,
	).Scan(&sessID); err != nil {
		return nil, err
	}

	access, err := SignAccessToken(u, sessID, dpopJKT)
	if err != nil {
		return nil, err
	}

	s.Audit.Log(ctx, audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.workspace_switched",
		IPAddress:      &ip,
		Metadata: fp.auditMetadata(map[string]any{
			"workspace_id": workspaceID.String(),
			"session_id":   sessID.String(),
		}),
	})

	return &LoginResult{User: u, AccessToken: access, RefreshRaw: raw, RefreshExpAt: expAt, SessionID: sessID}, nil
}

// ── B16.8.10 active sessions UI ──────────────────────────────────────────

// SessionRow is the shape ListSessionsForUser returns. Sorted by
// last activity (most-recent first). IPAddress / UserAgent are
// pointers because they're nullable on the underlying table.
type SessionRow struct {
	ID             uuid.UUID
	CreatedAt      time.Time
	LastActivityAt time.Time
	IPAddress      *string
	UserAgent      *string
}

// ListSessionsForUser returns every live session owned by userID.
// "Live" = not revoked AND not expired. The handler marks which row
// matches the requester's sid claim.
func (s *Service) ListSessionsForUser(ctx context.Context, userID uuid.UUID) ([]SessionRow, error) {
	rows, err := s.Pool.Query(ctx, sqlSelectSessionsForUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionRow
	for rows.Next() {
		var r SessionRow
		if err := rows.Scan(&r.ID, &r.CreatedAt, &r.LastActivityAt, &r.IPAddress, &r.UserAgent); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RevokeSession flips users_sessions_revoked=true on a single session,
// but only if it belongs to actorID. Returns (rowsAffected, err) — 0
// covers both "doesn't exist" and "exists but belongs to someone else"
// so the handler responds with the same 404 either way.
func (s *Service) RevokeSession(ctx context.Context, sessionID, actorID uuid.UUID) (int64, error) {
	tag, err := s.Pool.Exec(ctx, sqlRevokeSessionByIDForUser, sessionID, actorID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RevokeOtherSessions revokes every live session for actorID EXCEPT
// keepSessionID (typically the caller's current sid). Returns the
// number of rows revoked so the handler can include it in the audit
// entry.
func (s *Service) RevokeOtherSessions(ctx context.Context, actorID, keepSessionID uuid.UUID) (int64, error) {
	tag, err := s.Pool.Exec(ctx, sqlRevokeOtherSessionsForUser, actorID, keepSessionID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ── B16.8.10 step-up reauth ──────────────────────────────────────────────

// reauthNonceTTL is how long a freshly-issued reauth_proof remains
// valid. 60 seconds is the canonical window for "user clicked a
// sensitive button, typed their password, now sends the actual
// request" — short enough that a captured proof has narrow blast
// radius, long enough to ride out a slow network or a confirm modal.
const reauthNonceTTL = 60 * time.Second

// IssueReauthNonce verifies password (+ TOTP if mfaEnrolled) for
// actorID, then inserts a fresh users_reauth_nonces row bound to
// actionKey. Returns (nonceID, err) — caller HMAC-signs (nonceID +
// userID + actionKey + expiresAt) to form the action_proof the
// frontend submits with the sensitive request.
func (s *Service) IssueReauthNonce(ctx context.Context, actorID uuid.UUID, password, totpCode, actionKey string) (uuid.UUID, error) {
	u, err := s.FindUserByID(ctx, actorID)
	if err != nil {
		return uuid.Nil, err
	}
	if !VerifyPassword(u.PasswordHash, password) {
		return uuid.Nil, ErrInvalidCredentials
	}
	if u.MFAEnrolled {
		if totpCode == "" {
			return uuid.Nil, ErrMFAInvalidCode
		}
		if err := s.MFAVerifyCode(ctx, u, totpCode); err != nil {
			return uuid.Nil, ErrMFAInvalidCode
		}
	}
	var nonceID uuid.UUID
	if err := s.Pool.QueryRow(ctx, sqlInsertReauthNonce,
		actorID, actionKey, time.Now().Add(reauthNonceTTL),
	).Scan(&nonceID); err != nil {
		return uuid.Nil, err
	}
	return nonceID, nil
}

// ConsumeReauthNonce atomically marks the nonce consumed. Returns
// (ok, err): ok=true means the nonce was valid + bound to actorID +
// matched actionKey + unconsumed + unexpired, and is now consumed;
// ok=false means at least one of those failed and the caller must
// respond with reauth_required (single-use enforcement).
func (s *Service) ConsumeReauthNonce(ctx context.Context, nonceID, actorID uuid.UUID, actionKey string) (bool, error) {
	tag, err := s.Pool.Exec(ctx, sqlConsumeReauthNonce, nonceID, actorID, actionKey)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
