"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiSite } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

export type NavItemKind = "static" | "entity" | "user_custom";

export interface NavCatalogEntry {
  key: string;
  label: string;
  href: string;
  kind: NavItemKind;
  roles: string[];
  pinnable: boolean;
  defaultPinned: boolean;
  defaultOrder: number;
  icon: string;
  tagEnum: string;
}

export interface NavTagGroup {
  enum: string;
  label: string;
  defaultOrder: number;
  isAdminMenu: boolean;
  // PLA-0053 (B5.13): minAuthLevel was removed. Tag visibility is decided
  // server-side from users_roles_pages grants — the /nav/catalogue payload
  // only carries tags the caller has ≥1 page granted in. There is no
  // client-side tier filter anymore.
}

export interface PrefRow {
  item_key: string;
  position: number;
  is_start_page: boolean;
  is_bookmark: boolean;
  parent_item_key: string | null;
  group_id: string | null;
  icon_override: string | null;
}

// User-created primary group (Phase: sub-pages + custom groups).
// icon is null = "no override picked"; the rail consumer falls back to a
// generic group icon. Vocabulary matches user_nav_prefs.icon_override.
export interface NavCustomGroup {
  id: string;
  label: string;
  position: number;
  icon: string | null;
}

// Phase 5 — navigation profile (named layout slot per subscription).
export interface NavProfile {
  id: string;
  label: string;
  position: number;
  is_default: boolean;
  start_page_key: string | null;
}

// Per-profile placement (junction row). Each row sets exactly one of
// group_id (a user custom group) or tag_enum (a built-in tag bucket).
// Position is unique within the profile (contiguous 0..N-1).
export interface ProfileGroupPlacement {
  group_id: string | null;
  tag_enum: string | null;
  position: number;
  icon_override?: string | null;
}

interface PrefsResp {
  prefs: PrefRow[];
  groups: NavCustomGroup[];
  profile_id: string;
}
interface CatalogueResp { catalogue: NavCatalogEntry[]; tags: NavTagGroup[]; }
interface ProfilesResp { profiles: NavProfile[]; active_profile_id: string | null; }
interface ProfileGroupsResp { placements: ProfileGroupPlacement[]; }

export interface PutPrefsPinnedRow {
  item_key: string;
  position: number;
  parent_item_key?: string | null;
  group_id?: string | null;
  icon_override?: string | null;
}

// Custom group payload may carry a synthetic id ("new:<uuid>") for
// rows created in the editor; the server returns canonical ids on save.
export interface PutPrefsGroupRow {
  id: string;
  label: string;
  position: number;
  icon?: string | null;
}

export interface PutPrefsBody {
  pinned: PutPrefsPinnedRow[];
  start_page_key: string | null;
  groups?: PutPrefsGroupRow[];
}

export type EntityKind = "portfolio" | "product";

