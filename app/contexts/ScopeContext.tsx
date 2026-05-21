"use client";
// hook-allow-url-query: ScopeContext is the canonical writer/reader of the
// ?meg= URL param (active scope node). Carveout from PLA-0053 per
// TD-URL-SCOPE-PARAM-CUTOVER — the rest of the address bar stays path-only.

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
import { apiSite, ApiError, setScopeDirection as apiSetScopeDirection } from "@/app/lib/api";
import { WORKSPACES_CHANGED_EVENT } from "@/app/lib/workspacesApi";
import { registerScopeReload, unregisterScopeReload } from "@/app/contexts/Sentinel";

const STORAGE_KEY = "vector.scope.activeNodeId";

// URL is the canonical source for active scope. localStorage + server
// profile remain as fallbacks for first-paint and cross-device persistence
// (TD-URL-SCOPE-PARAM-CUTOVER). The address-bar param is `?meg=`.
const URL_PARAM = "meg";

function readUrlMeg(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM);
  } catch {
    return null;
  }
}

function writeUrlMeg(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(URL_PARAM, id);
    else url.searchParams.delete(URL_PARAM);
    // replaceState — no history entry per scope flip; back-button still
    // navigates between pages, not scope picks.
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // URL parsing may fail in edge environments — non-fatal, fallbacks cover.
  }
}

// Scope direction: "descend" = selected node + its children (default,
// matches how lists "scope into" a node); "ascend" = node + ancestors,
// used by reports that aggregate up the chain. Kept in module state via
// setScopeDirection() in app/lib/api.ts so api() can inject scope_dir=
// without us threading it through every call site.
export type ScopeDirection = "descend" | "ascend";

interface ScopeValue {
  grants: MyGrant[];
  activeNodeId: string | null;
  activeGrant: MyGrant | null;
  direction: ScopeDirection;
  setDirection: (d: ScopeDirection) => void;
  loading: boolean;
  error: string | null;
  setActiveNodeId: (id: string | null) => void;
  reload: () => Promise<void>;
  // Slice 7 follow-up (fix for first-load empty-grid race, 2026-05-21):
  // true once auth has settled AND the initial profile-seed step has
  // finished (or the user has no grants, in which case there's nothing to
  // seed). Consumers like useObjectTreeWindow gate their initial fetch
  // on this so the first request goes out with the right `?meg=` clamp,
  // rather than racing the seed and sending an empty/wrong scope.
  scopeReady: boolean;
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
  const { user, loading: authLoading, switchWorkspace } = useAuth();

