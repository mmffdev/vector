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
// live there). Column-prefix applied 2026-05-14 (RF1.4.4 / TD-NAME-001).
package roles

// ── permission-id resolution (ResolveActorPermissionIDs) ───────────────────

// sqlSelectPermissionIDsByCode resolves a flat list of permission codes
// (e.g. ["users.create.padmin", "users_roles.update"]) to their permission
// row IDs. Used by the self-elevation gate in AssignPermissions to
// reject grants the actor does not themselves hold.
const sqlSelectPermissionIDsByCode = `SELECT users_permissions_id FROM users_permissions WHERE users_permissions_code = ANY($1)`

// ── role list / get ────────────────────────────────────────────────────────

// sqlListRolesVisibleToTenant returns every system role plus every
// tenant-custom role belonging to actorTenant. Archived rows are
// hidden. Order: highest rank first, then label A→Z so the admin UI
// renders gadmin/padmin/team_lead/user/external at the top.
const sqlListRolesVisibleToTenant = `
		SELECT users_roles_id,
		       users_roles_id_subscription,
		       users_roles_code,
		       users_roles_label,
		       users_roles_description,
		       users_roles_rank,
		       users_roles_is_system,
		       users_roles_is_external,
		       users_roles_archived_at,
		       users_roles_created_at,
		       users_roles_updated_at,
		       users_roles_id_user_created_by
		  FROM users_roles
		 WHERE users_roles_archived_at IS NULL
		   AND (users_roles_id_subscription IS NULL OR users_roles_id_subscription = $1)
		 ORDER BY users_roles_rank DESC, users_roles_label ASC
	`

// sqlSelectRoleByIDInTenant returns a single role gated on tenant
// visibility. System users_roles (users_roles_id_subscription IS NULL)
// are visible to every tenant; tenant-custom rows are filtered by
// actorTenant. pgx.ErrNoRows → ErrNotFound in the caller (no
// existence leak).
const sqlSelectRoleByIDInTenant = `
		SELECT users_roles_id,
		       users_roles_id_subscription,
		       users_roles_code,
		       users_roles_label,
		       users_roles_description,
		       users_roles_rank,
		       users_roles_is_system,
		       users_roles_is_external,
		       users_roles_archived_at,
		       users_roles_created_at,
		       users_roles_updated_at,
		       users_roles_id_user_created_by
		  FROM users_roles
		 WHERE users_roles_id = $1
		   AND (users_roles_id_subscription IS NULL OR users_roles_id_subscription = $2)
	`

// ── tenant role mutation (Create / Update / Archive) ───────────────────────

// sqlInsertTenantRole creates a tenant-custom role. is_system is
// hard-coded FALSE — system rows can only be created by SQL migration.
// Returns the full row so the caller can hydrate the audit/response
// payload in one round-trip.
const sqlInsertTenantRole = `
		INSERT INTO users_roles (
			users_roles_id_subscription,
			users_roles_code,
			users_roles_label,
			users_roles_description,
			users_roles_rank,
			users_roles_is_system,
			users_roles_is_external,
			users_roles_id_user_created_by
		)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
		RETURNING users_roles_id,
		          users_roles_id_subscription,
		          users_roles_code,
		          users_roles_label,
		          users_roles_description,
		          users_roles_rank,
		          users_roles_is_system,
		          users_roles_is_external,
		          users_roles_archived_at,
		          users_roles_created_at,
		          users_roles_updated_at,
		          users_roles_id_user_created_by
	`

// sqlUpdateRole rewrites label + description + rank + updated_at.
// System rows reject rank changes upstream; only label/description
// flow through here for system rows.
const sqlUpdateRole = `
		UPDATE users_roles
		   SET users_roles_label       = $2,
		       users_roles_description = $3,
		       users_roles_rank        = $4,
		       users_roles_updated_at  = NOW()
		 WHERE users_roles_id = $1
		RETURNING users_roles_id,
		          users_roles_id_subscription,
		          users_roles_code,
		          users_roles_label,
		          users_roles_description,
		          users_roles_rank,
		          users_roles_is_system,
		          users_roles_is_external,
		          users_roles_archived_at,
		          users_roles_created_at,
		          users_roles_updated_at,
		          users_roles_id_user_created_by
	`

// sqlArchiveRole soft-archives a tenant-custom role by stamping
// archived_at + updated_at. System rows are rejected by the caller's
// guard before this query runs.
const sqlArchiveRole = `UPDATE users_roles SET users_roles_archived_at = NOW(), users_roles_updated_at = NOW() WHERE users_roles_id = $1`

// ── role-permission grid (AssignPermissions / RevokePermissions /
//    ListPermissionsForRole / ListPermissionsCatalogue) ────────────────────

// sqlUpsertRolePermission idempotently grants one permission to one
// role. The (id_role, id_permission) unique key drives ON CONFLICT —
// re-granting is a silent no-op, so the caller's loop can iterate
// over a candidate set without checking for prior membership.
const sqlUpsertRolePermission = `
		INSERT INTO users_roles_permissions (
			users_roles_permissions_id_role,
			users_roles_permissions_id_permission,
			users_roles_permissions_id_user_granted_by
		)
		VALUES ($1, $2, $3)
		ON CONFLICT (users_roles_permissions_id_role, users_roles_permissions_id_permission) DO NOTHING
	`

// sqlDeleteRolePermissions revokes a batch of users_permissions from a role
// in one round-trip. No-op when permissionIDs is empty — pg's ANY()
// handles the empty array cleanly. No self-elevation check (revoke
// cannot escalate).
const sqlDeleteRolePermissions = `
		DELETE FROM users_roles_permissions
		 WHERE users_roles_permissions_id_role       = $1
		   AND users_roles_permissions_id_permission = ANY($2)
	`

// sqlListPermissionIDsForRole returns the permission row IDs in a
// role's grid. Caller (ListPermissionsForRole) has already gated on
// tenant visibility via Get.
const sqlListPermissionIDsForRole = `SELECT users_roles_permissions_id_permission FROM users_roles_permissions WHERE users_roles_permissions_id_role = $1`

// sqlListPermissionsCatalogue returns the server-wide users_permissions
// catalogue ordered by (category, code) for the admin grid. Not
// tenant-scoped — visibility is enforced by the actor's users_roles.list
// permission at the route layer.
const sqlListPermissionsCatalogue = `
		SELECT users_permissions_id,
		       users_permissions_code,
		       users_permissions_label,
		       users_permissions_category,
		       users_permissions_description,
		       users_permissions_created_at
		  FROM users_permissions
		 ORDER BY users_permissions_category, users_permissions_code
	`
