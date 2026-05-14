// Package permissions SQL constants.
//
// PLA-0048 / RF1.2.5. Every SQL string literal used by the permissions
// package lives here as a named constant. catalogue.go (parity check)
// and resolver.go (effective code set lookup) reference these constants;
// they DO NOT embed raw SQL.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// All reads target the mmff_vector pool — permissions is single-DB and
// read-only at runtime (the seed is owned by SQL migrations).
package permissions

// ── catalogue.go (VerifyParity) ────────────────────────────────────────────

// sqlListPermissionCodes returns the full set of permission codes from
// the DB-side catalogue. Used at server boot by VerifyParity to detect
// drift between the SQL seed (db/schema/088_roles_permissions.sql + any
// extension migrations) and the Go-side `All` slice in catalogue.go.
// A mismatch is fatal — main() refuses to start.
const sqlListPermissionCodes = `SELECT code FROM permissions`

// ── resolver.go (PermissionsFor) ───────────────────────────────────────────

// sqlSelectUserRoleID resolves the user's role_id from the users row.
// Used by PermissionsFor before joining through roles_permissions.
// (Same SQL as users.sqlSelectUserRoleID, but this package owns its
// own catalogue file — packages do not reach across to share consts.)
const sqlSelectUserRoleID = `SELECT role_id FROM users WHERE id = $1`

// sqlSelectPermissionCodesForRole returns the effective permission
// codes for a role by joining roles_permissions to permissions. The
// resolver caches the result in-process; cache TTL bounds drift,
// explicit Invalidate/InvalidateRole calls drop stale entries.
const sqlSelectPermissionCodesForRole = `
		SELECT p.code
		  FROM roles_permissions rp
		  JOIN permissions p ON p.id = rp.permission_id
		 WHERE rp.role_id = $1
	`
