"use client";

import { useMemo } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  PERSPECTIVES,
  type Perspective,
  type NavSection,
  type NavGroup,
  type NavPage,
} from "@/app/lib/nav-v2";

/**
 * Map of nav page hrefs to the permission code that gates them. Hrefs not in
 * the map are always visible to authenticated users. Sub-paths inherit the
 * gate of their longest matching prefix.
 *
 * Source: docs/c_c_roles_permissions.md + the page-gate survey done for the
 * redesign. Update when a new gated page is added.
 */
const PAGE_GATES: Array<{ prefix: string; perm: string }> = [
  // Workspace settings cluster — top-level requires workspace.create OR workspace.archive
  { prefix: "/workspace-settings", perm: "workspace.create" },
  // Library
  { prefix: "/library-releases", perm: "library.releases.view" },
  // Portfolio model
  { prefix: "/portfolio-model", perm: "portfolio.model.edit" },
  // Dev
  { prefix: "/dev", perm: "menu.dev.view" },
  // Admin
  { prefix: "/admin", perm: "workspace.archive" },
];

function permForHref(href: string): string | undefined {
  let best: { perm: string; len: number } | undefined;
  for (const g of PAGE_GATES) {
    if (href === g.prefix || href.startsWith(g.prefix + "/")) {
      if (!best || g.prefix.length > best.len) best = { perm: g.perm, len: g.prefix.length };
    }
  }
  return best?.perm;
}

function filterPages(pages: NavPage[], allowed: (perm: string) => boolean): NavPage[] {
  return pages.filter((p) => {
    const perm = permForHref(p.href);
    return !perm || allowed(perm);
  });
}

function filterSection(
  section: NavSection,
  allowed: (perm: string) => boolean,
): NavSection | undefined {
  if (section.pages) {
    const pages = filterPages(section.pages, allowed);
    if (pages.length === 0) return undefined;
    return { ...section, pages };
  }
  if (section.groups) {
    const groups: NavGroup[] = section.groups
      .map((g) => ({ ...g, pages: filterPages(g.pages, allowed) }))
      .filter((g) => g.pages.length > 0);
    if (groups.length === 0) return undefined;
    return { ...section, groups };
  }
  return section;
}

/**
 * Returns the PERSPECTIVES list with sections + pages the user can't access
 * hidden. A perspective with no remaining sections is dropped entirely.
 */
export function useFilteredPerspectives(): Perspective[] {
  const { hasPermission, user } = useAuth();

  return useMemo(() => {
    const allowed = (perm: string) => hasPermission(perm);
    if (!user) return [];
    return PERSPECTIVES.map((p) => ({
      ...p,
      sections: p.sections
        .map((s) => filterSection(s, allowed))
        .filter((s): s is NavSection => Boolean(s)),
    })).filter((p) => p.sections.length > 0);
  }, [hasPermission, user]);
}
