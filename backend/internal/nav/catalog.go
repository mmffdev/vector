// Package nav holds the sidebar navigation catalogue and per-user prefs.
//
// The catalogue itself lives in the DB (see db/mmff_vector/schema/009_page_registry.sql)
// and is loaded into a Registry at startup. Lookups during request handling
// go through a *Registry snapshot — not package-level globals.
package nav

import (
	"github.com/google/uuid"
)

type NavItemKind string

const (
	KindStatic     NavItemKind = "static"
	KindEntity     NavItemKind = "entity"
	KindUserCustom NavItemKind = "user_custom"
)

type CatalogEntry struct {
	Key           string      `json:"key"`
	Label         string      `json:"label"`
	Href          string      `json:"href"`
	Kind          NavItemKind `json:"kind"`
	// RoleIDs lists the users_roles UUIDs allowed to see this page.
	// PLA-0049 replaced the legacy []roletypes.Role enum-string slice.
	RoleIDs       []uuid.UUID `json:"role_ids"`
	Pinnable      bool        `json:"pinnable"`
	DefaultPinned bool        `json:"defaultPinned"`
	DefaultOrder  int         `json:"defaultOrder"`
	Icon          string      `json:"icon"`
	TagEnum       string      `json:"tagEnum"`
	// SubscriptionID is non-nil only for entity pages. The handler uses it to
	// filter the catalogue to the caller's tenant so a user never sees
	// another tenant's entity bookmarks.
	SubscriptionID *uuid.UUID `json:"-"`
}

// roleAllowed reports whether `roleID` is in the allowed set. PLA-0049:
// UUID-keyed grants — code is no longer a role identity, the UUID is.
func roleAllowed(roleID uuid.UUID, allowed []uuid.UUID) bool {
	for _, a := range allowed {
		if a == roleID {
			return true
		}
	}
	return false
}
