"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useNavPrefs, type NavCatalogEntry, type NavTagGroup, type PrefRow } from "@/app/contexts/NavPrefsContext";
import { useAuth } from "@/app/contexts/AuthContext";

// Map the user's role rank to the admin tier used by pages_tags.min_auth_level.
// Lower number = higher privilege. Global Admin (rank 70) → 1, Portfolio
// Manager (rank 60) → 2, everyone else → 3. A user sees a tag iff
// tag.minAuthLevel >= userAuthLevel.
function deriveAuthLevel(roleRank: number | undefined | null): number {
  if (roleRank == null) return 3;
  if (roleRank >= 70) return 1;
  if (roleRank >= 60) return 2;
  return 3;
}

/** Sentinel ID for the account flyout slot — not a real customGroup. */
export const ACCOUNT_SECTION_ID = "__account";

/** Default rail icons per tag bucket. pages_tags has no icon column. */
const TAG_ICON_DEFAULTS: Record<string, string> = {
  personal: "home",
  planning: "clipboard",
  strategic: "star",
  bookmarks: "pin",
  dev_tools: "terminal-square",
  workspace_admin: "cog",
  user_management: "users",
  vector_admin: "shield",
};

/** A page row resolved from a pref + catalogue lookup. */
export interface ShellPage {
  itemKey: string;
  name: string;
  href: string;
  icon: string;
  parentItemKey: string | null;
  position: number;
}

/**
 * A "section" in the redesigned shell. Backed by a row in user_nav_groups
 * (customGroups). The icon falls back to "folder" when no override is set.
 */
export interface ShellSection {
  id: string;
  name: string;
  icon: string;
  pages: ShellPage[];
}

