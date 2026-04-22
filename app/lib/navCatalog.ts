// Nav catalogue — shared source of truth for sidebar items.
//
// MIRROR OF backend/internal/nav/catalog.go. Keep these in sync by hand;
// the Go side validates incoming PUT /api/nav/prefs item_keys against its
// copy, so divergence = runtime rejection.
//
// Governing rule at render time: permitted ∩ pinned.
// This catalogue gates by ROLE. Workspace-level permission checks happen
// elsewhere (AuthContext / server handlers).

export type NavItemKind = "static" | "entity";
export type Role = "user" | "padmin" | "gadmin";

export interface NavCatalogEntry {
  key: string;                 // stable id; also the DB item_key for static entries
  label: string;
  href: string;
  kind: NavItemKind;
  roles: Role[];               // role gate (catalogue level)
  pinnable: boolean;           // false = never appears in Manage Navigation modal
  defaultPinned: boolean;      // seeded when a user has no prefs row
  defaultOrder: number;        // used only when defaultPinned = true
  icon: string;                // icon key, resolved by <NavIcon />
}

export const NAV_CATALOG: NavCatalogEntry[] = [
  { key: "dashboard",  label: "Dashboard",  href: "/dashboard",  kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 0, icon: "home" },
  { key: "my-vista",   label: "My Vista",   href: "/my-vista",   kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 1, icon: "eye" },
  { key: "portfolio",  label: "Portfolio",  href: "/portfolio",  kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 2, icon: "briefcase" },
  { key: "favourites", label: "Favourites", href: "/favourites", kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 3, icon: "star" },
  { key: "backlog",    label: "Backlog",    href: "/backlog",    kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 4, icon: "clipboard" },
  { key: "planning",   label: "Planning",   href: "/planning",   kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 5, icon: "list" },
  { key: "risk",       label: "Risk",       href: "/risk",       kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: true,  defaultPinned: true,  defaultOrder: 6, icon: "warning" },
  { key: "admin",      label: "Settings",   href: "/admin",      kind: "static", roles: ["padmin", "gadmin"],         pinnable: true,  defaultPinned: true,  defaultOrder: 7, icon: "cog" },
  { key: "dev",        label: "Dev Setup",  href: "/dev",        kind: "static", roles: ["user", "padmin", "gadmin"], pinnable: false, defaultPinned: false, defaultOrder: 99, icon: "wrench" },
];

const CATALOG_BY_KEY = new Map(NAV_CATALOG.map((e) => [e.key, e]));

export function findCatalogEntry(key: string): NavCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function catalogFor(role: Role): NavCatalogEntry[] {
  return NAV_CATALOG.filter((e) => e.roles.includes(role));
}

export function defaultPinnedFor(role: Role): NavCatalogEntry[] {
  return catalogFor(role)
    .filter((e) => e.defaultPinned)
    .sort((a, b) => a.defaultOrder - b.defaultOrder);
}

export function isPinnable(key: string): boolean {
  return CATALOG_BY_KEY.get(key)?.pinnable ?? false;
}
