"use client";

// hook-allow-url-query: SentinelProvider writes `meg` (allow-listed in
// shareableParams.ts SHAREABLE_PARAMS) to the address bar when
// sentinel_set_focus is called. `meg` is the canonical scope-identity
// URL param across the project — name preserved from PLA-0053 (named
// after Rick's daughter Megan). This is the canonical writer; the
// legacy ScopeContext's window.history.replaceState was deleted at S22.

/**
 * SentinelProvider — single React provider that owns identity, tenant,
 * and scope state. Replaces AuthContext + ScopeContext + TenantContext
 * + the old Sentinel context + scopeReloadRegistry (see PLA062).
 *
 * Atomicity contract: `sentinel_switch_tenant(t2)` resolves with
 * `sentinel_tenant.id === t2` AND `sentinel_workspace_in_sync === true`
 * in the SAME render cycle. The race the original Sentinel patched
 * (a useEffect-driven reload firing one render late) is structurally
 * impossible here because the reducer accepts the new boot payload as
 * a single dispatch — there's no intermediate render where tenant has
 * changed but grants haven't.
 *
 * URL ?meg= is read once at boot via the parseMegFromURL helper
 * in app/lib/shareableParams.ts — that file is the canonical address-
 * bar param layer (allowlisted by the block-url-query-state hook).
 * Sentinel must not read window.location.search directly.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { parseMegFromURL } from "@/app/lib/shareableParams";
import {
  fetchBoot,
  postSwitchTenant,
  postSwitchWorkspace,
  putFocus,
  putSettings,
  sentinel_api_call as apiCall,
  setUnauthorizedHandler,
} from "./sentinel_api";
import type {
  SentinelBootPayload,
  SentinelGrant,
  SentinelPermission,
  SentinelState,
  SentinelTenant,
  SentinelUser,
  SentinelWorkspaceSettings,
} from "./types";

// ---------------------------------------------------------------------
// Internal state shape (the reducer's view — public surface is in
// SentinelState in types.ts and is built lazily from this).
// ---------------------------------------------------------------------

interface InternalState {
  user: SentinelUser | null;
  tenant: SentinelTenant | null;
  grants: SentinelGrant[];
  permissions: Set<SentinelPermission>;
  /** Tenant's root topology node — final fallback for focus resolution. */
  tenant_root: string | null;
  /** Override pinned by sentinel_set_focus or the URL ?meg= param. */
  focus_override: string | null;
  /** URL ?meg= sniffed once on mount; null if absent or invalid. */
  url_focus: string | null;
  /** Workspace-level settings (theme, tenant_name, …) — absorbed mid-S14. */
  settings: SentinelWorkspaceSettings | null;
  /** Local-only scope direction (no server persistence yet). */
  scope_direction: "ascend" | "descend";
  loading: boolean;
}

const initialState: InternalState = {
  user: null,
  tenant: null,
  grants: [],
  permissions: new Set(),
  tenant_root: null,
  focus_override: null,
  url_focus: null,
  settings: null,
  scope_direction: "descend",
  loading: true,
};

type Action =
  | { type: "boot_loaded"; payload: SentinelBootPayload }
  | { type: "set_focus"; nodeId: string | null }
  | { type: "set_url_focus"; nodeId: string | null }
  | { type: "set_settings"; settings: SentinelWorkspaceSettings }
  | { type: "set_scope_direction"; direction: "ascend" | "descend" }
  | { type: "loading_start" }
  | { type: "loading_done" };

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case "boot_loaded": {
      const p = action.payload;
      return {
        ...state,
        user: p.user,
        tenant: p.tenant,
        grants: p.grants,
        permissions: new Set(p.user.permissions),
        tenant_root: p.tenant_root,
        settings: p.settings ?? state.settings,
        loading: false,
      };
    }
    case "set_focus":
      return { ...state, focus_override: action.nodeId };
    case "set_url_focus":
      return { ...state, url_focus: action.nodeId };
    case "set_settings":
      return { ...state, settings: action.settings };
    case "set_scope_direction":
      return { ...state, scope_direction: action.direction };
    case "loading_start":
      return { ...state, loading: true };
    case "loading_done":
      return { ...state, loading: false };
  }
}

// ---------------------------------------------------------------------
// Resolve focus per the URL > user default > tenant root precedence.
// Mirrors the backend's resolveFocus logic; both must agree.
// ---------------------------------------------------------------------

function resolveFocusNode(state: InternalState): string | null {
  if (state.focus_override !== null) return state.focus_override;
  if (state.url_focus) return state.url_focus;
  if (state.user?.default_focus_node_id) return state.user.default_focus_node_id;
  return state.tenant_root;
}

// ---------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------

const SentinelCtx = createContext<SentinelState | null>(null);

/** Internal — useSentinel imports this from the barrel. */
export { SentinelCtx };

