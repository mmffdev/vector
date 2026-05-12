/**
 * Hardcoded 3-tier nav data for the 001_redesign shell.
 *
 * Shape: Perspective -> Section -> Page. The active perspective drives the
 * icon rail; the active section drives the flyout. Pages render via existing
 * URLs (Greenfield-in-parallel: we are NOT moving routes for this redesign).
 */

export type IconKey =
  | "LayoutDashboard"
  | "Compass"
  | "ListTree"
  | "Kanban"
  | "FolderTree"
  | "Network"
  | "FlaskConical"
  | "Settings"
  | "Users"
  | "ShieldCheck"
  | "Library"
  | "BookOpen"
  | "Star"
  | "BarChart3"
  | "Activity"
  | "GitBranch"
  | "Wrench"
  | "Bell"
  | "Search"
  | "UserCircle";

export interface NavPage {
  id: string;
  name: string;
  href: string;
  icon?: IconKey;
}

export interface NavGroup {
  id: string;
  name: string;
  pages: NavPage[];
}

export interface NavSection {
  id: string;
  name: string;
  icon: IconKey;
  /** Optional grouping inside the flyout. If absent, pages render flat. */
  groups?: NavGroup[];
  pages?: NavPage[];
}

export interface Perspective {
  id: string;
  name: string;
  initials: string;
  /** First section's first page is treated as the perspective's home. */
  sections: NavSection[];
}

export const PERSPECTIVES: Perspective[] = [
  {
    id: "default",
    name: "Default",
    initials: "DF",
    sections: [
      {
        id: "home",
        name: "Home",
        icon: "LayoutDashboard",
        pages: [
          { id: "dashboard", name: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
          { id: "my-vista", name: "My Vista", href: "/my-vista", icon: "Compass" },
          { id: "favourites", name: "Favourites", href: "/favourites", icon: "Star" },
        ],
      },
      {
        id: "work",
        name: "Work",
        icon: "Kanban",
        groups: [
          {
            id: "execution",
            name: "Execution",
            pages: [
              { id: "work-items", name: "Work items", href: "/work-items", icon: "ListTree" },
              { id: "backlog", name: "Backlog", href: "/backlog", icon: "ListTree" },
              { id: "planning", name: "Planning", href: "/planning", icon: "Kanban" },
            ],
          },
          {
            id: "portfolio",
            name: "Portfolio",
            pages: [
              { id: "portfolio", name: "Portfolio", href: "/portfolio", icon: "FolderTree" },
              { id: "portfolio-items", name: "Portfolio items", href: "/portfolio-items", icon: "ListTree" },
              { id: "product", name: "Product", href: "/product", icon: "BookOpen" },
            ],
          },
        ],
      },
      {
        id: "insight",
        name: "Insight",
        icon: "BarChart3",
        pages: [
          { id: "scope", name: "Scope", href: "/scope", icon: "Activity" },
          { id: "risk", name: "Risk", href: "/risk", icon: "ShieldCheck" },
        ],
      },
    ],
  },
  {
    id: "system-manager",
    name: "System Manager",
    initials: "SM",
    sections: [
      {
        id: "admin",
        name: "Admin",
        icon: "ShieldCheck",
        pages: [
          { id: "admin", name: "Admin home", href: "/admin", icon: "ShieldCheck" },
          { id: "vector-admin", name: "Vector admin", href: "/admin/vector-admin", icon: "Wrench" },
        ],
      },
      {
        id: "workspace",
        name: "Workspace",
        icon: "Settings",
        groups: [
          {
            id: "setup",
            name: "Setup",
            pages: [
              { id: "tenant-details", name: "Tenant details", href: "/workspace-settings/tenant-details", icon: "Settings" },
              { id: "topology-map", name: "Topology map", href: "/workspace-settings/topology-map", icon: "Network" },
              { id: "portfolio-model", name: "Portfolio model", href: "/portfolio-model", icon: "FolderTree" },
            ],
          },
          {
            id: "library",
            name: "Library",
            pages: [
              { id: "library-releases", name: "Library releases", href: "/library-releases", icon: "Library" },
              { id: "artefact-types", name: "Artefact types", href: "/workspace-settings/artefact-types", icon: "ListTree" },
              { id: "flow-states", name: "Flow states", href: "/workspace-settings/flow-states", icon: "GitBranch" },
              { id: "custom-fields", name: "Custom fields", href: "/workspace-settings/custom-fields", icon: "ListTree" },
              { id: "api-manager", name: "API manager", href: "/workspace-settings/api-manager", icon: "Wrench" },
            ],
          },
        ],
      },
      {
        id: "developer",
        name: "Developer",
        icon: "FlaskConical",
        pages: [
          { id: "dev", name: "Dev home", href: "/dev", icon: "FlaskConical" },
          { id: "table-harness", name: "Table harness", href: "/table-harness", icon: "ListTree" },
          { id: "theme", name: "Theme", href: "/theme", icon: "Wrench" },
        ],
      },
    ],
  },
  {
    id: "analyst",
    name: "Analyst",
    initials: "AN",
    sections: [
      {
        id: "vista",
        name: "Vista",
        icon: "Compass",
        pages: [
          { id: "my-vista", name: "My Vista", href: "/my-vista", icon: "Compass" },
          { id: "dashboard", name: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
        ],
      },
      {
        id: "scope",
        name: "Scope & Risk",
        icon: "Activity",
        pages: [
          { id: "scope", name: "Scope", href: "/scope", icon: "Activity" },
          { id: "risk", name: "Risk", href: "/risk", icon: "ShieldCheck" },
        ],
      },
    ],
  },
];

export function getPerspective(id: string): Perspective | undefined {
  return PERSPECTIVES.find((p) => p.id === id);
}

export function perspectiveHomeHref(p: Perspective): string {
  const first = p.sections[0];
  if (!first) return "/dashboard";
  const page = first.pages?.[0] ?? first.groups?.[0]?.pages[0];
  return page?.href ?? "/dashboard";
}

export function flattenSectionPages(s: NavSection): NavPage[] {
  if (s.pages) return s.pages;
  if (s.groups) return s.groups.flatMap((g) => g.pages);
  return [];
}
