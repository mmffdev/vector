// Package auth SQL constants.
//
// PLA-0048 / RF1.2.2. Every SQL string literal used by the auth
// package lives here as a named constant. The service file references
// these constants; it DOES NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlSelectUserByEmail, sqlInsertSession,
// sqlUpdateSessionRevoked, etc.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// All reads/writes target the mmff_vector pool via s.Pool — auth is
// single-DB (membership/credentials/users_sessions/password-resets all
// live in mmff_vector).
package auth

// ── role + permission lookups (LoadRoleAndPermissions) ──────────────────────

// sqlSelectUserRoleID resolves a user's role_id. The auth payload
// renderer joins this against `users_roles` via sqlSelectRoleByID.
const sqlSelectUserRoleID = `SELECT role_id FROM users WHERE id = $1`

// sqlSelectRoleByID hydrates the RolePayload wire shape (code, label,
// rank, system/external flags) returned to the frontend on every auth
// response (login, refresh, /me).
const sqlSelectRoleByID = `
		SELECT users_roles_id,
		       users_roles_code,
		       users_roles_label,
		       users_roles_rank,
		       users_roles_is_system,
		       users_roles_is_external
		  FROM users_roles
		 WHERE users_roles_id = $1
	`

// ── user hydration (FindUserByEmail, FindUserByID) ──────────────────────────

// sqlSelectUserByEmail returns the full user row for a given email.
// Used by Login + RequestPasswordReset. Includes MFA columns added in
// 003_mfa_scaffold.sql.
const sqlSelectUserByEmail = `
		SELECT id, subscription_id, email, password_hash, role, role_id, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until,
		       mfa_enrolled, mfa_secret, mfa_recovery_codes,
		       created_at, updated_at
		FROM users WHERE email = $1
	`

// sqlSelectUserByID returns the full user row for a given UUID. Used
// by Refresh / ConfirmPasswordReset / ChangePassword post-token-validation.
// Includes MFA columns added in 003_mfa_scaffold.sql.
const sqlSelectUserByID = `
		SELECT id, subscription_id, email, password_hash, role, role_id, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until,
		       mfa_enrolled, mfa_secret, mfa_recovery_codes,
		       created_at, updated_at
		FROM users WHERE id = $1
	`

// sqlSelectUserBySessionID returns the same user columns as
// sqlSelectUserByID plus the session revoked + rotated_at signals so
// RequireAuth (B16.8.11 step 3) can per-request reject revoked or
// idle-expired sessions in a single roundtrip (no extra DB hit beyond
// what middleware already pays). Joins on users.id = users_sessions_id_user
// AND filters by users_sessions_id = $2 so the row corresponds to THIS
// specific session, not any session the user holds. Returns zero rows
// when the sid is unknown, the session belongs to a different user, or
// the user row has been deleted — caller treats that as 401 (the same
// shape an expired access token already produces).
const sqlSelectUserBySessionID = `
		SELECT u.id, u.subscription_id, u.email, u.password_hash, u.role, u.role_id, u.is_active, u.last_login,
		       u.auth_method, u.ldap_dn, u.force_password_change, u.password_changed_at,
		       u.failed_login_count, u.locked_until,
		       u.mfa_enrolled, u.mfa_secret, u.mfa_recovery_codes,
		       u.created_at, u.updated_at,
		       s.users_sessions_revoked,
		       COALESCE(s.users_sessions_rotated_at, s.users_sessions_created_at) AS last_activity_at
		FROM users u
		JOIN users_sessions s
		  ON s.users_sessions_id_user = u.id
		 AND s.users_sessions_id      = $2
		WHERE u.id = $1
	`

// sqlSelectServiceUserForSubscription returns the highest-tier active
// user row for a subscription. Used by apikeys.Middleware to synthesise
// the auth.UserFromCtx() context when a `sam_live_*` bearer token
// authenticates a request on /_site — handlers downstream read the
// User to drive permission checks, audit attribution, and scope clamps.
//
// Ordering: users_roles.users_roles_rank ASC (lower rank = higher tier
// in the project's convention — see roles/sql.go). When two users
// share the same role, prefer the oldest (most stable) account.
//
// Sentinel for "no usable user on this subscription" is pgx.ErrNoRows;
// caller (apikeys.Middleware) maps that to 401 with a clear message.
const sqlSelectServiceUserForSubscription = `
		SELECT u.id, u.subscription_id, u.email, u.password_hash, u.role, u.role_id, u.is_active, u.last_login,
		       u.auth_method, u.ldap_dn, u.force_password_change, u.password_changed_at,
		       u.failed_login_count, u.locked_until,
		       u.mfa_enrolled, u.mfa_secret, u.mfa_recovery_codes,
		       u.created_at, u.updated_at
		FROM users u
		JOIN users_roles ur ON ur.users_roles_id = u.role_id
		WHERE u.subscription_id = $1
		  AND u.is_active = TRUE
		ORDER BY ur.users_roles_rank ASC, u.created_at ASC
		LIMIT 1
	`