export function SentinelProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Sniff the URL ?meg= once on mount via the allowlisted helper.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseMegFromURL(window.location.search);
    if (fromUrl) dispatch({ type: "set_url_focus", nodeId: fromUrl });
  }, []);

  // Boot on mount.
  const reload = useCallback(async () => {
    dispatch({ type: "loading_start" });
    try {
      const payload = await fetchBoot();
      dispatch({ type: "boot_loaded", payload });
    } catch {
      dispatch({ type: "loading_done" });
    }
  }, []);

  // Register the 401 hook so any sentinel-mediated call that surfaces
  // a terminal 401 automatically re-boots us. The flag dedupes — we
  // don't want a 401 storm to fire N concurrent reloads.
  useEffect(() => {
    let inFlight = false;
    setUnauthorizedHandler(() => {
      if (inFlight) return;
      inFlight = true;
      void reload().finally(() => {
        inFlight = false;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [reload]);

  // Fire the initial boot.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Mirror the resolved focus into the URL so a fresh tab / post-login
  // load shows ?meg=<uuid> immediately — not blind. Without this the
  // address bar stays bare until the user clicks something in the
  // scope picker, which means bookmarks + refresh + share-the-URL
  // don't survive a re-load of the same view.
  //
  // We re-derive the focus from internal state (same precedence the
  // memo below uses): focus_override → url_focus → user default → tenant
  // root. Writes only when:
  //   - boot finished (tenant_root populated)
  //   - the derived focus disagrees with the address bar's current ?meg=
  // That second guard keeps us off an endless replaceState loop and
  // honours the user's intent if they manually wipe ?meg= from the
  // URL bar (we'd repopulate it on the next render, which is the right
  // behaviour for the "always-mirrored" property).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.loading) return;
    if (!state.tenant_root && !state.focus_override && !state.url_focus && !state.user?.default_focus_node_id) {
      return; // nothing resolved yet; don't write a stale URL
    }
    const focus =
      state.focus_override ??
      state.url_focus ??
      state.user?.default_focus_node_id ??
      state.tenant_root;
    if (!focus) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("meg") === focus) return; // already in sync
      url.searchParams.set("meg", focus);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // edge environments without window.URL — non-fatal
    }
  }, [state.loading, state.focus_override, state.url_focus, state.user, state.tenant_root]);

  const switchTenant = useCallback(async (tenantId: string) => {
    dispatch({ type: "loading_start" });
    const payload = await postSwitchTenant(tenantId);
    dispatch({ type: "boot_loaded", payload });
  }, []);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    dispatch({ type: "loading_start" });
    const payload = await postSwitchWorkspace(workspaceId);
    dispatch({ type: "boot_loaded", payload });
  }, []);

  const setFocus = useCallback(async (nodeId: string | null) => {
    dispatch({ type: "set_focus", nodeId });
    // Write the focus to the URL so it survives a refresh and so the
    // `?meg=` forwarder in app/lib/api.ts can read the active scope.
    // `meg` is the canonical scope-identity URL param across the
    // project (PLA-0053, named after Rick's daughter Megan) — it's in
    // SHAREABLE_PARAMS, so the block-url-query-state hook permits this
    // write via the file-level hook-allow-url-query annotation.
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        if (nodeId) url.searchParams.set("meg", nodeId);
        else url.searchParams.delete("meg");
        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
        // edge environments may not expose URL; non-fatal
      }
    }
    await putFocus(nodeId);
  }, []);

  const setScopeDirection = useCallback((direction: "ascend" | "descend") => {
    dispatch({ type: "set_scope_direction", direction });
  }, []);

  const setSettings = useCallback(async (settings: SentinelWorkspaceSettings) => {
    // Optimistic: update local cache immediately; the server PUT
    // returns the saved record which we then re-dispatch so any
    // server-side massaging (defaults, normalisation) lands in state.
    dispatch({ type: "set_settings", settings });
    const saved = await putSettings(settings);
    dispatch({ type: "set_settings", settings: saved });
  }, []);

  // ---------------------------------------------------------------
  // Public surface — derived from internal state on every render.
  // useMemo keeps the object identity stable when nothing changed,
  // so consumers using `useSentinel().sentinel_can` as a dep don't
  // re-run effects on every parent render.
  // ---------------------------------------------------------------

  const value: SentinelState = useMemo(() => {
    const focus_node = resolveFocusNode(state);
    const workspaceInSync =
      !state.tenant || !state.user || state.user.tenant_id === state.tenant.id;

    return {
      sentinel_user: state.user,
      sentinel_role: state.user?.role ?? null,
      sentinel_permissions: state.permissions,
      sentinel_tenant: state.tenant,
      sentinel_grants: state.grants,
      sentinel_focus_node: focus_node,
      sentinel_scope_up: true,
      sentinel_scope_down: true,
      sentinel_scope_direction: state.scope_direction,
      sentinel_settings: state.settings,
      sentinel_workspace_in_sync: workspaceInSync,
      sentinel_loading: state.loading,
      sentinel_switch_tenant: switchTenant,
      sentinel_switch_workspace: switchWorkspace,
      sentinel_set_focus: setFocus,
      sentinel_set_scope_direction: setScopeDirection,
      sentinel_set_settings: setSettings,
      sentinel_can: (code: SentinelPermission) => state.permissions.has(code),
      sentinel_reload: reload,
      sentinel_api_call: async (input, init) => {
        const path = typeof input === "string" ? input : input.toString();
        const wrapped = await apiCall(path, init);
        // Synthesize a Response so consumers see a familiar shape.
        return new Response(JSON.stringify(await wrapped.json()), {
          status: wrapped.status,
        });
      },
    };
  }, [state, switchTenant, switchWorkspace, setFocus, setScopeDirection, setSettings, reload]);

  return <SentinelCtx.Provider value={value}>{children}</SentinelCtx.Provider>;
}
