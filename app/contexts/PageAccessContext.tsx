"use client";

// PageAccessContext — frontend cache of the user's allowed key_enum
// set + the global pages_access_version. PLA-0049 Phase 0.5.4.
//
// Design:
//   • One fetch on mount (after auth resolves) to /me/page-access.
//   • Cache the version + Set<key_enum> in context.
//   • On tab-focus / visibilitychange → fetch version only via the
//     same endpoint (small response, ~1KB). If version changed, the
//     resolver returns the fresh access set in the same response.
//   • Hook usePageAccess(keyEnum) returns
//     { allowed: boolean | null, loading: boolean }.
//     allowed=null while loading (so the page can render a skeleton
//     instead of flashing the denial card during initial load).
//
// This intentionally does NOT live inside AuthContext — its lifecycle
// (refetch on focus, version-driven invalidation) is independent of
// the auth state machine.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiSite } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

interface PageAccessResp {
  version: number;
  pages: string[];
}

interface PageAccessState {
  loading: boolean;
  version: number;
  pages: ReadonlySet<string>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PageAccessState | null>(null);

export function PageAccessProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [pages, setPages] = useState<ReadonlySet<string>>(() => new Set());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const resp = await apiSite<PageAccessResp>("/me/page-access");
      setVersion(resp.version);
      setPages(new Set(resp.pages));
    } catch {
      // On failure leave the cached set intact — better to over-allow
      // briefly than to bounce the user off every page on a transient
      // backend hiccup. The 1s in-process backend cache will retry
      // naturally on the next request.
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Initial fetch once auth has resolved + a real user is present.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      setPages(new Set());
      setVersion(0);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  // Refetch on tab focus to catch mid-session grant changes.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [user, refresh]);

  const value = useMemo<PageAccessState>(
    () => ({ loading, version, pages, refresh }),
    [loading, version, pages, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// usePageAccess: returns whether the caller currently has access to
// the page identified by keyEnum. allowed=null while the initial
// fetch is in flight so callers can render a skeleton.
export function usePageAccess(keyEnum: string): { allowed: boolean | null; loading: boolean } {
  const v = useContext(Ctx);
  if (!v) {
    // PageAccessProvider not mounted — fail open so missing wiring
    // doesn't lock people out of every page. The server-side
    // RequirePageAccess middleware is the actual enforcement layer.
    return { allowed: true, loading: false };
  }
  if (v.loading) return { allowed: null, loading: true };
  return { allowed: v.pages.has(keyEnum), loading: false };
}
