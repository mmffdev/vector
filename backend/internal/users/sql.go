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
		INSERT INTO users (users_id_subscription, users_email, users_password_hash, users_role, users_id_role, users_force_password_change)
		VALUES ($1, $2, $3, $4,
			(SELECT users_roles_id FROM users_roles WHERE users_roles_is_system = TRUE AND users_roles_code = $5),
			TRUE)
		RETURNING users_id, users_id_subscription, users_email, users_role, users_is_active, users_auth_method, users_force_password_change, users_created_at, users_updated_at
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
//
// B20.4.2: extended profile + stub-FK columns appended. List remains
// gated by users.admin.view at the handler — the SQL pulls every
// field; the handler clears PII for unprivileged callers before
// serialising (see filterAdminFieldsForRole in handler.go).
const sqlListUsersBySubscription = `
		SELECT users_id, users_id_subscription, users_email, users_role, users_id_role, users_is_active, users_first_name, users_last_name, users_department,
		       users_middle_name, users_display_name, users_phone_work, users_phone_mobile, users_timezone, users_date_format,
		       users_datetime_format, users_email_notifications_enabled, users_password_reset_required,
		       users_id_cost_centre, users_id_office_location, users_profile_image_url,
		       users_last_login, users_auth_method, users_ldap_dn, users_force_password_change, users_password_changed_at,
		       users_created_at, users_updated_at
		FROM users WHERE users_id_subscription = $1 ORDER BY users_created_at DESC
	`

// ── Update (target lookup + sparse UPDATE + session revoke) ────────────────

// sqlSelectUserTenantAndRole is the role-ceiling preflight read for
// Update — the actor's session carries the role they may NOT exceed.
// Returns only the two columns needed to enforce ErrRoleCeiling.
const sqlSelectUserTenantAndRole = `SELECT users_id_subscription, users_role FROM users WHERE users_id = $1`

// sqlUpdateUserTemplate is the sparse-update shell used by Update.
// First %s holds the comma-separated `col = $N` SET clause built from
// the supplied non-nil UpdateInput fields; second %s holds the `$M`
// placeholder for the WHERE id bind. Callers do fmt.Sprintf to combine.
const sqlUpdateUserTemplate = `UPDATE users SET %s WHERE users_id = %s`

// sqlUpdateUserRoleIDFragmentTemplate is the role_id assignment fragment
// spliced into sqlUpdateUserTemplate's SET clause when a role change is
// requested. The role enum column is set in parallel via a separate
// fragment ("users_role = $N"). One %s holds the `$N` bind placeholder for
// the role code lookup. PLA-0007 G4 retires this subquery once the
// users.users_role enum column is dropped.
const sqlUpdateUserRoleIDFragmentTemplate = `users_id_role = (SELECT users_roles_id FROM users_roles WHERE users_roles_is_system = TRUE AND users_roles_code = %s)`

// sqlRevokeActiveUserSessions revokes a user's live (non-already-revoked)
// users_sessions. Used inside the Update tx when role changes so a downgrade
// invalidates outstanding tokens before they expire.
const sqlRevokeActiveUserSessions = `UPDATE users_sessions SET users_sessions_revoked = TRUE WHERE users_sessions_id_user = $1 AND users_sessions_revoked = FALSE`

// ── Delete ─────────────────────────────────────────────────────────────────

// sqlSelectUserTenantRoleEmail is the role-ceiling + audit-metadata
// preflight read shared by Delete and IssueResetLink. Returns tenant
// (for the cross-tenant 404), role (for the ceiling check), and email
// (for the audit/email payload).
const sqlSelectUserTenantRoleEmail = `SELECT users_id_subscription, users_role, users_email FROM users WHERE users_id = $1`

// sqlDeleteUser hard-removes a user row by id. The preflight read
// above is the gate; the role-ceiling + self-delete checks happen in
// Go, not SQL.
const sqlDeleteUser = `DELETE FROM users WHERE users_id = $1`

