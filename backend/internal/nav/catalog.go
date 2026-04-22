// Package nav holds the sidebar navigation catalogue and per-user prefs.
//
// MIRROR OF app/lib/navCatalog.ts. Keep these in sync by hand; this file
// is the validating authority for PUT /api/nav/prefs — unknown or
// non-pinnable item_keys are rejected here.
package nav

import "github.com/mmffdev/vector-backend/internal/models"

type NavItemKind string

const (
	KindStatic NavItemKind = "static"
	KindEntity NavItemKind = "entity"
)

type CatalogEntry struct {
	Key           string        `json:"key"`
	Label         string        `json:"label"`
	Href          string        `json:"href"`
	Kind          NavItemKind   `json:"kind"`
	Roles         []models.Role `json:"roles"`
	Pinnable      bool          `json:"pinnable"`
	DefaultPinned bool          `json:"defaultPinned"`
	DefaultOrder  int           `json:"defaultOrder"`
	Icon          string        `json:"icon"`
}

var allRoles = []models.Role{models.RoleUser, models.RolePAdmin, models.RoleGAdmin}
var adminRoles = []models.Role{models.RolePAdmin, models.RoleGAdmin}

// Catalog is the canonical list. Order here is source-of-truth default order.
var Catalog = []CatalogEntry{
	{Key: "dashboard", Label: "Dashboard", Href: "/dashboard", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 0, Icon: "home"},
	{Key: "my-vista", Label: "My Vista", Href: "/my-vista", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 1, Icon: "eye"},
	{Key: "portfolio", Label: "Portfolio", Href: "/portfolio", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 2, Icon: "briefcase"},
	{Key: "favourites", Label: "Favourites", Href: "/favourites", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 3, Icon: "star"},
	{Key: "backlog", Label: "Backlog", Href: "/backlog", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 4, Icon: "clipboard"},
	{Key: "planning", Label: "Planning", Href: "/planning", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 5, Icon: "list"},
	{Key: "risk", Label: "Risk", Href: "/risk", Kind: KindStatic, Roles: allRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 6, Icon: "warning"},
	{Key: "admin", Label: "Settings", Href: "/admin", Kind: KindStatic, Roles: adminRoles, Pinnable: true, DefaultPinned: true, DefaultOrder: 7, Icon: "cog"},
	{Key: "dev", Label: "Dev Setup", Href: "/dev", Kind: KindStatic, Roles: allRoles, Pinnable: false, DefaultPinned: false, DefaultOrder: 99, Icon: "wrench"},
}

var catalogByKey = func() map[string]CatalogEntry {
	m := make(map[string]CatalogEntry, len(Catalog))
	for _, e := range Catalog {
		m[e.Key] = e
	}
	return m
}()

// Find returns the catalogue entry for a key, or (zero, false).
func Find(key string) (CatalogEntry, bool) {
	e, ok := catalogByKey[key]
	return e, ok
}

// CatalogFor returns only entries visible to the given role.
func CatalogFor(role models.Role) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(Catalog))
	for _, e := range Catalog {
		if roleAllowed(role, e.Roles) {
			out = append(out, e)
		}
	}
	return out
}

// IsPinnable reports whether a key exists AND is pinnable. Unknown keys are
// not pinnable. Dynamic entity keys (e.g. "item:<uuid>") are not in the
// static catalogue and must be validated separately by the caller.
func IsPinnable(key string) bool {
	e, ok := catalogByKey[key]
	return ok && e.Pinnable
}

func roleAllowed(r models.Role, allowed []models.Role) bool {
	for _, a := range allowed {
		if a == r {
			return true
		}
	}
	return false
}
