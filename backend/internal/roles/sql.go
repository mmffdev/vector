// Package users_roles SQL constants.
//
// PLA-0048 / RF1.2.4. Every SQL string literal used by the users_roles
// package lives here as a named constant. service.go references
// these constants; it DOES NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlListRolesVisibleToTenant,
// sqlInsertTenantRole, sqlUpsertRolePermission, etc.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// All reads/writes target the mmff_vector pool via s.Pool — users_roles is
// single-DB (users_roles + users_roles_permissions + users_permissions catalogue all
// live there).
package roles

// ── permission-id resolution (ResolveActorPermissionIDs) ───────────────────

// sqlSelectPermissionIDsByCode resolves a flat list of permission codes
// (e.g. ["users.create.padmin", "users_roles.update"]) to their permission
// row IDs. Used by the self-elevation gate in AssignPermissions to
// reject grants the actor does not themselves hold.
const sqlSelectPermissionIDsByCode = `SELECT id FROM users_permissions WHERE code = ANY($1)`

// ── role list / get ────────────────────────────────────────────────────────

// sqlListRolesVisibleToTenant returns every system role plus every
// tenant-custom role belonging to actorTenant. Archived rows are
// hidden. Order: highest rank first, then label A→Z so the admin UI
// renders gadmin/padmin/team_lead/user/external at the top.
const sqlListRolesVisibleToTenant = `
		SELECT id, subscription_id, code, label, description, rank,
		       is_system, is_external, archived_at, created_at, updated_at, created_by
		  FROM users_roles
		 WHERE archived_at IS NULL
		   AND (subscription_id IS NULL OR subscription_id = $1)
		 ORDER BY rank DESC, label ASC
	`

// sqlSelectRoleByIDInTenant returns a single role gated on tenant
// visibility. System users_roles (subscription_id IS NULL) are visible to
// every tenant; tenant-custom rows are filtered by actorTenant.
// pgx.ErrNoRows → ErrNotFound in the caller (no existence leak).
const sqlSelectRoleByIDInTenant = `
		SELECT id, subscription_id, code, label, description, rank,
		       is_system, is_external, archived_at, created_at, updated_at, created_by
		  FROM users_roles
		 WHERE id = $1
		   AND (subscription_id IS NULL OR subscription_id = $2)
	`

// ── tenant role mutation (Create / Update / Archive) ───────────────────────

// sqlInsertTenantRole creates a tenant-custom role. is_system is
// hard-coded FALSE — system rows can only be created by SQL migration.
// Returns the full row so the caller can hydrate the audit/response
// payload in one round-trip.
const sqlInsertTenantRole = `
		INSERT INTO users_roles (subscription_id, code, label, description, rank,
		                   is_system, is_external, created_by)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
		RETURNING id, subscription_id, code, label, description, rank,
		          is_system, is_external, archived_at, created_at, updated_at, created_by
	`

// sqlUpdateRole rewrites label + description + rank + updated_at.
// System rows reject rank changes upstream; only label/description
// flow through here for system rows.
const sqlUpdateRole = `
		UPDATE users_roles
		   SET label = $2, description = $3, rank = $4, updated_at = NOW()
		 WHERE id = $1
		RETURNING id, subscription_id, code, label, description, rank,
		          is_system, is_external, archived_at, created_at, updated_at, created_by
	`

// sqlArchiveRole soft-archives a tenant-custom role by stamping
// archived_at + updated_at. System rows are rejected by the caller's
// guard before this query runs.
const sqlArchiveRole = `UPDATE users_roles SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`

// ── role-permission grid (AssignPermissions / RevokePermissions /
//    ListPermissionsForRole / ListPermissionsCatalogue) ────────────────────

// sqlUpsertRolePermission idempotently grants one permission to one
// role. The (role_id, permission_id) unique key drives ON CONFLICT —
// re-granting is a silent no-op, so the caller's loop can iterate
// over a candidate set without checking for prior membership.
const sqlUpsertRolePermission = `
		INSERT INTO users_roles_permissions (role_id, permission_id, granted_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (role_id, permission_id) DO NOTHING
	`

// sqlDeleteRolePermissions revokes a batch of users_permissions from a role
// in one round-trip. No-op when permissionIDs is empty — pg's ANY()
// handles the empty array cleanly. No self-elevation check (revoke
// cannot escalate).
const sqlDeleteRolePermissions = `
		DELETE FROM users_roles_permissions
		 WHERE role_id = $1
		   AND permission_id = ANY($2)
	`

// sqlListPermissionIDsForRole returns the permission row IDs in a
// role's grid. Caller (ListPermissionsForRole) has already gated on
// tenant visibility via Get.
const sqlListPermissionIDsForRole = `SELECT permission_id FROM users_roles_permissions WHERE role_id = $1`

// sqlListPermissionsCatalogue returns the server-wide users_permissions
// catalogue ordered by (category, code) for the admin grid. Not
// tenant-scoped — visibility is enforced by the actor's users_roles.list
// permission at the route layer.
const sqlListPermissionsCatalogue = `
		SELECT id, code, label, category, description, created_at
		FROM users_permissions
		ORDER BY category, code
	`
