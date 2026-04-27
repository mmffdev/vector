"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/app/lib/api";
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
}

export interface PrefRow {
  item_key: string;
  position: number;
  is_start_page: boolean;
  parent_item_key: string | null;
  group_id: string | null;
  icon_override: string | null;
}

// User-created primary group (Phase: sub-pages + custom groups).
export interface NavCustomGroup {
  id: string;
  label: string;
  position: number;
}

// Phase 5 — navigation profile (named layout slot per subscription).
export interface NavProfile {
  id: string;
  label: string;
  position: number;
  is_default: boolean;
  start_page_key: string | null;
}

interface PrefsResp {
  prefs: PrefRow[];
  groups: NavCustomGroup[];
  profile_id: string;
}
interface CatalogueResp { catalogue: NavCatalogEntry[]; tags: NavTagGroup[]; }
interface ProfilesResp { profiles: NavProfile[]; active_profile_id: string | null; }

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
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  save: (body: PutPrefsBody) => Promise<void>;
  reset: () => Promise<void>;
  findEntry: (key: string) => NavCatalogEntry | undefined;
  isPinnable: (key: string) => boolean;
  defaultPinned: NavCatalogEntry[];
  tagByEnum: (enumKey: string) => NavTagGroup | undefined;
  isBookmarked: (kind: EntityKind, id: string) => boolean;
  bookmark: (kind: EntityKind, id: string) => Promise<void>;
  unbookmark: (kind: EntityKind, id: string) => Promise<void>;

  // Phase 5 — profile slice
  profiles: NavProfile[];
  activeProfileId: string | null;
  setActiveProfile: (profileId: string) => Promise<void>;
  createProfile: (label: string) => Promise<NavProfile>;
  renameProfile: (profileId: string, label: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  reorderProfiles: (orderedIds: string[]) => Promise<void>;
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
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profilesRes, catRes] = await Promise.all([
        api<ProfilesResp>("/api/nav/profiles"),
        api<CatalogueResp>("/api/nav/catalogue"),
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
        ? `/api/nav/prefs?profile_id=${encodeURIComponent(targetId)}`
        : "/api/nav/prefs";
      const prefsRes = await api<PrefsResp>(prefsPath);
      setPrefs(prefsRes.prefs ?? []);
      setCustomGroups(prefsRes.groups ?? []);
      // Server returns the resolved profile_id — trust it as the source of truth
      // (it accounts for lazy-seed of Default on first load).
      setActiveProfileId(prefsRes.profile_id ?? targetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load nav");
      setPrefs([]);
      setCustomGroups([]);
      setCatalogue([]);
      setTags([]);
      setProfiles([]);
      setActiveProfileId(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refetch(); }, [refetch]);

  const save = useCallback(async (body: PutPrefsBody) => {
    const scoped: PutPrefsBody & { profile_id?: string } = activeProfileId
      ? { ...body, profile_id: activeProfileId }
      : body;
    await api("/api/nav/prefs", { method: "PUT", body: JSON.stringify(scoped) });
    await refetch();
  }, [refetch, activeProfileId]);

  const reset = useCallback(async () => {
    const path = activeProfileId
      ? `/api/nav/prefs?profile_id=${encodeURIComponent(activeProfileId)}`
      : "/api/nav/prefs";
    await api(path, { method: "DELETE" });
    await refetch();
  }, [refetch, activeProfileId]);

  const setActiveProfile = useCallback(async (profileId: string) => {
    await api("/api/nav/profiles/active", {
      method: "PUT",
      body: JSON.stringify({ profile_id: profileId }),
    });
    await refetch();
  }, [refetch]);

  const createProfile = useCallback(async (label: string) => {
    const created = await api<NavProfile>("/api/nav/profiles", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    await refetch();
    return created;
  }, [refetch]);

  const renameProfile = useCallback(async (profileId: string, label: string) => {
    await api(`/api/nav/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    });
    await refetch();
  }, [refetch]);

  const deleteProfile = useCallback(async (profileId: string) => {
    await api(`/api/nav/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
    await refetch();
  }, [refetch]);

  const reorderProfiles = useCallback(async (orderedIds: string[]) => {
    await api("/api/nav/profiles/order", {
      method: "PUT",
      body: JSON.stringify({ profile_ids: orderedIds }),
    });
    await refetch();
  }, [refetch]);

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
      await api("/api/nav/bookmark", {
        method: "POST",
        body: JSON.stringify({ entity_kind: kind, entity_id: id }),
      });
      await refetch();
    },
    [refetch],
  );

  const unbookmark = useCallback(
    async (kind: EntityKind, id: string) => {
      await api("/api/nav/bookmark", {
        method: "DELETE",
        body: JSON.stringify({ entity_kind: kind, entity_id: id }),
      });
      await refetch();
    },
    [refetch],
  );

  const value: NavPrefsState = {
    prefs, customGroups, catalogue, tags, loading, error,
    refetch, save, reset,
    findEntry, isPinnable, defaultPinned, tagByEnum,
    isBookmarked, bookmark, unbookmark,
    profiles, activeProfileId,
    setActiveProfile, createProfile, renameProfile, deleteProfile, reorderProfiles,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavPrefs(): NavPrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavPrefs must be used inside NavPrefsProvider");
  return v;
}
