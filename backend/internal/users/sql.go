// Package users SQL constants.
//
// PLA-0048 / RF1.2.3. Every SQL string literal used by the users package
// lives here as a named constant. service.go / prefs.go / handler.go
// reference these constants; they DO NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlInsertUser, sqlSelectUserTenantAndRole,
// etc. Sparse UPDATE queries (Update) use a `*Template` const with a
// `%s` placeholder for the column-set clause and combine via fmt.Sprintf.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// All reads/writes target the mmff_vector pool via s.Pool — users is
// single-DB (users + users_roles + users_sessions + users_password_resets all live there).
package users

// ── Create ─────────────────────────────────────────────────────────────────

// sqlInsertUser creates a new user row with both the legacy `role`
// enum AND the structured `role_id` (subquery against the users_roles
// table). force_password_change defaults TRUE because Create's
// password is a random placeholder; the user must reset via the
// emailed link. Returns the hydrated row fields needed for the
// audit log + API response.
const sqlInsertUser = `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id, force_password_change)
		VALUES ($1, $2, $3, $4,
			(SELECT id FROM users_roles WHERE is_system = TRUE AND code = $5),
			TRUE)
		RETURNING id, subscription_id, email, role, is_active, auth_method, force_password_change, created_at, updated_at
	`

// sqlInsertPasswordReset opens a users_password_resets row. Shared by
// Create (initial setup, 24h TTL) and IssueResetLink (admin re-issue,
// 1h TTL) — TTL is decided by the caller via $3.
const sqlInsertPasswordReset = `
		INSERT INTO users_password_resets (
			users_password_resets_id_user,
			users_password_resets_token_hash,
			users_password_resets_expires_at,
			users_password_resets_requested_ip
		)
		VALUES ($1, $2, $3, $4)
	`

// ── List ───────────────────────────────────────────────────────────────────

// sqlListUsersBySubscription returns every user in a subscription,
// ordered most-recently-created first. Column shape matches the
// admin list response; no pagination yet (small tenants only —
// covered by TD when first multi-thousand-user tenant ships).
const sqlListUsersBySubscription = `
		SELECT id, subscription_id, email, role, is_active, first_name, last_name, department,
		       last_login, auth_method, force_password_change, password_changed_at,
		       created_at, updated_at
		FROM users WHERE subscription_id = $1 ORDER BY created_at DESC
	`

// ── Update (target lookup + sparse UPDATE + session revoke) ────────────────

// sqlSelectUserTenantAndRole is the role-ceiling preflight read for
// Update — the actor's session carries the role they may NOT exceed.
// Returns only the two columns needed to enforce ErrRoleCeiling.
const sqlSelectUserTenantAndRole = `SELECT subscription_id, role FROM users WHERE id = $1`

// sqlUpdateUserTemplate is the sparse-update shell used by Update.
// First %s holds the comma-separated `col = $N` SET clause built from
// the supplied non-nil UpdateInput fields; second %s holds the `$M`
// placeholder for the WHERE id bind. Callers do fmt.Sprintf to combine.
const sqlUpdateUserTemplate = `UPDATE users SET %s WHERE id = %s`

// sqlUpdateUserRoleIDFragmentTemplate is the role_id assignment fragment
// spliced into sqlUpdateUserTemplate's SET clause when a role change is
// requested. The role enum column is set in parallel via a separate
// fragment ("role = $N"). One %s holds the `$N` bind placeholder for
// the role code lookup. PLA-0007 G4 retires this subquery once the
// users.role enum column is dropped.
const sqlUpdateUserRoleIDFragmentTemplate = `role_id = (SELECT id FROM users_roles WHERE is_system = TRUE AND code = %s)`

// sqlRevokeActiveUserSessions revokes a user's live (non-already-revoked)
// users_sessions. Used inside the Update tx when role changes so a downgrade
// invalidates outstanding tokens before they expire.
const sqlRevokeActiveUserSessions = `UPDATE users_sessions SET users_sessions_revoked = TRUE WHERE users_sessions_id_user = $1 AND users_sessions_revoked = FALSE`

// ── Delete ─────────────────────────────────────────────────────────────────

// sqlSelectUserTenantRoleEmail is the role-ceiling + audit-metadata
// preflight read shared by Delete and IssueResetLink. Returns tenant
// (for the cross-tenant 404), role (for the ceiling check), and email
// (for the audit/email payload).
const sqlSelectUserTenantRoleEmail = `SELECT subscription_id, role, email FROM users WHERE id = $1`

// sqlDeleteUser hard-removes a user row by id. The preflight read
// above is the gate; the role-ceiling + self-delete checks happen in
// Go, not SQL.
const sqlDeleteUser = `DELETE FROM users WHERE id = $1`

// ── FindByID ───────────────────────────────────────────────────────────────

// sqlSelectUserByIDInTenant returns the lean user shape for FindByID,
// gated on tenant — cross-tenant existence is hidden behind the
// implicit ErrNotFound from pgx.ErrNoRows.
const sqlSelectUserByIDInTenant = `
		SELECT id, subscription_id, email, role, is_active, created_at, updated_at
		FROM users WHERE id = $1 AND subscription_id = $2
	`

// ── prefs.go (theme pack) ──────────────────────────────────────────────────

// sqlSelectUserThemePack reads the user's selected theme pack id.
// NULL fallback handled in Go (GetThemePack returns "default").
const sqlSelectUserThemePack = `SELECT theme_pack FROM users WHERE id = $1`

// sqlUpdateUserThemePack persists the theme-pack selection. updated_at
// is bumped for cache-bust on the read side.
const sqlUpdateUserThemePack = `UPDATE users SET theme_pack = $1, updated_at = NOW() WHERE id = $2`

// ── handler.go (post-reset email lookup) ───────────────────────────────────

// sqlSelectUserEmailByID is the lean email-only lookup after
// IssueResetLink so the gadmin response payload can echo the target
// email without a second service call.
const sqlSelectUserEmailByID = `SELECT email FROM users WHERE id = $1`