// ── FindByID ───────────────────────────────────────────────────────────────

// sqlSelectUserByIDInTenant returns the lean user shape for FindByID,
// gated on tenant — cross-tenant existence is hidden behind the
// implicit ErrNotFound from pgx.ErrNoRows.
const sqlSelectUserByIDInTenant = `
		SELECT users_id, users_id_subscription, users_email, users_role, users_is_active, users_created_at, users_updated_at
		FROM users WHERE users_id = $1 AND users_id_subscription = $2
	`

// sqlSelectUserActiveScope reads the user's last-selected scope node ID.
const sqlSelectUserActiveScope = `SELECT users_id_active_scope_node FROM users WHERE users_id = $1`

// sqlUpdateUserActiveScope persists the active scope node ID. NULL clears it.
const sqlUpdateUserActiveScope = `UPDATE users SET users_id_active_scope_node = $1, users_updated_at = NOW() WHERE users_id = $2`

// sqlUpdateUserHomeLocationFollowMode persists the Pinned/Follow toggle
// from the Home Location section of /user/account-settings (migration
// 244). When TRUE, the frontend setFocus action also PUTs to
// /_site/sentinel/focus so scope-rail clicks mirror into the home
// location column; when FALSE (default), scope-rail clicks stay
// session-only. $1 = bool, $2 = userID.
const sqlUpdateUserHomeLocationFollowMode = `UPDATE users SET users_home_location_follow_mode = $1, users_updated_at = NOW() WHERE users_id = $2`

// sqlUserHasGrantOnNode confirms the caller holds at least one active grant on
// the target topology node. Used to gate SetActiveScope — a user must not be
// able to store an arbitrary node ID they have no access to.
const sqlUserHasGrantOnNode = `
	SELECT EXISTS(
		SELECT 1 FROM users_roles_topology_nodes
		 WHERE users_roles_topology_nodes_id_topology_node = $1
		   AND users_roles_topology_nodes_id_user = $2
		   AND users_roles_topology_nodes_revoked_at IS NULL
	)`

// ── Per-user namespaced preferences (mig 208) ──────────────────────────────
//
// users.users_preferences is a JSONB column keyed by string namespace
// (e.g. "workitems.filters"). Reads return the value at the key
// (or null when absent). Writes overwrite the key — the caller
// owns the value shape; backend doesn't interpret it. See
// TD-URL-FILTER-CHIPS / TD-URL-TAB-STATE in docs/c_tech_debt.md.

// sqlSelectUserPreference returns the JSONB value at the namespace
// (or NULL when the key isn't set). Uses jsonb -> operator (not ->>)
// so the caller gets back the raw JSON, not a stringified copy.
const sqlSelectUserPreference = `SELECT users_preferences -> $2 FROM users WHERE users_id = $1`

// sqlUpsertUserPreference writes the namespace key with the given
// JSON value, leaving every other key intact. jsonb_set with
// create_missing=true is the standard upsert-key pattern.
const sqlUpsertUserPreference = `
	UPDATE users
	   SET users_preferences = jsonb_set(users_preferences, ARRAY[$2]::text[], $3::jsonb, true),
	       users_updated_at = NOW()
	 WHERE users_id = $1`

// sqlDeleteUserPreference clears a single namespace key (- operator
// removes by key). Idempotent — no error when the key wasn't set.
const sqlDeleteUserPreference = `
	UPDATE users
	   SET users_preferences = users_preferences - $2,
	       users_updated_at = NOW()
	 WHERE users_id = $1`

// ── handler.go (post-reset email lookup) ───────────────────────────────────

// sqlSelectUserEmailByID is the lean email-only lookup after
// IssueResetLink so the gadmin response payload can echo the target
// email without a second service call.
const sqlSelectUserEmailByID = `SELECT users_email FROM users WHERE users_id = $1`
