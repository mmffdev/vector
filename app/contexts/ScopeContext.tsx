"use client";

// PLA-0042 — Scope picker substrate. Holds the user's live grants
// (the topology nodes they hold a role on) and the currently active
// scope. Active scope is persisted server-side via PUT /api/me/active-scope
// so it survives across devices and sessions. localStorage is the
// optimistic read-before-network cache. Node IDs never appear in the URL.
//
// Precedence on load: server profile → localStorage fallback → null.
// This context is read-only from the perspective of grant data: the
// authoritative list comes from GET /api/topology/grants/me. The user
// changes their *active* scope via setActiveNodeId; admins change the
// grant list itself via the topology editor.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { topologyApi, type MyGrant } from "@/app/lib/topologyApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { apiSite, ApiError } from "@/app/lib/api";
import { WORKSPACES_CHANGED_EVENT } from "@/app/lib/workspacesApi";
import { registerScopeReload, unregisterScopeReload } from "@/app/contexts/Sentinel";

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

  const [grants, setGrants] = useState<MyGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeIdState] = useState<string | null>(null);
  // Track whether we've done the initial server-profile seed for this session.
  const profileSeededRef = useRef(false);

  const reload = useCallback(async () => {
    if (!user) {
      setGrants([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await topologyApi.listMyGrants();
      setGrants(data);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to load scope";
      setError(msg);
      setGrants([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial + on user change — reset seed flag so the new user's profile is read.
  useEffect(() => {
    if (authLoading) return;
    profileSeededRef.current = false;
    void reload();
  }, [authLoading, reload]);

  // Reload grants whenever a workspace is created, archived, or restored.
  useEffect(() => {
    function onWorkspacesChanged() { void reload(); }
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onWorkspacesChanged);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, onWorkspacesChanged);
  }, [reload]);

  // B16.8 P3 — expose this provider's latest `reload` to
  // AuthContext.switchWorkspace via a module-level ref so the
  // workspace-switch path can await an immediate grant refresh.
  // Keyed on `reload` (stable per-user via useCallback), so registration
  // re-fires only when the user identity changes — that's exactly when
  // a fresh closure is needed. On unmount we restore the no-op default
  // so a stale provider reference can't be invoked.
  useEffect(() => {
    registerScopeReload(reload);
    return unregisterScopeReload;
  }, [reload]);

  // Resolve the active scope each time grants land.
  // First load: seed from server profile (fallback: localStorage).
  // Subsequent reloads (panel open, workspace change): validate current
  // activeNodeId against the new grant list only — no extra server round-trip.
  useEffect(() => {
    if (grants.length === 0) {
      setActiveNodeIdState(null);
      return;
    }

    if (!profileSeededRef.current) {
      // First grants load — read the server profile to pick the right node.
      profileSeededRef.current = true;
      const seed = async () => {
        let candidate: string | null = null;
        try {
          const resp = await apiSite<{ node_id: string | null }>("/me/active-scope");
          candidate = resp.node_id ?? readStoredId();
        } catch {
          candidate = readStoredId();
        }
        const match = candidate ? grants.find((g) => g.node_id === candidate) : null;
        if (candidate && !match) {
          writeStoredId(null);
          apiSite("/me/active-scope", { method: "PUT", body: JSON.stringify({ node_id: null }) }).catch(() => {});
        }
        const resolved = match ? match.node_id : null;
        setActiveNodeIdState(resolved);
        if (resolved) writeStoredId(resolved);
      };
      void seed();
    } else {
      // Subsequent reloads — just validate against the refreshed grant list.
      setActiveNodeIdState((prev) => {
        if (!prev) return null;
        const still = grants.find((g) => g.node_id === prev);
        if (!still) { writeStoredId(null); return null; }
        return prev;
      });
    }
  }, [grants]);

  const setActiveNodeId = useCallback((id: string | null) => {
    setActiveNodeIdState(id);
    writeStoredId(id);
    // Fire-and-forget — failure is non-fatal; localStorage is the fallback.
    apiSite("/me/active-scope", { method: "PUT", body: JSON.stringify({ node_id: id }) }).catch(() => {});
  }, []);

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
