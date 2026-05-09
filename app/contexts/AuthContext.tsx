"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSite, ApiError, setApiToken, setRefreshCallback } from "@/app/lib/api";
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

interface AuthState {
  user: AuthUser | null;
  role: Role | null;
  loading: boolean;
  permissions: Set<string>;
  hasPermission: (code: string) => boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: AuthUser) => void;
}

const Ctx = createContext<AuthState | null>(null);

// Module-level dedup: StrictMode unmounts + remounts the component, which
// would fire two sequential refresh() calls — each using the same one-time-use
// rt cookie. The second call hits reuse-detection and revokes the session.
// A ref inside the component resets to null on unmount, so it can't protect
// across the remount. Module scope survives the full StrictMode cycle.
let _bootstrapFlight: Promise<void> | null = null;

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
      } catch {
        setApiToken(null);
        setUser(null);
        clearSessionCookie();
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
      // Use module-level guard for bootstrap: StrictMode unmounts + remounts
      // this component, which would fire two sequential calls consuming the
      // same one-time-use rt cookie. The ref resets on unmount so it can't
      // protect across the remount — module scope can.
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
      const res = await apiSite<LoginResp>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      });
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
    notify.success("You've been signed out.");
    router.push("/login");
  }, [router, user]);

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
    <Ctx.Provider value={{ user, role, loading, permissions, hasPermission, login, logout, refresh, setUser }}>
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
