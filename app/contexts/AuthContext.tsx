"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setApiToken } from "@/app/lib/api";

export type Role = "user" | "padmin" | "gadmin";

export interface AuthUser {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  force_password_change: boolean;
  auth_method: "local" | "ldap";
  last_login?: string | null;
}

interface LoginResp {
  access_token: string;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: AuthUser) => void;
}

const Ctx = createContext<AuthState | null>(null);

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

  const applyLogin = useCallback((res: LoginResp) => {
    setApiToken(res.access_token);
    setUser(res.user);
    setSessionCookie();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<LoginResp>("/api/auth/refresh", { method: "POST", skipAuth: true });
      applyLogin(res);
    } catch {
      setApiToken(null);
      setUser(null);
      clearSessionCookie();
    }
  }, [applyLogin]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<LoginResp>("/api/auth/login", {
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
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setApiToken(null);
    setUser(null);
    clearSessionCookie();
    router.push("/login");
  }, [router]);

  return (
    <Ctx.Provider value={{ user, loading, login, logout, refresh, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export { ApiError };
