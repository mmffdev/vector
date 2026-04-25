"use client";

/**
 * LibraryReleasesContext — shared polling state for the mmff_library
 * release-notification channel (Phase 3, plan §12).
 *
 * Owns the single poll loop against /api/library/releases/count so the
 * badge and any page-level gate both read from one source of truth.
 * Only gadmins get a live count; all other roles see count=0, hasBlocking=false.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { api, ApiError } from "@/app/lib/api";

interface CountResponse {
  count: number;
  has_blocking: boolean;
  fresh: boolean;
}

interface LibraryReleasesState {
  count: number | null;
  hasBlocking: boolean;
}

const LibraryReleasesContext = createContext<LibraryReleasesState>({
  count: null,
  hasBlocking: false,
});

const POLL_MS = 5 * 60 * 1000;

export function LibraryReleasesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<LibraryReleasesState>({ count: null, hasBlocking: false });

  const isGAdmin = user?.role === "gadmin";

  useEffect(() => {
    if (!isGAdmin) return;
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const data = await api<CountResponse>("/api/library/releases/count");
        if (!cancelled) {
          setState({ count: data.count, hasBlocking: data.has_blocking });
        }
      } catch (err) {
        if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) {
          console.warn("library releases count failed:", err);
        }
      }
    };

    void fetchCount();
    const id = window.setInterval(fetchCount, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isGAdmin]);

  return (
    <LibraryReleasesContext.Provider value={state}>
      {children}
    </LibraryReleasesContext.Provider>
  );
}

export function useLibraryReleases(): LibraryReleasesState {
  return useContext(LibraryReleasesContext);
}
