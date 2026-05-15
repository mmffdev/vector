// Package pageaccess SQL constants.
//
// Per the project lint contract (lint:sql-in-sqlfile-only), every SQL
// literal used by this package lives here as a named constant.
//
// All reads/writes target the mmff_vector pool — pages_access_version,
// users_roles_pages, users_roles, users, pages all live there.
package pageaccess

// sqlSelectAccessVersion: read the singleton version number. Hot path —
// called every request, with a 1s in-process cache wrapping it.
const sqlSelectAccessVersion = `
		SELECT pages_access_version_value
		  FROM pages_access_version
		 WHERE pages_access_version_id = 1
	`

// sqlSelectUserAccessSet: returns the set of page key_enums the user
// can see. Joins users → users_roles_pages via role_id → pages.
// Filters to system pages (created_by IS NULL, subscription_id IS
// NULL) — the access primitive only governs the catalogue, not
// per-user pinned bookmarks (those have their own visibility model
// via users_nav_prefs).
const sqlSelectUserAccessSet = `
		SELECT p.key_enum
		  FROM users u
		  JOIN users_roles_pages rp ON rp.users_roles_pages_id_role = u.role_id
		  JOIN pages p              ON p.id = rp.users_roles_pages_id_page
		 WHERE u.id              = $1
		   AND p.created_by      IS NULL
		   AND p.subscription_id IS NULL
	`
