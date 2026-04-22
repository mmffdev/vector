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
}

interface PrefsResp { prefs: PrefRow[]; }
interface CatalogueResp { catalogue: NavCatalogEntry[]; tags: NavTagGroup[]; }

export interface PutPrefsBody {
  pinned: { item_key: string; position: number }[];
  start_page_key: string | null;
}

interface NavPrefsState {
  prefs: PrefRow[];
  catalogue: NavCatalogEntry[];
  tags: NavTagGroup[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  save: (body: PutPrefsBody) => Promise<void>;
  reset: () => Promise<void>;
  // Lookups — resolve a key against the catalogue the server gave us.
  // Callers should not reach past these; the catalogue is the authority.
  findEntry: (key: string) => NavCatalogEntry | undefined;
  isPinnable: (key: string) => boolean;
  defaultPinned: NavCatalogEntry[];
  tagByEnum: (enumKey: string) => NavTagGroup | undefined;
}

const Ctx = createContext<NavPrefsState | null>(null);

export function NavPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [catalogue, setCatalogue] = useState<NavCatalogEntry[]>([]);
  const [tags, setTags] = useState<NavTagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) {
      setPrefs([]);
      setCatalogue([]);
      setTags([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [prefsRes, catRes] = await Promise.all([
        api<PrefsResp>("/api/nav/prefs"),
        api<CatalogueResp>("/api/nav/catalogue"),
      ]);
      setPrefs(prefsRes.prefs ?? []);
      setCatalogue(catRes.catalogue ?? []);
      setTags(catRes.tags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load nav");
      setPrefs([]);
      setCatalogue([]);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refetch(); }, [refetch]);

  const save = useCallback(async (body: PutPrefsBody) => {
    await api("/api/nav/prefs", { method: "PUT", body: JSON.stringify(body) });
    await refetch();
  }, [refetch]);

  const reset = useCallback(async () => {
    await api("/api/nav/prefs", { method: "DELETE" });
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
        .sort((a, b) => a.defaultOrder - b.defaultOrder),
    [catalogue],
  );

  const value: NavPrefsState = {
    prefs, catalogue, tags, loading, error,
    refetch, save, reset,
    findEntry, isPinnable, defaultPinned, tagByEnum,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavPrefs(): NavPrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavPrefs must be used inside NavPrefsProvider");
  return v;
}
