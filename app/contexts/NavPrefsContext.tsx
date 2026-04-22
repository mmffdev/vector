"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

export interface PrefRow {
  item_key: string;
  position: number;
  is_start_page: boolean;
}

interface PrefsResp { prefs: PrefRow[]; }

export interface PutPrefsBody {
  pinned: { item_key: string; position: number }[];
  start_page_key: string | null;
}

interface NavPrefsState {
  prefs: PrefRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  save: (body: PutPrefsBody) => Promise<void>;
  reset: () => Promise<void>;
}

const Ctx = createContext<NavPrefsState | null>(null);

export function NavPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) {
      setPrefs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api<PrefsResp>("/api/nav/prefs");
      setPrefs(res.prefs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load prefs");
      setPrefs([]);
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

  return <Ctx.Provider value={{ prefs, loading, error, refetch, save, reset }}>{children}</Ctx.Provider>;
}

export function useNavPrefs(): NavPrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavPrefs must be used inside NavPrefsProvider");
  return v;
}
