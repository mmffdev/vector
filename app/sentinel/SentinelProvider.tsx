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
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { AuthContext } from "@/app/contexts/AuthContext";
import { ApiError } from "@/app/lib/api";
import { parseMegFromURL } from "@/app/lib/shareableParams";
import {
  fetchBoot,
  postSwitchTenant,
  postSwitchWorkspace,
  putFocus,
  putHomeFollowMode,
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
  | { type: "set_user_default_focus"; nodeId: string | null }
  | { type: "set_user_follow_mode"; follow: boolean }
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
    case "set_user_default_focus":
      // Mirrors the server-side users.default_focus_node_id write so
      // the dropdown on /user/account-settings reflects the new value
      // immediately. Used optimistically by setFocus() when follow mode
      // is ON; reverted on server failure. No-op when state.user is
      // null (boot in flight).
      if (!state.user) return state;
      return {
        ...state,
        user: { ...state.user, default_focus_node_id: action.nodeId },
      };
    case "set_user_follow_mode":
      // Mirrors users.home_location_follow_mode. Used optimistically
      // by the Pinned/Follow toggle on /user/account-settings; reverted
      // on server failure.
      if (!state.user) return state;
      return {
        ...state,
        user: { ...state.user, home_location_follow_mode: action.follow },
      };
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

  // stateRef tracks the latest reducer state so the action callbacks
  // (setFocus etc.) can read fresh values inside their try/catch revert
  // paths WITHOUT having `state` in their useCallback deps — keeping
  // those deps empty preserves stable function identity across renders
  // (consumers using sentinel_set_focus in effect deps would re-fire
  // otherwise). The single React-y rule: read via stateRef.current only
  // inside async callbacks, never during the render pass.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Sniff the URL ?meg= once on mount via the allowlisted helper.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseMegFromURL(window.location.search);
    if (fromUrl) dispatch({ type: "set_url_focus", nodeId: fromUrl });
  }, []);

  // Boot on mount.
  // hasBootedRef gates the 401 reload hook. The hook is a "session
  // went stale mid-life, re-boot to pick up the new state" mechanism;
  // firing it BEFORE boot has ever succeeded just chains fetchBoot →
  // 401 → reload → fetchBoot forever on a logged-out tab. The
  // (user)/layout.tsx redirect to /login is the correct response to
  // a never-had-a-session state, not another fetchBoot attempt.
  const hasBootedRef = useRef(false);

  const reload = useCallback(async () => {
    dispatch({ type: "loading_start" });
    try {
      const payload = await fetchBoot();
      dispatch({ type: "boot_loaded", payload });
      hasBootedRef.current = true;
    } catch (err) {
      dispatch({ type: "loading_done" });
      // Terminal-session-state 401s (session_revoked, session_idle_expired,
      // session_anomaly): the JWT is dead, the page would render an empty
      // sentinel_user and the (user)/layout's route-group guard wouldn't
      // know to redirect — AuthContext's hardLogout may not have registered
      // yet because effect order runs child (SentinelProvider) before parent
      // (AuthProvider). Self-rescue here: hard-navigate to /login with a
      // reason hint so the user sees the right banner.
      // SSR-safe: window check guards against the render pass.
      if (typeof window !== "undefined" && err instanceof ApiError && err.status === 401) {
        const code = err.code;
        const terminalCodes = new Set(["session_revoked", "session_idle_expired", "session_anomaly"]);
        if (code && terminalCodes.has(code)) {
          try {
            sessionStorage.setItem("vector_logout_reason", code);
          } catch {
            // sessionStorage unavailable (private mode, locked-down env) — non-fatal
          }
          window.location.assign("/login");
        }
      }
    }
  }, []);

  // Register the 401 hook so any sentinel-mediated call that surfaces
  // a terminal 401 automatically re-boots us. Two guards:
  //   - hasBootedRef: don't fire on a tab that never had a session
  //     (turns the boot-401 → reload → boot-401 loop into a single
  //     401 + a route-group redirect to /login).
  //   - inFlight: dedup a 401 storm onto one reload flight.
  useEffect(() => {
    let inFlight = false;
    setUnauthorizedHandler(() => {
      if (!hasBootedRef.current) return;
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

  // Re-boot Sentinel when AuthContext's user transitions from absent →
  // present (i.e. the user just logged in or refreshed into a new session).
  // Without this, the initial boot fires BEFORE login (when no JWT exists),
  // 401s, leaves sentinel_grants = [], and the post-login UI sees empty
  // grants forever — the dropdown on /user/account-settings reads
  // "You don't have access to any topology nodes yet" even though the
  // grants are in the DB. previousAuthUserIdRef tracks the transition so
  // we don't re-boot on every render or on logout.
  //
  // useContext(AuthContext) instead of useAuth() so test harnesses (which
  // historically mount SentinelProvider WITHOUT AuthProvider) don't throw —
  // the production tree always wraps Sentinel inside AuthProvider, so the
  // ctx is populated there. When ctx is null the re-boot effect is a no-op.
  const authCtx = useContext(AuthContext);
  const authUserId = authCtx?.user?.id ?? null;
  const previousAuthUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = previousAuthUserIdRef.current;
    previousAuthUserIdRef.current = authUserId;
    // Only fire when transitioning to a NEW authenticated user. Skip on
    // logout (next is null) and on re-renders with the same user.
    if (authUserId && authUserId !== prev) {
      // Clear any url_focus inherited from a pre-login URL (e.g. login
      // redirect preserved ?meg=<old-node> in the address bar). Without
      // this, the new user's default_focus_node_id is bypassed because
      // URL beats user-default in resolveFocusNode(). The mirror effect
      // will re-write ?meg= to the resolved focus on the next render.
      dispatch({ type: "set_url_focus", nodeId: null });
      void reload();
    }
  }, [authUserId, reload]);

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
    // Capture the previous user-row default so a server-side failure
    // (403 no-grant, 500, network) can revert. Read off the latest
    // state via the reducer ref pattern: we close over `state` here,
    // but the captured value is only used on the failure path so the
    // useCallback dep array can stay empty (avoids re-creating the
    // function on every render, which would invalidate every consumer
    // that reads sentinel_set_focus off the value object).
    const prevDefault = stateRef.current.user?.default_focus_node_id ?? null;
    // Migration-244 gate: only persist into users.default_focus_node_id
    // when the user has explicitly opted into Follow mode. Default is
    // Pinned (false) — scope-rail clicks should NOT silently overwrite
    // the user's chosen home. This restores the source-of-truth
    // separation the original Sentinel design intended.
    const followMode = stateRef.current.user?.home_location_follow_mode ?? false;

    dispatch({ type: "set_focus", nodeId });
    if (followMode) {
      // Optimistic mirror — the HomeLocationSection dropdown reads
      // user.default_focus_node_id for its <select value=…>; without
      // this the control would appear unchanged until the next /auth/me
      // boot. Reverted in catch{} below on server failure.
      dispatch({ type: "set_user_default_focus", nodeId });
    }

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

    // Pinned mode (default): NO server PUT. Scope-rail clicks update
    // only the session focus + URL ?meg=; the user's saved home stays
    // put. The Home Location dropdown uses a separate code path to
    // persist — it always passes through setFocus too, but does so
    // only after the user has flipped Follow mode ON or directly via
    // the dropdown's onChange (which calls setFocus with follow set).
    if (!followMode) return;

    try {
      await putFocus(nodeId);
    } catch (err) {
      // Revert the optimistic user-row mirror so the dropdown snaps
      // back to the prior selection. Leave focus_override alone — it
      // matches what the server would have resolved if the user
      // refreshed (the URL already carries the attempted value). The
      // caller (component) is expected to surface the error to the user.
      dispatch({ type: "set_user_default_focus", nodeId: prevDefault });
      throw err;
    }
  }, []);

  // Direct persistent write of the home location — used by the dropdown
  // on /user/account-settings. Bypasses the follow-mode gate because
  // picking from the dropdown is an EXPLICIT "I want to save this as my
  // home" act, regardless of toggle state. Same optimistic + revert
  // shape as the follow-mode path in setFocus().
  const setDefaultFocus = useCallback(async (nodeId: string | null) => {
    const prevDefault = stateRef.current.user?.default_focus_node_id ?? null;
    dispatch({ type: "set_user_default_focus", nodeId });
    try {
      await putFocus(nodeId);
    } catch (err) {
      dispatch({ type: "set_user_default_focus", nodeId: prevDefault });
      throw err;
    }
  }, []);

  const setHomeFollowMode = useCallback(async (follow: boolean) => {
    const prev = stateRef.current.user?.home_location_follow_mode ?? false;
    dispatch({ type: "set_user_follow_mode", follow });
    try {
      await putHomeFollowMode(follow);
    } catch (err) {
      dispatch({ type: "set_user_follow_mode", follow: prev });
      throw err;
    }
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
      sentinel_set_default_focus: setDefaultFocus,
      sentinel_set_home_follow_mode: setHomeFollowMode,
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
  }, [state, switchTenant, switchWorkspace, setFocus, setDefaultFocus, setHomeFollowMode, setScopeDirection, setSettings, reload]);

  return <SentinelCtx.Provider value={value}>{children}</SentinelCtx.Provider>;
}