// ── login lifecycle (Login, recordFailedLogin) ──────────────────────────────

// sqlClearLockoutAndStampLogin resets failed_login_count + locked_until
// and stamps last_login=NOW() after a successful credential check.
const sqlClearLockoutAndStampLogin = `
		UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login = NOW()
		WHERE id = $1
	`

// sqlInsertSession opens a new refresh-token session row. token_hash is
// the SHA-256 of the raw refresh token (raw never persists). Used by
// Login and the rotation path in Refresh. RETURNING users_sessions_id
// added 2026-05-18 for B16.8.11 step 1 — callers capture the id and
// surface it via LoginResult.SessionID so step 2 can stamp it onto the
// access JWT as the `sid` claim.
//
// users_sessions_dpop_jkt ($6, TD-SEC-DPOP-BINDING Phase 3) holds the
// RFC 7638 thumbprint of the DPoP key the client presented on the
// inbound /auth/login. Stamped here so every token rotation through
// the lifetime of this session can re-emit cnf.jkt with the same
// value, and so /auth/refresh can verify the incoming proof's
// thumbprint matches the session's bound key (Phase 4). Nullable on
// the column until Phase 6 cutover; '' in Go scans as a NULL skip
// thanks to pgtype's empty-string handling — callers that genuinely
// have no thumbprint pass "".
//
// users_sessions_first_* ($7..$10, TD-SEC-SESSION-ANOMALY) capture
// the geo+UA fingerprint at session creation so subsequent refreshes
// have a baseline to detect drift against. ip is INET; the other
// three are text (ASN as decimal string, country as ISO-3166-1
// alpha-2, UA fingerprint as base64url SHA-256). NULLIF on each
// preserves NULL semantics when the geo lookup failed.
const sqlInsertSession = `
		INSERT INTO users_sessions (
			users_sessions_id_user,
			users_sessions_token_hash,
			users_sessions_expires_at,
			users_sessions_ip_address,
			users_sessions_user_agent,
			users_sessions_dpop_jkt,
			users_sessions_first_ip,
			users_sessions_first_asn,
			users_sessions_first_country,
			users_sessions_first_ua_fp
		)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''),
		        NULLIF($7, '')::inet, NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''))
		RETURNING users_sessions_id
	`

// sqlBumpFailedLoginAndLock raises failed_login_count to $1 AND stamps
// locked_until=$2 — used when the failure crosses LOCKOUT_THRESHOLD.
const sqlBumpFailedLoginAndLock = `
		UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3
	`

// sqlBumpFailedLogin raises failed_login_count without locking (sub-
// threshold failure path).
const sqlBumpFailedLogin = `UPDATE users SET failed_login_count = $1 WHERE id = $2`

// ── refresh-token rotation (Refresh, refreshFromSuccessor) ──────────────────

// sqlSelectSessionByHash returns the rotation-aware session row for a
// token_hash (revoked + rotated_at + successor_hash needed for the
// grace-window decision). users_sessions_dpop_jkt added in Phase 3 so
// the rotation path inherits the binding onto the new session row
// without a separate query — Phase 4 also uses the value to verify
// the incoming proof's thumbprint matches the bound key.
// users_sessions_first_country / first_asn (TD-SEC-SESSION-ANOMALY)
// are read on every refresh so Service.Refresh can compare the
// inbound IP's country+ASN against the row's baseline and trigger a
// step-up reauth when they drift.
const sqlSelectSessionByHash = `
		SELECT users_sessions_id,
		       users_sessions_id_user,
		       users_sessions_expires_at,
		       users_sessions_revoked,
		       users_sessions_rotated_at,
		       users_sessions_successor_hash,
		       COALESCE(users_sessions_dpop_jkt, ''),
		       COALESCE(users_sessions_first_country, ''),
		       COALESCE(users_sessions_first_asn, '')
		  FROM users_sessions
		 WHERE users_sessions_token_hash = $1
	`

