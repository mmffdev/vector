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
// Used by Login + RequestPasswordReset. PLA-0049: includes role_id so
// the hydrated User carries the UUID source-of-truth alongside the
// dual-read enum role string.
const sqlSelectUserByEmail = `
		SELECT id, subscription_id, email, password_hash, role, role_id, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until, created_at, updated_at
		FROM users WHERE email = $1
	`

// sqlSelectUserByID returns the full user row for a given UUID. Used
// by Refresh / ConfirmPasswordReset / ChangePassword post-token-validation.
const sqlSelectUserByID = `
		SELECT id, subscription_id, email, password_hash, role, role_id, is_active, last_login,
		       auth_method, ldap_dn, force_password_change, password_changed_at,
		       failed_login_count, locked_until, created_at, updated_at
		FROM users WHERE id = $1
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
// Login and the rotation path in Refresh.
const sqlInsertSession = `
		INSERT INTO users_sessions (
			users_sessions_id_user,
			users_sessions_token_hash,
			users_sessions_expires_at,
			users_sessions_ip_address,
			users_sessions_user_agent
		)
		VALUES ($1, $2, $3, $4, $5)
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
// grace-window decision).
const sqlSelectSessionByHash = `
		SELECT users_sessions_id,
		       users_sessions_id_user,
		       users_sessions_expires_at,
		       users_sessions_revoked,
		       users_sessions_rotated_at,
		       users_sessions_successor_hash
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
// (it doesn't need rotation metadata — only liveness).
const sqlSelectSuccessorSession = `
		SELECT users_sessions_id,
		       users_sessions_id_user,
		       users_sessions_expires_at,
		       users_sessions_revoked
		  FROM users_sessions
		 WHERE users_sessions_token_hash = $1
	`

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
