"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSite, ApiError, setApiToken, setRefreshCallback, setHardLogoutCallback } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { purgeDraftsFor } from "@/app/lib/draftStore";

// PLA-0007: role is now a structured row from the `roles` table, not an
// enum. Consumers should branch on permission codes (useHasPermission)
// rather than role.code directly. role.code is exposed for UI labelling
// and for the small handful of legacy call sites still being migrated.
export interface Role {
  id: string;
  code: string;
  label: string;
  rank: number;
  is_system: boolean;
  is_external: boolean;
}

export interface AuthUser {
  id: string;
  subscription_id: string;
  // workspace_id is the user's active workspace within their subscription
  // (PLA-0053 / story 00580). Sourced from the JWT claim via /me.
  // Empty string when the backend's JWT predates PLA-0053 — useActiveWorkspace
  // exposes this as null to keep consumers' loading-state handling clean.
  workspace_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  force_password_change: boolean;
  auth_method: "local" | "ldap";
  last_login?: string | null;
  permissions: string[];
}

interface LoginResp {
  access_token: string;
  user: AuthUser;
}

interface MFAChallengeResp {
  mfa_required: true;
  challenge_token: string;
}

// Thrown by login() when the backend requires a TOTP second factor.
// The login page catches this, stores challenge_token in state, and
// renders the inline TOTP input. Call mfaLogin() to complete the flow.
export class MFAChallengeError extends Error {
  readonly challengeToken: string;
  constructor(token: string) {
    super("mfa_challenge");
    this.name = "MFAChallengeError";
    this.challengeToken = token;
  }
}

interface AuthState {
  user: AuthUser | null;
  role: Role | null;
  loading: boolean;
  permissions: Set<string>;
  hasPermission: (code: string) => boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  // mfaLogin exchanges a challenge_token (from MFAChallengeError) + TOTP
  // code for a full session. Pass rememberDevice=true to set a 30-day
  // device-trust cookie so future logins on this browser skip MFA.
  mfaLogin: (challengeToken: string, code: string, rememberDevice?: boolean) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // PLA-0053 / story 00576.5 — POST /auth/switch-workspace re-mints
  // the JWT with a new workspace_id claim + rotates the refresh
  // session, then updates user state in-place. Callers that depend
  // on the active workspace (chip filters, catalogue providers,
  // localStorage keys via useActiveWorkspace) re-render automatically.
  // Throws on 403 (no live grant for that workspace).
  switchWorkspace: (workspaceID: string) => Promise<AuthUser>;
  setUser: (u: AuthUser) => void;
}

const Ctx = createContext<AuthState | null>(null);

// _bootstrapFlight deduplicates concurrent bootstrap calls within the same
// JS runtime lifetime (StrictMode double-mount, HMR re-runs). It is a
// module-level promise so it survives the unmount+remount cycle that a
// component-level ref cannot.
//
// On a real browser refresh, the JS module reloads from scratch: all
// module-level variables reset to null, _bootstrapFlight becomes null,
// and bootstrap runs exactly once per page load — which is correct.
//
// On HMR hot-reload, the module is patched in-place without a full reload,
// so module-level state persists. _bootstrapped (below) guards against
// re-running bootstrap after it already succeeded in this JS runtime.
//
// On duplicate tab open: each tab gets its own JS module scope, so both
// will attempt bootstrap. The backend grace-window (migration 145) handles
// the race — if both tabs send the same rt cookie within 30 s, the second
// gets the successor token rather than triggering reuse-detection.
let _bootstrapFlight: Promise<void> | null = null;
let _bootstrapped = false;

function setSessionCookie() {
  document.cookie = "session_alive=1; Path=/; SameSite=Strict; Max-Age=604800";
}

