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
  // Convenience wrapper for the Account-Settings homepage dropdown: writes
  // start_page_key while preserving the existing pinned list + groups, and
  // auto-pins the target page if it isn't already pinned (the backend
  // rejects start_page_key not present in the pinned list with
  // ErrStartPageNotPinned — service.go:424).
  setStartPageKey: (next: string | null) => Promise<void>;
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

// SWR cache for the full nav payload. Hydrated synchronously on mount so
// rails 1 + 2 render with last session's contents instead of empty arrays
// (which produced a 150-400ms FOUC while /nav/profiles + /nav/catalogue +
// /nav/prefs + /nav/profiles/{id}/groups round-tripped). The network
// refetch still runs every mount and silently overwrites state when it
// resolves, so out-of-tab edits reconcile within one request cycle.
//
// Cache key is user-scoped so account switching never bleeds prefs from
// one user to another. Bumping CACHE_VERSION invalidates every existing
// cache (used when the payload shape changes incompatibly).
const CACHE_VERSION = "v1";
const cacheKey = (userId: string) => `nav:${CACHE_VERSION}:${userId}`;

interface NavCacheShape {
  prefs: PrefRow[];
  customGroups: NavCustomGroup[];
  catalogue: NavCatalogEntry[];
  tags: NavTagGroup[];
  profiles: NavProfile[];
  activeProfileId: string | null;
  profileGroups: ProfileGroupPlacement[];
}

function readCache(userId: string | undefined): NavCacheShape | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as NavCacheShape;
  } catch {
    return null;
  }
}

function writeCache(userId: string | undefined, payload: NavCacheShape): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(payload));
  } catch {
    // Quota or private mode — silent. Worst case the user sees the same
    // 150-400ms flash on their next visit; nothing functional breaks.
  }
}