// sqlRevokeAllUserSessions revokes every session for a user. Used by
// the reuse-attack response (Refresh) and by Logout/ChangePassword/
// ConfirmPasswordReset side-effects.
const sqlRevokeAllUserSessions = `UPDATE users_sessions SET users_sessions_revoked = TRUE WHERE users_sessions_id_user = $1`

// sqlRotateSession marks the current session revoked + stamps
// rotation metadata (rotated_at, successor_hash) so a concurrent reuse
// inside the grace window can be resolved to the successor instead of
// triggering reuse-attack revocation.
const sqlRotateSession = `
		UPDATE users_sessions
		   SET users_sessions_revoked        = TRUE,
		       users_sessions_rotated_at     = NOW(),
		       users_sessions_successor_hash = $1
		 WHERE users_sessions_id = $2
	`

// sqlSelectSuccessorSession is the lean shape used by refreshFromSuccessor
// (it doesn't need rotation metadata — only liveness). dpop_jkt added
// 2026-05-18 (Phase 3) so the existing-successor reuse path can
// re-emit the access token's cnf.jkt without a separate lookup.
const sqlSelectSuccessorSession = `
		SELECT users_sessions_id,
		       users_sessions_id_user,
		       users_sessions_expires_at,
		       users_sessions_revoked,
		       COALESCE(users_sessions_dpop_jkt, '')
		  FROM users_sessions
		 WHERE users_sessions_token_hash = $1
	`

// ── DPoP JTI replay cache (TD-SEC-DPOP-BINDING) ─────────────────────────────

// sqlInsertDPoPJTI records a DPoP-proof JTI as seen. The
// ON CONFLICT DO NOTHING + xmax inspection lets the caller detect a
// replay attempt without a separate SELECT round-trip: when xmax=0 the
// INSERT actually wrote a new row (first time we've seen this jti);
// any other value means the row already existed (replay → 401).
const sqlInsertDPoPJTI = `
		INSERT INTO dpop_jti_cache (jti, expires_at)
		VALUES ($1, $2)
		ON CONFLICT (jti) DO NOTHING
		RETURNING xmax
	`

// sqlDeleteExpiredDPoPJTIs is the cleanup-cron shape (10-minute
// goroutine in main.go). Bounded by the partial index on expires_at
// so it's an index range delete, not a seq scan.
const sqlDeleteExpiredDPoPJTIs = `DELETE FROM dpop_jti_cache WHERE expires_at <= NOW()`

// ── logout (Logout) ─────────────────────────────────────────────────────────

// sqlRevokeSessionByHashReturningUser revokes the session matching a
// refresh-token hash AND returns the owning user_id so the caller can
// audit-log without a second round-trip.
const sqlRevokeSessionByHashReturningUser = `
		UPDATE users_sessions
		   SET users_sessions_revoked = TRUE
		 WHERE users_sessions_token_hash = $1
		 RETURNING users_sessions_id_user
	`

// ── password change (ChangePassword) ────────────────────────────────────────

// sqlUpdatePasswordHashAndClearForceFlag rewrites password_hash,
// stamps password_changed_at=NOW(), and clears force_password_change.
// Used by ChangePassword (current → new path).
const sqlUpdatePasswordHashAndClearForceFlag = `
		UPDATE users SET password_hash = $1, force_password_change = FALSE, password_changed_at = NOW()
		WHERE id = $2
	`

// ── password reset (RequestPasswordReset, ConfirmPasswordReset) ─────────────

// sqlInsertPasswordReset opens a new users_password_resets row.
// users_password_resets_token_hash is SHA-256 of the raw reset token
// (raw is only emailed, never stored).
const sqlInsertPasswordReset = `
		INSERT INTO users_password_resets (
			users_password_resets_id_user,
			users_password_resets_token_hash,
			users_password_resets_expires_at,
			users_password_resets_requested_ip
		)
		VALUES ($1, $2, $3, $4)
	`

// sqlSelectPasswordResetByHash returns the reset-token row needed to
// validate the confirmation request (expiry + used_at gate).
const sqlSelectPasswordResetByHash = `
		SELECT users_password_resets_id,
		       users_password_resets_id_user,
		       users_password_resets_expires_at,
		       users_password_resets_used_at
		  FROM users_password_resets
		 WHERE users_password_resets_token_hash = $1
	`