interface ShellState {
  sections: ShellSection[];
  bookmarkPages: ShellPage[];
  activeSectionId: string;
  setActiveSectionId: (id: string) => void;
  activeSection: ShellSection | undefined;
  /** True when the account flyout should render instead of the section flyout. */
  isAccountActive: boolean;
  /** True when the workspace scope panel is open in Rail 2. */
  isScopeOpen: boolean;
  toggleScopeOpen: () => void;
  closeScopePanel: () => void;
  /** Dev-only debug bar — toggled by clicking the Vector logo in Rail 1. */
  isDebugOpen: boolean;
  toggleDebugOpen: () => void;
  closeDebugPanel: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

/**
 * Build the page list for a group: prefs whose group_id matches, joined with
 * the catalogue for label/href/icon, sorted by position. Catalogue lookup
 * failures (e.g. a stale pref referencing a removed page) are dropped.
 */
function projectPref(p: PrefRow, catalogueByKey: Map<string, NavCatalogEntry>): ShellPage | null {
  const entry = catalogueByKey.get(p.item_key);
  if (!entry) return null;
  return {
    itemKey: p.item_key,
    name: entry.label,
    href: entry.href,
    icon: p.icon_override ?? entry.icon,
    parentItemKey: p.parent_item_key,
    position: p.position,
  };
}

function pagesForGroup(
  groupId: string,
  prefs: PrefRow[],
  catalogueByKey: Map<string, NavCatalogEntry>,
): ShellPage[] {
  return prefs
    .filter((p) => p.group_id === groupId)
    .map((p) => projectPref(p, catalogueByKey))
    .filter((p): p is ShellPage => p !== null)
    .sort((a, b) => a.position - b.position);
}

/**
 * Pages bound to a tag bucket: prefs with no custom group_id whose catalogue
 * entry's tagEnum matches.
 */
function pagesForTag(
  tagEnum: string,
  prefs: PrefRow[],
  catalogueByKey: Map<string, NavCatalogEntry>,
): ShellPage[] {
  return prefs
    .filter((p) => {
      if (p.group_id != null) return false;
      const e = catalogueByKey.get(p.item_key);
      return e ? (e.tagEnum || "personal") === tagEnum : false;
    })
    .map((p) => projectPref(p, catalogueByKey))
    .filter((p): p is ShellPage => p !== null)
    .sort((a, b) => a.position - b.position);
}

/**
 * Find the section whose page set contains the given pathname (longest prefix
 * match). Returns undefined when nothing matches.
 */
function sectionForPath(sections: ShellSection[], pathname: string): ShellSection | undefined {
  let best: { section: ShellSection; len: number } | undefined;
  for (const s of sections) {
    for (const p of s.pages) {
      if (pathname === p.href || pathname.startsWith(p.href + "/")) {
        if (!best || p.href.length > best.len) best = { section: s, len: p.href.length };
      }
    }
  }
  return best?.section;
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { prefs, customGroups, catalogue, tags, profileGroups } = useNavPrefs();
  const { user } = useAuth();
  const userAuthLevel = useMemo(
    () => deriveAuthLevel(user?.role?.rank),
    [user?.role?.rank],
  );

  const catalogueByKey = useMemo(() => {
    const m = new Map<string, NavCatalogEntry>();
    for (const e of catalogue) m.set(e.key, e);
    return m;
  }, [catalogue]);

  const tagByEnum = useMemo(() => {
    const m = new Map<string, NavTagGroup>();
    for (const t of tags) m.set(t.enum, t);
    return m;
  }, [tags]);

  const customGroupById = useMemo(() => {
    const m = new Map<string, typeof customGroups[number]>();
    for (const g of customGroups) m.set(g.id, g);
    return m;
  }, [customGroups]);

  const sections = useMemo<ShellSection[]>(() => {
    const out: ShellSection[] = [];
    const placedTags = new Set<string>();
    const placedGroups = new Set<string>();

    // Walk per-profile placements first — this is the user-defined
    // order across both tag buckets and custom groups.
    const ordered = [...profileGroups].sort((a, b) => a.position - b.position);
    for (const p of ordered) {
      if (p.tag_enum) {
        const tag = tagByEnum.get(p.tag_enum);
        if (!tag || tag.isAdminMenu) continue;
        // Admin-tier gate: tag.minAuthLevel = 1 (Vector Admin), 2
        // (Workspace Admin), 3 (everyone). User passes if their derived
        // auth_level ≤ the tag's required level.
        if (userAuthLevel > tag.minAuthLevel) continue;
        placedTags.add(tag.enum);
        out.push({
          id: `tag:${tag.enum}`,
          name: tag.label,
          icon: p.icon_override ?? TAG_ICON_DEFAULTS[tag.enum] ?? "folder",
          pages: pagesForTag(tag.enum, prefs, catalogueByKey),
        });
      } else if (p.group_id) {
        const g = customGroupById.get(p.group_id);
        if (!g) continue;
        placedGroups.add(g.id);
        out.push({
          id: `group:${g.id}`,
          name: g.label,
          icon: g.icon ?? "folder",
          pages: pagesForGroup(g.id, prefs, catalogueByKey),
        });
      }
    }

    // Fallback: anything not yet placed (e.g. a freshly added tag bucket
    // before the profile junction is back-filled, or a profile that has
    // no placements at all). Tag buckets in canonical order, then customs
    // by pool position. Empty tag buckets are skipped here — but a tag
    // that IS in profileGroups is rendered even when empty so the rail
    // honours the user's choice.
    for (const t of [...tags]
      .filter((tt) => !tt.isAdminMenu && userAuthLevel <= tt.minAuthLevel)
      .sort((a, b) => a.defaultOrder - b.defaultOrder)) {
      if (placedTags.has(t.enum)) continue;
      const pages = pagesForTag(t.enum, prefs, catalogueByKey);
      if (pages.length === 0) continue;
      out.push({
        id: `tag:${t.enum}`,
        name: t.label,
        icon: TAG_ICON_DEFAULTS[t.enum] ?? "folder",
        pages,
      });
    }
    for (const g of [...customGroups].sort((a, b) => a.position - b.position)) {
      if (placedGroups.has(g.id)) continue;
      out.push({
        id: `group:${g.id}`,
        name: g.label,
        icon: g.icon ?? "folder",
        pages: pagesForGroup(g.id, prefs, catalogueByKey),
      });
    }

    return out;
  }, [profileGroups, tags, customGroups, prefs, catalogueByKey, tagByEnum, customGroupById, userAuthLevel]);

  const bookmarkPages = useMemo<ShellPage[]>(() => {
    const result: ShellPage[] = [];
    for (const p of prefs) {
      if (!p.is_bookmark) continue;
      const page = projectPref(p, catalogueByKey);
      if (page) result.push(page);
    }
    return result.sort((a, b) => a.position - b.position);
  }, [prefs, catalogueByKey]);

  const urlSection = sectionForPath(sections, pathname);

  // Track the section the rail is currently "showing". Defaults to the URL's
  // section, but rail clicks override (so a user can browse one section's
  // flyout while staying on another section's page). When the URL changes to
  // a page in a different section, the override resets to follow the URL.
  const [manualSectionId, setManualSectionId] = useState<string>("");
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  useEffect(() => {
    if (urlSection) setManualSectionId(urlSection.id);
  }, [urlSection]);

  const activeSectionId =
    manualSectionId || urlSection?.id || sections[0]?.id || "";
  const isAccountActive = activeSectionId === ACCOUNT_SECTION_ID;
  const activeSection = isAccountActive
    ? undefined
    : sections.find((s) => s.id === activeSectionId) ?? sections[0];

  const setActiveSectionId = useCallback((id: string) => {
    setManualSectionId(id);
    setIsScopeOpen(false); // clicking any section icon collapses the scope panel
  }, []);

  const toggleScopeOpen = useCallback(() => setIsScopeOpen((v) => !v), []);
  const closeScopePanel = useCallback(() => setIsScopeOpen(false), []);
  const toggleDebugOpen = useCallback(() => setIsDebugOpen((v) => !v), []);
  const closeDebugPanel = useCallback(() => setIsDebugOpen(false), []);

  return (
    <ShellContext.Provider
      value={{
        sections,
        bookmarkPages,
        activeSectionId,
        setActiveSectionId,
        activeSection,
        isAccountActive,
        isScopeOpen,
        toggleScopeOpen,
        closeScopePanel,
        isDebugOpen,
        toggleDebugOpen,
        closeDebugPanel,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within <ShellProvider>");
  return ctx;
}