export function NavPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Hydrate from cache synchronously so the very first render has data.
  // The network refetch still runs and overwrites everything when it lands.
  const initial = useMemo(() => readCache(user?.id), [user?.id]);
  const [prefs, setPrefs] = useState<PrefRow[]>(initial?.prefs ?? []);
  const [customGroups, setCustomGroups] = useState<NavCustomGroup[]>(initial?.customGroups ?? []);
  const [catalogue, setCatalogue] = useState<NavCatalogEntry[]>(initial?.catalogue ?? []);
  const [tags, setTags] = useState<NavTagGroup[]>(initial?.tags ?? []);
  const [profiles, setProfiles] = useState<NavProfile[]>(initial?.profiles ?? []);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(initial?.activeProfileId ?? null);
  const [profileGroups, setProfileGroupsState] = useState<ProfileGroupPlacement[]>(initial?.profileGroups ?? []);
  // `loading` is true only when there's no cache to render. With a cache
  // hit the rails render immediately and the background refetch is silent.
  const [loading, setLoading] = useState(initial === null);
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
    // Only flip `loading=true` when the rails have nothing to render. With
    // a cache hit the rails are already populated — the refetch is silent
    // background reconciliation and shouldn't trigger any skeleton flash.
    setLoading((prev) => prev || prefs.length === 0);
    setError(null);
    try {
      const [profilesRes, catRes] = await Promise.all([
        apiSite<ProfilesResp>("/nav/profiles"),
        apiSite<CatalogueResp>("/nav/catalogue"),
      ]);
      const profileList = profilesRes.profiles ?? [];
      const nextCatalogue = catRes.catalogue ?? [];
      const nextTags = catRes.tags ?? [];
      setProfiles(profileList);
      setCatalogue(nextCatalogue);
      setTags(nextTags);

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
      const nextPrefs = prefsRes.prefs ?? [];
      const nextGroups = prefsRes.groups ?? [];
      setPrefs(nextPrefs);
      setCustomGroups(nextGroups);
      // Server returns the resolved profile_id — trust it as the source of truth
      // (it accounts for lazy-seed of Default on first load).
      const resolvedProfileId = prefsRes.profile_id ?? targetId;
      setActiveProfileId(resolvedProfileId);

      // Per-profile placements (tag-bucket + custom-group order). Best-
      // effort: if the call fails we fall back to canonical order rather
      // than blocking the whole prefs load.
      let nextProfileGroups: ProfileGroupPlacement[] = [];
      if (resolvedProfileId) {
        try {
          const groupsRes = await apiSite<ProfileGroupsResp>(
            `/nav/profiles/${encodeURIComponent(resolvedProfileId)}/groups`,
          );
          nextProfileGroups = groupsRes.placements ?? [];
        } catch {
          nextProfileGroups = [];
        }
      }
      setProfileGroupsState(nextProfileGroups);

      // Persist for next session's SWR hydration. Writing only after a
      // fully successful round trip avoids caching a partial payload
      // (e.g. when the profile-groups call failed silently above).
      writeCache(user.id, {
        prefs: nextPrefs,
        customGroups: nextGroups,
        catalogue: nextCatalogue,
        tags: nextTags,
        profiles: profileList,
        activeProfileId: resolvedProfileId,
        profileGroups: nextProfileGroups,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load nav");
      // Don't wipe state on failure when we have cached data — keep the
      // rails showing the last-known-good payload rather than collapsing
      // to empty. Only clear when there was nothing to lose.
      if (prefs.length === 0) {
        setPrefs([]);
        setCustomGroups([]);
        setCatalogue([]);
        setTags([]);
        setProfiles([]);
        setActiveProfileId(null);
        setProfileGroupsState([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user, prefs.length]);

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

  const setStartPageKey = useCallback(
    async (next: string | null) => {
      // The backend's validatePinned enforces (service.go:602):
      //   - top-level positions form contiguous 0..N-1
      //   - top-level items sharing a tag/custom group must be contiguous
      //   - per-parent child positions: no duplicates
      // We can't just copy prefs[].position through — it's per-bucket-
      // relative. Mirror /user/navigation/page.tsx:1804-1814: group by
      // bucket (tag for catalogue items, group_id for user_custom), preserve
      // relative order within each bucket, then assign fresh positions.
      // Filter to keys currently visible in this caller's role-clamped
      // catalogue. The hydrated-from-localStorage prefs can carry keys
      // from a previous session under a different role — sending them
      // back triggers ErrRoleForbidden (service.go:626) which the
      // backend (correctly) treats as a hard 400. Drop silently here;
      // the user's intent is "set my home page", not "preserve every
      // pinned entry from a prior identity".
      const inCatalogue = (key: string): boolean => byKey.has(key);
      const topLevel = prefs.filter(
        (p) => !p.is_bookmark && !p.parent_item_key && inCatalogue(p.item_key),
      );
      const childrenByParent = new Map<string, PrefRow[]>();
      const topLevelKeys = new Set(topLevel.map((p) => p.item_key));
      for (const p of prefs) {
        if (p.is_bookmark || !p.parent_item_key) continue;
        if (!inCatalogue(p.item_key)) continue;
        if (!topLevelKeys.has(p.parent_item_key)) continue;
        const arr = childrenByParent.get(p.parent_item_key) ?? [];
        arr.push(p);
        childrenByParent.set(p.parent_item_key, arr);
      }

      // Bucket the top-level items (tag for catalogue rows, group:<id> for
      // user_custom). First-seen ordering preserves the user's current
      // arrangement; auto-pin of `next` appends to its bucket if needed.
      const bucketOrder: string[] = [];
      const byBucket = new Map<string, PrefRow[]>();
      const bucketOf = (p: PrefRow): string => {
        if (p.group_id) return `g:${p.group_id}`;
        const entry = byKey.get(p.item_key);
        const tag = entry?.tagEnum || "personal";
        return `t:${tag}`;
      };
      for (const p of topLevel.slice().sort((a, b) => a.position - b.position)) {
        const b = bucketOf(p);
        if (!byBucket.has(b)) { byBucket.set(b, []); bucketOrder.push(b); }
        byBucket.get(b)!.push(p);
      }

      // Auto-pin the target page if absent (backend rejects start_page_key
      // not present in pinned, ErrStartPageNotPinned at service.go:424).
      if (next && !topLevel.some((p) => p.item_key === next)) {
        const entry = byKey.get(next);
        if (entry) {
          const bucket = entry.kind === "user_custom"
            ? null // never auto-create user_custom; punt to navigation page
            : `t:${entry.tagEnum || "personal"}`;
          if (bucket) {
            if (!byBucket.has(bucket)) { byBucket.set(bucket, []); bucketOrder.push(bucket); }
            byBucket.get(bucket)!.push({
              item_key: next,
              position: 0,
              is_start_page: false,
              is_bookmark: false,
              parent_item_key: null,
              group_id: null,
              icon_override: null,
            });
          }
        }
      }

      const pinned: PutPrefsPinnedRow[] = [];
      let topPos = 0;
      for (const bucket of bucketOrder) {
        for (const p of byBucket.get(bucket)!) {
          pinned.push({
            item_key: p.item_key,
            position: topPos++,
            parent_item_key: null,
            group_id: p.group_id,
            icon_override: p.icon_override,
          });
          const kids = childrenByParent.get(p.item_key) ?? [];
          let childPos = 0;
          for (const c of kids.slice().sort((a, b) => a.position - b.position)) {
            pinned.push({
              item_key: c.item_key,
              position: childPos++,
              parent_item_key: p.item_key,
              group_id: null,
              icon_override: c.icon_override,
            });
          }
        }
      }

      // Rewrite group positions from array index to guarantee contiguous
      // 0..N-1 — matches /user/navigation/page.tsx:1815-1820. Trusting the
      // cached g.position can fire ErrBadPositions if the cache is stale.
      const sortedGroups = customGroups.slice().sort((a, b) => a.position - b.position);
      const groups: PutPrefsGroupRow[] = sortedGroups.map((g, i) => ({
        id: g.id,
        label: g.label,
        position: i,
        icon: g.icon,
      }));
      await save({ pinned, start_page_key: next, groups });
    },
    [prefs, customGroups, save, byKey],
  );

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
    refetch, patchCatalogueEntry, save, setStartPageKey, reset,
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