// sqlUpdatePasswordHashAndClearLockout rewrites password_hash and ALSO
// clears failed_login_count + locked_until — the "I forgot my password"
// path implicitly resolves a lockout.
const sqlUpdatePasswordHashAndClearLockout = `
		UPDATE users SET password_hash = $1, force_password_change = FALSE, password_changed_at = NOW(),
		                 failed_login_count = 0, locked_until = NULL
		WHERE id = $2
	`

// sqlMarkPasswordResetUsed stamps used_at=NOW() so the reset token
// cannot be replayed. Run inside the confirmation tx alongside the
// password update and session revoke.
const sqlMarkPasswordResetUsed = `UPDATE users_password_resets SET users_password_resets_used_at = NOW() WHERE users_password_resets_id = $1`

// sqlSelectPasswordResetByID is the post-handoff lookup. The cookie
// handoff flow (TD-SEC-RESET-TOKEN-FRAGMENT) carries reset_id in the
// signed cookie; ConfirmPasswordResetByID re-validates expiry +
// used_at before applying the password change.
const sqlSelectPasswordResetByID = `
		SELECT users_password_resets_id,
		       users_password_resets_id_user,
		       users_password_resets_expires_at,
		       users_password_resets_used_at
		  FROM users_password_resets
		 WHERE users_password_resets_id = $1
	`

// sqlSelectFirstLiveWorkspaceID returns the subscription's earliest-created
// live workspace. Used by Login to seed the JWT's workspace_id claim
// (PLA-0053 / story 00575). Mirrors topology/sql.go's constant of the
// same name — the row shape (master_record_workspaces with subscription_id,
// archived_at, created_at) is the source of truth; if both copies drift,
// favour topology since that's where the read-side substrate lives.
const sqlSelectFirstLiveWorkspaceID = `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT 1
	`

// sqlAssertWorkspaceMemberLive checks that (subscription_id, workspace_id,
// user_id) all line up against a non-archived workspace AND a live
// users_roles_workspaces grant for the user. Used by SwitchWorkspace
// (PLA-0053 story 00576.5) to gate the JWT re-mint — same membership
// rule as fields.AssertCallerMayRead, just specialised to a single
// workspace assertion.
//
// Returns 1 row iff the user can read the workspace; pgx.ErrNoRows
// otherwise. Cross-subscription IDs and revoked grants are silently
// excluded (no existence leak).
const sqlAssertWorkspaceMemberLive = `
		SELECT 1
		  FROM master_record_workspaces ws
		  JOIN users_roles_workspaces urw
		    ON urw.users_roles_workspaces_id_workspace = ws.id
		   AND urw.users_roles_workspaces_id_user      = $3::uuid
		   AND urw.users_roles_workspaces_revoked_at IS NULL
		 WHERE ws.subscription_id = $1::uuid
		   AND ws.id              = $2::uuid
		   AND ws.archived_at IS NULL
		 LIMIT 1
	`

// ── MFA (003_mfa_scaffold.sql columns) ──────────────────────────────────────

// sqlStoreMFASecretAndRecoveries writes the TOTP secret and hashed recovery
// codes during enrollment (before confirm). mfa_enrolled stays FALSE until
// sqlConfirmMFAEnrollment.
const sqlStoreMFASecretAndRecoveries = `
		UPDATE users SET mfa_secret = $1, mfa_recovery_codes = $2 WHERE id = $3
	`

// sqlStoreMFASecret writes the TOTP secret during enrollment (before
// the user has confirmed with a live code). mfa_enrolled stays FALSE
// until sqlConfirmMFAEnrollment.
const sqlStoreMFASecret = `
		UPDATE users SET mfa_secret = $1 WHERE id = $2
	`

// sqlConfirmMFAEnrollment flips mfa_enrolled=TRUE, stamps
// mfa_enrolled_at, and writes the bcrypt-hashed recovery codes.
// Called by MFAConfirm after the user proves a valid TOTP code.
const sqlConfirmMFAEnrollment = `
		UPDATE users
		   SET mfa_enrolled       = TRUE,
		       mfa_enrolled_at    = NOW(),
		       mfa_recovery_codes = $1
		 WHERE id = $2
	`

