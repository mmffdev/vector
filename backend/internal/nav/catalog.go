// Package nav holds the sidebar navigation catalogue and per-user prefs.
//
// The catalogue itself lives in the DB (see db/schema/009_page_registry.sql)
// and is loaded into a Registry at startup. Lookups during request handling
// go through a *Registry snapshot — not package-level globals.
package nav

import "github.com/mmffdev/vector-backend/internal/models"

type NavItemKind string

const (
	KindStatic     NavItemKind = "static"
	KindEntity     NavItemKind = "entity"
	KindUserCustom NavItemKind = "user_custom"
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
	TagEnum       string        `json:"tagEnum"`
}

func roleAllowed(r models.Role, allowed []models.Role) bool {
	for _, a := range allowed {
		if a == r {
			return true
		}
	}
	return false
}
