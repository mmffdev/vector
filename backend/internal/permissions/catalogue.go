// Package permissions is the Go-side catalogue of RBAC permission codes.
//
// The DB-side seed lives in db/schema/088_roles_permissions.sql. Both sides
// are kept in sync by VerifyParity (called from server boot): if the DB
// catalogue and the constants below diverge, the server refuses to start.
package permissions

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Code is a typed RBAC permission code. Use the typed constants below
// when calling RequirePermission or granting permissions in code.
type Code string

func (c Code) String() string { return string(c) }

// Permission code constants — must match db/schema/088_roles_permissions.sql
// and any extension migrations (e.g. 100, 104).
//
// Categories follow the seed catalogue:
//   - menu.*              — menu visibility (drives navigation gating)
//   - users.*             — users CRUD + creator-matrix
//   - roles.*             — roles CRUD
//   - portfolio.*         — portfolio resource
//   - workspace.*         — workspace tier surface (PLA-0006 / migration 100)
//   - library.*           — library release channel (PLA-0007 / migration 104)
//   - portfolio_items.*       — portfolio items reader gate (migration 104)
//   - portfolio_settings.*— portfolio settings reader gate (migration 104)
//   - work_items.*        — work_items configuration surface (migration 104)
const (
	// menu visibility
	MenuAdminView Code = "menu.admin.view"
	MenuDevView   Code = "menu.dev.view"

	// users CRUD
	UsersList          Code = "users.list"
	UsersRead          Code = "users.read"
	UsersArchive       Code = "users.archive"
	UsersUpdateProfile Code = "users.update_profile"
	UsersUpdateActive  Code = "users.update_active"
	UsersIssueReset    Code = "users.issue_reset"

	// users creator-matrix (one per target role)
	UsersCreateGadmin   Code = "users.create.gadmin"
	UsersCreatePadmin   Code = "users.create.padmin"
	UsersCreateTeamLead Code = "users.create.team_lead"
	UsersCreateUser     Code = "users.create.user"
	UsersCreateExternal Code = "users.create.external"

	// roles CRUD
	RolesList              Code = "roles.list"
	RolesRead              Code = "roles.read"
	RolesCreate            Code = "roles.create"
	RolesUpdate            Code = "roles.update"
	RolesArchive           Code = "roles.archive"
	RolesAssignPermissions Code = "roles.assign_permissions"
	RolesRevokePermissions Code = "roles.revoke_permissions"

	// portfolio
	PortfolioList Code = "portfolio.list"

	// workspace tier (PLA-0006 / migration 100)
	WorkspaceCreate       Code = "workspace.create"
	WorkspaceRename       Code = "workspace.rename"
	WorkspaceArchive      Code = "workspace.archive"
	WorkspaceRestore      Code = "workspace.restore"
	WorkspaceViewArchived Code = "workspace.view_archived"

	// library release channel (PLA-0007 / migration 104)
	LibraryReleasesView Code = "library.releases.view"

	// portfolio model + settings (migration 104)
	PortfolioModelEdit     Code = "portfolio.model.edit"
	PortfolioSettingsView  Code = "portfolio_settings.view"
	PortfolioItemsView     Code = "portfolio_items.view"

	// work_items configuration (migration 104)
	WorkItemsSettingsEdit Code = "work_items.settings.edit"

	// flows editor (migration 112)
	FlowsManage Code = "flows.manage"
)

// All is the canonical set of permission codes the Go side knows about.
// VerifyParity checks DB ↔ this list at boot.
var All = []Code{
	MenuAdminView,
	MenuDevView,

	UsersList,
	UsersRead,
	UsersArchive,
	UsersUpdateProfile,
	UsersUpdateActive,
	UsersIssueReset,

	UsersCreateGadmin,
	UsersCreatePadmin,
	UsersCreateTeamLead,
	UsersCreateUser,
	UsersCreateExternal,

	RolesList,
	RolesRead,
	RolesCreate,
	RolesUpdate,
	RolesArchive,
	RolesAssignPermissions,
	RolesRevokePermissions,

	PortfolioList,

	WorkspaceCreate,
	WorkspaceRename,
	WorkspaceArchive,
	WorkspaceRestore,
	WorkspaceViewArchived,

	LibraryReleasesView,

	PortfolioModelEdit,
	PortfolioSettingsView,
	PortfolioItemsView,

	WorkItemsSettingsEdit,

	FlowsManage,
}

// VerifyParity compares the DB permissions table against the Go All set.
// On any divergence (missing in DB, missing in Go, or both), it returns a
// descriptive error. The server's main() refuses to start if this fails.
//
// Drift is fatal: a permission referenced by RequirePermission but absent
// from the DB silently denies; an orphan DB row is dead config. Either is
// a bug we want surfaced before the server takes traffic.
func VerifyParity(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `SELECT code FROM permissions`)
	if err != nil {
		return fmt.Errorf("permissions parity: query: %w", err)
	}
	defer rows.Close()

	dbSet := make(map[string]struct{})
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return fmt.Errorf("permissions parity: scan: %w", err)
		}
		dbSet[code] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("permissions parity: rows: %w", err)
	}

	goSet := make(map[string]struct{}, len(All))
	for _, c := range All {
		goSet[string(c)] = struct{}{}
	}

	var missingInDB, missingInGo []string
	for code := range goSet {
		if _, ok := dbSet[code]; !ok {
			missingInDB = append(missingInDB, code)
		}
	}
	for code := range dbSet {
		if _, ok := goSet[code]; !ok {
			missingInGo = append(missingInGo, code)
		}
	}

	if len(missingInDB) == 0 && len(missingInGo) == 0 {
		return nil
	}

	sort.Strings(missingInDB)
	sort.Strings(missingInGo)
	return fmt.Errorf(
		"permissions catalogue drift: missing-in-DB=%v missing-in-Go=%v "+
			"(sync db/schema/088_roles_permissions.sql with internal/permissions/catalogue.go)",
		missingInDB, missingInGo,
	)
}