interface NavPrefsState {
  prefs: PrefRow[];
  customGroups: NavCustomGroup[];
  catalogue: NavCatalogEntry[];
  tags: NavTagGroup[];
  /**
   * Per-profile placements for the active profile, in display order
   * (position-sorted). Each row is either a custom-group placement
   * (group_id set) or a tag-bucket placement (tag_enum set). Consumers
   * use this list to render sections in user-defined order; falls back
   * to canonical order (tags by defaultOrder, customs by their pool
   * position) when the list is empty.
   */
  profileGroups: ProfileGroupPlacement[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Locally patch a single catalogue entry (e.g. after a rename / icon
  // change) without re-pulling prefs from the server. A full refetch would
  // clobber any unsaved local pin/order edits in the navigation editor.
  patchCatalogueEntry: (key: string, partial: Partial<NavCatalogEntry>) => void;
  // Returns canonical groups in payload order so callers can map any
  // synthetic "new:" ids they sent to the server-minted UUIDs.
  save: (body: PutPrefsBody) => Promise<NavCustomGroup[]>;
  reset: () => Promise<void>;
  findEntry: (key: string) => NavCatalogEntry | undefined;
  isPinnable: (key: string) => boolean;
  defaultPinned: NavCatalogEntry[];
  tagByEnum: (enumKey: string) => NavTagGroup | undefined;
  isBookmarked: (kind: EntityKind, id: string) => boolean;
  bookmark: (kind: EntityKind, id: string) => Promise<void>;
  unbookmark: (kind: EntityKind, id: string) => Promise<void>;
  isPageBookmarked: (key: string) => boolean;
  bookmarkPage: (key: string) => Promise<void>;
  unbookmarkPage: (key: string) => Promise<void>;

  // Phase 5 — profile slice
  profiles: NavProfile[];
  activeProfileId: string | null;
  setActiveProfile: (profileId: string) => Promise<void>;
  createProfile: (label: string) => Promise<NavProfile>;
  renameProfile: (profileId: string, label: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  reorderProfiles: (orderedIds: string[]) => Promise<void>;
  // E2 — per-profile group placement (junction).
  setProfileGroups: (
    profileId: string,
    placements: ProfileGroupPlacement[],
  ) => Promise<void>;
}

const Ctx = createContext<NavPrefsState | null>(null);

export function NavPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [customGroups, setCustomGroups] = useState<NavCustomGroup[]>([]);
  const [catalogue, setCatalogue] = useState<NavCatalogEntry[]>([]);
  const [tags, setTags] = useState<NavTagGroup[]>([]);
  const [profiles, setProfiles] = useState<NavProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileGroups, setProfileGroupsState] = useState<ProfileGroupPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) {
      setPrefs([]);
      setCustomGroups([]);
      setCatalogue([]);
      setTags([]);
      setProfiles([]);
      setActiveProfileId(null);
      setProfileGroupsState([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profilesRes, catRes] = await Promise.all([
        apiSite<ProfilesResp>("/nav/profiles"),
        apiSite<CatalogueResp>("/nav/catalogue"),
      ]);
      const profileList = profilesRes.profiles ?? [];
      setProfiles(profileList);
      setCatalogue(catRes.catalogue ?? []);
      setTags(catRes.tags ?? []);

      // Pick active: server-tracked → first profile (Default).
      const targetId =
        profilesRes.active_profile_id ??
        profileList[0]?.id ??
        null;

      // Prefs query is scoped by profile_id when present so we always
      // load placements for the same profile we'll write back to.
      const prefsPath = targetId
        ? `/nav/prefs?profile_id=${encodeURIComponent(targetId)}`
        : "/nav/prefs";
      const prefsRes = await apiSite<PrefsResp>(prefsPath);
      setPrefs(prefsRes.prefs ?? []);
      setCustomGroups(prefsRes.groups ?? []);
      // Server returns the resolved profile_id — trust it as the source of truth
      // (it accounts for lazy-seed of Default on first load).
      const resolvedProfileId = prefsRes.profile_id ?? targetId;
      setActiveProfileId(resolvedProfileId);

      // Per-profile placements (tag-bucket + custom-group order). Best-
      // effort: if the call fails we fall back to canonical order rather
      // than blocking the whole prefs load.
      if (resolvedProfileId) {
        try {
          const groupsRes = await apiSite<ProfileGroupsResp>(
            `/nav/profiles/${encodeURIComponent(resolvedProfileId)}/groups`,
          );
          setProfileGroupsState(groupsRes.placements ?? []);
        } catch {
          setProfileGroupsState([]);
        }
      } else {
        setProfileGroupsState([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load nav");
      setPrefs([]);
      setCustomGroups([]);
      setCatalogue([]);
      setTags([]);
      setProfiles([]);
      setActiveProfileId(null);
      setProfileGroupsState([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refetch(); }, [refetch]);

  const patchCatalogueEntry = useCallback(
    (key: string, partial: Partial<NavCatalogEntry>) => {
      setCatalogue((prev) =>
        prev.map((e) => (e.key === key ? { ...e, ...partial } : e)),
      );
    },
    [],
  );

  const save = useCallback(async (body: PutPrefsBody) => {
    const scoped: PutPrefsBody & { profile_id?: string } = activeProfileId
      ? { ...body, profile_id: activeProfileId }
      : body;
    const resp = await apiSite<{ groups: NavCustomGroup[] }>("/nav/prefs", {
      method: "PUT",
      body: JSON.stringify(scoped),
    });
    await refetch();
    return resp.groups ?? [];
  }, [refetch, activeProfileId]);

  const reset = useCallback(async () => {
    const path = activeProfileId
      ? `/nav/prefs?profile_id=${encodeURIComponent(activeProfileId)}`
      : "/nav/prefs";
    await apiSite(path, { method: "DELETE" });
    await refetch();
  }, [refetch, activeProfileId]);

  const setActiveProfile = useCallback(async (profileId: string) => {
    await apiSite("/nav/profiles/active", {
      method: "PUT",
      body: JSON.stringify({ profile_id: profileId }),
    });
    await refetch();
  }, [refetch]);

  const createProfile = useCallback(async (label: string) => {
    const created = await apiSite<NavProfile>("/nav/profiles", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    await refetch();
    return created;
  }, [refetch]);

  const renameProfile = useCallback(async (profileId: string, label: string) => {
    await apiSite(`/nav/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    });
    await refetch();
  }, [refetch]);

  const deleteProfile = useCallback(async (profileId: string) => {
    await apiSite(`/nav/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
    await refetch();
  }, [refetch]);

  const reorderProfiles = useCallback(async (orderedIds: string[]) => {
    await apiSite("/nav/profiles/order", {
      method: "PUT",
      body: JSON.stringify({ profile_ids: orderedIds }),
    });
    await refetch();
  }, [refetch]);

  // setProfileGroups writes the per-profile group placement junction
  // (which user_nav_groups appear in this profile, at which positions).
  // Never refetches — caller decides because this is usually chained
  // with other writes (e.g. PUT prefs first, then this).
  const setProfileGroups = useCallback(
    async (profileId: string, placements: ProfileGroupPlacement[]) => {
      await apiSite(`/nav/profiles/${encodeURIComponent(profileId)}/groups`, {
        method: "PUT",
        body: JSON.stringify({ placements }),
      });
    },
    [],
  );

  const byKey = useMemo(() => {
    const m = new Map<string, NavCatalogEntry>();
    for (const e of catalogue) m.set(e.key, e);
    return m;
  }, [catalogue]);

  const tagByEnumMap = useMemo(() => {
    const m = new Map<string, NavTagGroup>();
    for (const t of tags) m.set(t.enum, t);
    return m;
  }, [tags]);

  const findEntry = useCallback(
    (key: string) => byKey.get(key),
    [byKey],
  );

  const isPinnable = useCallback(
    (key: string) => byKey.get(key)?.pinnable ?? false,
    [byKey],
  );

  const tagByEnum = useCallback(
    (enumKey: string) => tagByEnumMap.get(enumKey),
    [tagByEnumMap],
  );

  const defaultPinned = useMemo(
    () =>
      catalogue
        .filter((e) => e.defaultPinned)
        .slice()
        .sort((a, b) => {
          const ta = tagByEnumMap.get(a.tagEnum)?.defaultOrder ?? 99;
          const tb = tagByEnumMap.get(b.tagEnum)?.defaultOrder ?? 99;
          if (ta !== tb) return ta - tb;
          return a.defaultOrder - b.defaultOrder;
        }),
    [catalogue, tagByEnumMap],
  );

  const entityKey = useCallback(
    (kind: EntityKind, id: string) => `entity:${kind}:${id}`,
    [],
  );

  const isBookmarked = useCallback(
    (kind: EntityKind, id: string) =>
      prefs.some((p) => p.item_key === entityKey(kind, id)),
    [prefs, entityKey],
  );

  const bookmark = useCallback(
    async (kind: EntityKind, id: string) => {
      await apiSite("/nav/bookmark", {
        method: "POST",
        body: JSON.stringify({ entity_kind: kind, entity_id: id }),
      });
      await refetch();
    },
    [refetch],
  );

  const unbookmark = useCallback(
    async (kind: EntityKind, id: string) => {
      await apiSite("/nav/bookmark", {
        method: "DELETE",
        body: JSON.stringify({ entity_kind: kind, entity_id: id }),
      });
      await refetch();
    },
    [refetch],
  );

  const isPageBookmarked = useCallback(
    (key: string): boolean => prefs.some((p) => p.item_key === key && p.is_bookmark),
    [prefs],
  );

  const bookmarkPage = useCallback(
    async (key: string) => {
      await apiSite("/nav/page-bookmark", { method: "POST", body: JSON.stringify({ page_key: key }) });
      await refetch();
    },
    [refetch],
  );

  const unbookmarkPage = useCallback(
    async (key: string) => {
      await apiSite("/nav/page-bookmark", { method: "DELETE", body: JSON.stringify({ page_key: key }) });
      await refetch();
    },
    [refetch],
  );

  const value: NavPrefsState = {
    prefs, customGroups, catalogue, tags, profileGroups, loading, error,
    refetch, patchCatalogueEntry, save, reset,
    findEntry, isPinnable, defaultPinned, tagByEnum,
    isBookmarked, bookmark, unbookmark,
    isPageBookmarked, bookmarkPage, unbookmarkPage,
    profiles, activeProfileId,
    setActiveProfile, createProfile, renameProfile, deleteProfile, reorderProfiles,
    setProfileGroups,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavPrefs(): NavPrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavPrefs must be used inside NavPrefsProvider");
  return v;
}

export function useOptionalNavPrefs(): NavPrefsState | null {
  return useContext(Ctx);
}