function clearSessionCookie() {
  document.cookie = "session_alive=; Path=/; Max-Age=0";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  // Mid-session dedup: collapses concurrent refresh() calls that may occur
  // when multiple components detect a 401 simultaneously. This is a ref
  // (not module-scope) because it should reset between user sessions.
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const applyLogin = useCallback((res: LoginResp) => {
    setApiToken(res.access_token);
    setUser(res.user);
    setSessionCookie();
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const flight = (async () => {
      try {
        const res = await apiSite<LoginResp>("/auth/refresh", { method: "POST", skipAuth: true });
        applyLogin(res);
        _bootstrapped = true;
      } catch {
        setApiToken(null);
        setUser(null);
        clearSessionCookie();
        _bootstrapped = false;
      }
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = flight;
    return flight;
  }, [applyLogin]);

  useEffect(() => {
    setRefreshCallback(refresh);
    const hasSessionHint =
      typeof document !== "undefined" &&
      document.cookie.split("; ").some((c) => c.startsWith("session_alive="));
    if (hasSessionHint) {
      // _bootstrapped: already succeeded this tab lifetime — HMR re-ran
      // the effect but the rt cookie was already rotated by the first call.
      // Firing again hits reuse-detection and nukes all sessions.
      if (_bootstrapped) {
        setLoading(false);
        return;
      }
      // _bootstrapFlight: deduplicates StrictMode's unmount+remount double-fire
      // within the same synchronous render cycle.
      if (!_bootstrapFlight) {
        _bootstrapFlight = refresh().finally(() => {
          _bootstrapFlight = null;
          setLoading(false);
        });
      } else {
        _bootstrapFlight.finally(() => setLoading(false));
      }
    } else {
      setLoading(false);
    }
    return () => setRefreshCallback(null);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiSite<LoginResp | MFAChallengeResp>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      });
      if ("mfa_required" in res && res.mfa_required) {
        throw new MFAChallengeError(res.challenge_token);
      }
      applyLogin(res as LoginResp);
      return (res as LoginResp).user;
    },
    [applyLogin]
  );

  const mfaLogin = useCallback(
    async (challengeToken: string, code: string, rememberDevice = false) => {
      const res = await apiSite<LoginResp>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_token: challengeToken, code, remember_device: rememberDevice }),
        skipAuth: true,
      });
      applyLogin(res);
      return res.user;
    },
    [applyLogin]
  );

  // PLA-0053 / story 00576.5 — switch active workspace.
  const switchWorkspace = useCallback(
    async (workspaceID: string) => {
      const res = await apiSite<LoginResp>("/auth/switch-workspace", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceID }),
      });
      // Reuse applyLogin so the access token + user payload land
      // exactly as they do after login/refresh.
      applyLogin(res);
      return res.user;
    },
    [applyLogin]
  );

  const logout = useCallback(async () => {
    const departingId = user?.id ?? null;
    try {
      await apiSite("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    if (departingId) {
      // Purge drafts owned by the signing-out user so they're never
      // visible if a different user signs in on the same browser.
      try { await purgeDraftsFor(departingId); } catch { /* IDB unavailable; ignore */ }
    }
    setApiToken(null);
    setUser(null);
    clearSessionCookie();
    _bootstrapped = false;
    notify.success("You've been signed out.");
    router.push("/login");
  }, [router, user]);

  // hardLogout is invoked by api.ts when the backend returns a 401
  // carrying Problem.code = "session_revoked" or "session_idle_expired"
  // (B16.8.11 step 3). Silent refresh would loop forever on those
  // codes because the issuing session row is dead. Mirrors logout()
  // for the local-state cleanup, then sets a sessionStorage flag that
  // the /login page reads (B16.8.11 step 4e) to render the matching
  // banner instead of dropping the user onto a blank login form with
  // no explanation.
  //
  // Differences vs logout():
  //   - No success toast (this is involuntary, not a user action).
  //   - sessionStorage flag carries the reason code for the banner.
  //   - window.location.assign instead of router.push — guarantees a
  //     fresh page mount so any stale React state (caches, contexts
  //     holding pre-logout data) is wiped, not just AuthContext's.
  const hardLogout = useCallback(async (reason: string) => {
    const departingId = user?.id ?? null;
    try {
      await apiSite("/auth/logout", { method: "POST" });
    } catch {
      // ignore — backend may already have nuked the session
    }
    if (departingId) {
      try { await purgeDraftsFor(departingId); } catch { /* IDB unavailable; ignore */ }
    }
    setApiToken(null);
    setUser(null);
    clearSessionCookie();
    _bootstrapped = false;
    try {
      sessionStorage.setItem("vector.login.reason", reason);
    } catch { /* private mode; banner won't render but redirect still happens */ }
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }, [user]);

  // Register/unregister hardLogout with api.ts. Separate effect from the
  // bootstrap one so it doesn't drag hardLogout (defined further down)
  // into the bootstrap effect's deps before it's been declared.
  useEffect(() => {
    setHardLogoutCallback(hardLogout);
    return () => setHardLogoutCallback(null);
  }, [hardLogout]);

  const permissions = useMemo(
    () => new Set(user?.permissions ?? []),
    [user]
  );
  const hasPermission = useCallback(
    (code: string) => permissions.has(code),
    [permissions]
  );
  const role = user?.role ?? null;

  return (
    <Ctx.Provider value={{ user, role, loading, permissions, hasPermission, login, mfaLogin, logout, refresh, switchWorkspace, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

// useHasPermission is the canonical way to gate UI on capability. Pass
// the permission code (e.g. "roles.list", "users.create.gadmin") and the
// hook returns true iff the current user's role grants that code.
export function useHasPermission(code: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(code);
}

export { ApiError };