  const [grants, setGrants] = useState<MyGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeIdState] = useState<string | null>(null);
  const [direction, setDirectionState] = useState<ScopeDirection>("descend");
  // Track whether we've done the initial server-profile seed for this session.
  const profileSeededRef = useRef(false);
  // 2026-05-21 — see ScopeValue.scopeReady. Flips true exactly once per
  // user-session: after the first `seed()` async resolves OR after we
  // determine there are no grants to seed. Consumers gate their initial
  // fetch on this flag to avoid racing the bootstrap.
  const [scopeReady, setScopeReady] = useState(false);

  // Wrap setDirection so it mirrors into the module-level state read by
  // api() in app/lib/api.ts — keeps the URL forwarding logic in lockstep
  // with the React state. No server roundtrip; direction is a presentation
  // toggle.
  const setDirection = useCallback((d: ScopeDirection) => {
    setDirectionState(d);
    apiSetScopeDirection(d);
  }, []);

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
    // Reset the ready flag on user change too: a new user means a new
    // bootstrap, and consumers need to re-gate their initial fetches.
    setScopeReady(false);
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
      // No grants to seed — the bootstrap is "done" by exhaustion.
      // Consumers gated on scopeReady can proceed (their fetches will
      // simply run without a `?meg=` clamp).
      setScopeReady(true);
      return;
    }

    if (!profileSeededRef.current) {
      // First grants load — precedence: URL ?meg= > server profile > localStorage.
      // The URL wins because it's the only source that's race-free at call
      // time (the bug TD-URL-SCOPE-PARAM-CUTOVER pays down).
      profileSeededRef.current = true;
      const seed = async () => {
        let candidate: string | null = readUrlMeg();
        if (!candidate) {
          try {
            const resp = await apiSite<{ node_id: string | null }>("/me/active-scope");
            candidate = resp.node_id ?? readStoredId();
          } catch {
            candidate = readStoredId();
          }
        }
        const match = candidate ? grants.find((g) => g.node_id === candidate) : null;
        if (candidate && !match) {
          writeStoredId(null);
          writeUrlMeg(null);
          apiSite("/me/active-scope", { method: "PUT", body: JSON.stringify({ node_id: null }) }).catch(() => {});
        }
        const resolved = match ? match.node_id : null;
        setActiveNodeIdState(resolved);
        if (resolved) {
          writeStoredId(resolved);
          writeUrlMeg(resolved);
        }
        // Bootstrap complete — gated consumers can fire their first fetch
        // now that activeNodeId is in its settled state.
        setScopeReady(true);
      };
      void seed();
    } else {
      // Subsequent reloads — just validate against the refreshed grant list.
      setActiveNodeIdState((prev) => {
        if (!prev) return null;
        const still = grants.find((g) => g.node_id === prev);
        if (!still) { writeStoredId(null); writeUrlMeg(null); return null; }
        return prev;
      });
    }
  }, [grants]);

  const setActiveNodeId = useCallback((id: string | null) => {
    // 2026-05-21 — auto-switch JWT-workspace when scope-picking a node
    // in a different workspace. Closes the desync the B16.8 P3
    // `sentinel.workspaceInSync` overlay was firing on: the picker
    // accepts cross-workspace grants but the JWT-stamped workspace
    // clamp (`WorkspaceClampMiddleware` at backend/internal/topology/
    // middleware.go:337-343) reads workspace_id straight from the
    // JWT. Without the switch, list endpoints (which honour `?meg=`)
    // returned the new workspace's rows, but per-item GETs clamped to
    // the OLD JWT-workspace and 404'd. Triggering switchWorkspace
    // reissues the JWT with the right claim BEFORE we commit the new
    // node — list + get are then aligned.
    //
    // Local state writes are deferred until after switchWorkspace
    // resolves so a failed switch doesn't leave the picker pointing
    // at a node we couldn't actually authorise into. The function
    // signature stays sync for caller back-compat; the JWT swap fires
    // as an async side-effect that the caller doesn't await.
    if (id) {
      const targetGrant = grants.find((g) => g.node_id === id);
      const needsSwap =
        targetGrant != null &&
        user?.workspace_id != null &&
        targetGrant.workspace_id !== user.workspace_id;
      if (needsSwap && targetGrant) {
        void (async () => {
          try {
            await switchWorkspace(targetGrant.workspace_id);
          } catch {
            // Switch failed — stop, don't half-apply. Caller's UI will
            // see no scope change and can prompt the user to retry.
            return;
          }
          setActiveNodeIdState(id);
          writeUrlMeg(id);
          writeStoredId(id);
          apiSite("/me/active-scope", { method: "PUT", body: JSON.stringify({ node_id: id }) }).catch(() => {});
        })();
        return;
      }
    }
    setActiveNodeIdState(id);
    writeUrlMeg(id);
    writeStoredId(id);
    // Fire-and-forget — failure is non-fatal; URL + localStorage are the fallbacks.
    apiSite("/me/active-scope", { method: "PUT", body: JSON.stringify({ node_id: id }) }).catch(() => {});
  }, [grants, user?.workspace_id, switchWorkspace]);

  const activeGrant = useMemo(
    () => grants.find((g) => g.node_id === activeNodeId) ?? null,
    [grants, activeNodeId],
  );

  const value = useMemo<ScopeValue>(
    () => ({
      grants,
      activeNodeId,
      activeGrant,
      direction,
      setDirection,
      loading,
      error,
      setActiveNodeId,
      reload,
      scopeReady,
    }),
    [grants, activeNodeId, activeGrant, direction, setDirection, loading, error, setActiveNodeId, reload, scopeReady],
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
      direction: "descend",
      setDirection: () => {},
      loading: false,
      error: null,
      setActiveNodeId: () => {},
      reload: async () => {},
      // Fallback used when no provider is mounted (login pages, etc.).
      // No grants → no bootstrap to wait on → "ready" is the truthful default.
      scopeReady: true,
    };
  }
  return v;
}
