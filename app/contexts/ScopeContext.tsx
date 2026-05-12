"use client";

// PLA-0042 — Scope picker substrate. Holds the user's live grants
// (the topology nodes they hold a role on) and the currently active
// scope. Active scope is persisted to the URL (`?scope=<node_id>`)
// so deep-links round-trip, and to localStorage as the fallback the
// next time the user lands without a scope query.
//
// This context is read-only from the perspective of grant data: the
// authoritative list comes from GET /api/topology/grants/me. The user
// changes their *active* scope via setActiveNodeId; admins change the
// grant list itself via the topology editor.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { topologyApi, type MyGrant } from "@/app/lib/topologyApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { ApiError } from "@/app/lib/api";

const STORAGE_KEY = "vector.scope.activeNodeId";

interface ScopeValue {
  grants: MyGrant[];
  activeNodeId: string | null;
  activeGrant: MyGrant | null;
  loading: boolean;
  error: string | null;
  setActiveNodeId: (id: string | null) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<ScopeValue | null>(null);

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be disabled (private mode, quota) — non-fatal.
  }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [grants, setGrants] = useState<MyGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeIdState] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setGrants([]);
      return;
    }
    setLoading(true);
    setError(null);
    console.log("[ScopeContext] reload start", { user_id: user.id, role: user.role });
    try {
      const data = await topologyApi.listMyGrants();
      console.log("[ScopeContext] grants loaded", { count: data.length, grants: data });
      setGrants(data);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to load scope";
      console.log("[ScopeContext] grants error", msg, e);
      setError(msg);
      setGrants([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial + on user change.
  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // Resolve the active scope each time grants land or the URL changes.
  // Precedence: ?scope=<id> → localStorage → null. Falls back to null
  // if the id no longer matches a live grant (grant revoked, node archived).
  useEffect(() => {
    if (grants.length === 0) {
      setActiveNodeIdState(null);
      return;
    }
    const urlId = searchParams?.get("scope") ?? null;
    const storedId = readStoredId();
    const candidate = urlId ?? storedId;
    const match = candidate && grants.find((g) => g.node_id === candidate);
    setActiveNodeIdState(match ? match.node_id : null);
  }, [grants, searchParams]);

  const setActiveNodeId = useCallback(
    (id: string | null) => {
      setActiveNodeIdState(id);
      writeStoredId(id);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (id) params.set("scope", id);
      else params.delete("scope");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const activeGrant = useMemo(
    () => grants.find((g) => g.node_id === activeNodeId) ?? null,
    [grants, activeNodeId],
  );

  const value = useMemo<ScopeValue>(
    () => ({
      grants,
      activeNodeId,
      activeGrant,
      loading,
      error,
      setActiveNodeId,
      reload,
    }),
    [grants, activeNodeId, activeGrant, loading, error, setActiveNodeId, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): ScopeValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      grants: [],
      activeNodeId: null,
      activeGrant: null,
      loading: false,
      error: null,
      setActiveNodeId: () => {},
      reload: async () => {},
    };
  }
  return v;
}