// sqlUpdateMFARecoveryCodes rewrites the recovery-codes array after a
// code has been consumed (UseRecoveryCode replaces the full array with
// the spent slot zeroed out).
const sqlUpdateMFARecoveryCodes = `
		UPDATE users SET mfa_recovery_codes = $1 WHERE id = $2
	`

// sqlDisableMFA clears all four MFA columns, returning the user to the
// unenrolled state. Called by MFADisable after password re-verification.
const sqlDisableMFA = `
		UPDATE users
		   SET mfa_enrolled       = FALSE,
		       mfa_secret         = NULL,
		       mfa_enrolled_at    = NULL,
		       mfa_recovery_codes = NULL
		 WHERE id = $1
	`

// ── B16.8.10 active sessions UI ─────────────────────────────────────────────

// sqlSelectSessionsForUser returns every live (not-revoked, not-expired)
// session for a user. last_activity_at = COALESCE(rotated_at, created_at)
// mirrors the column the per-request RequireAuth check reads (B16.8.11
// step 3) so the UI shows the same "freshness" notion the gate enforces.
// Caller filters in-memory to mark which row matches the requester's sid
// claim — keeping the SQL row-shape stable for whatever frontend wants
// to display.
const sqlSelectSessionsForUser = `
		SELECT users_sessions_id,
		       users_sessions_created_at,
		       COALESCE(users_sessions_rotated_at, users_sessions_created_at) AS last_activity_at,
		       host(users_sessions_ip_address)::text AS ip_text,
		       users_sessions_user_agent
		  FROM users_sessions
		 WHERE users_sessions_id_user = $1
		   AND users_sessions_revoked = FALSE
		   AND users_sessions_expires_at > NOW()
		 ORDER BY last_activity_at DESC
	`

// sqlRevokeSessionByIDForUser revokes a single session — but only if it
// belongs to the caller. Cross-user revoke is silently a no-op (0 rows
// affected → handler returns 404, no information leak about whether the
// id exists under a different user).
const sqlRevokeSessionByIDForUser = `
		UPDATE users_sessions
		   SET users_sessions_revoked = TRUE
		 WHERE users_sessions_id      = $1
		   AND users_sessions_id_user = $2
		   AND users_sessions_revoked = FALSE
	`

// sqlRevokeOtherSessionsForUser revokes every session for a user EXCEPT
// the one whose id matches $2 (the caller's current sid claim). Used by
// the "Log out all other sessions" action. Returns the count of rows
// touched so the handler can include it in the audit entry.
const sqlRevokeOtherSessionsForUser = `
		UPDATE users_sessions
		   SET users_sessions_revoked = TRUE
		 WHERE users_sessions_id_user = $1
		   AND users_sessions_id     <> $2
		   AND users_sessions_revoked = FALSE
	`

// ── B16.8.10 step-up reauth nonces ──────────────────────────────────────────

// sqlInsertReauthNonce records a freshly-issued reauth challenge. Called
// by POST /_site/auth/reauth after password (+ TOTP) verification, before
// returning the signed action_proof to the user. action_key is the
// route-bound identifier the matching RequireStepUpReauth(actionKey)
// middleware compares against — proof minted for "delete-workspace"
// cannot be replayed against "disable-mfa".
const sqlInsertReauthNonce = `
		INSERT INTO users_reauth_nonces (
			users_reauth_nonces_id_user,
			users_reauth_nonces_action_key,
			users_reauth_nonces_expires_at
		)
		VALUES ($1, $2, $3)
		RETURNING users_reauth_nonces_id
	`

// sqlConsumeReauthNonce atomically marks a nonce consumed iff it has
// not yet been consumed AND has not yet expired AND belongs to the
// caller AND matches the route's action_key. Returns the user_id on
// success so the handler can audit the consumption against the actor.
// rowsAffected=0 covers every failure path (unknown id, already
// consumed, expired, wrong user, wrong action) — all collapse to 409
// reauth_required so callers can't probe for which condition failed.
const sqlConsumeReauthNonce = `
		UPDATE users_reauth_nonces
		   SET users_reauth_nonces_consumed_at = NOW()
		 WHERE users_reauth_nonces_id           = $1
		   AND users_reauth_nonces_id_user      = $2
		   AND users_reauth_nonces_action_key   = $3
		   AND users_reauth_nonces_consumed_at IS NULL
		   AND users_reauth_nonces_expires_at   > NOW()
	`
