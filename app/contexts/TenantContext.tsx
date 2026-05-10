"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { tenantSettingsApi, type TenantSettings } from "@/app/lib/tenantSettingsApi";

const LS_KEY = "mmff.tenant.v1";

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsRead(): TenantSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as TenantSettings) : null;
  } catch {
    return null;
  }
}

function lsWrite(s: TenantSettings) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota / private */ }
}

// ── Module-level in-flight dedup ──────────────────────────────────────────────

let _flight: Promise<TenantSettings> | null = null;
let _cache: TenantSettings | null = null;

function fetchFresh(): Promise<TenantSettings> {
  if (!_flight) {
    _flight = tenantSettingsApi.get().then((s) => {
      _cache = s;
      _flight = null;
      lsWrite(s);
      return s;
    }).catch((err) => {
      _flight = null;
      throw err;
    });
  }
  return _flight;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface TenantState {
  settings: TenantSettings | null;
  tenantName: string;
  loading: boolean;
  setSettings: (s: TenantSettings) => void;
}

const Ctx = createContext<TenantState | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const warm = useRef(lsRead());
  const [settings, setSettingsState] = useState<TenantSettings | null>(
    _cache ?? warm.current
  );
  const [loading, setLoading] = useState(!_cache && !warm.current);
  const mounted = useRef(true);

  const applyFresh = useCallback((s: TenantSettings) => {
    _cache = s;
    lsWrite(s);
    if (mounted.current) setSettingsState(s);
  }, []);

  // Always fetch on mount. If we had a localStorage warm-start this runs
  // in the background and reconciles silently — catches DB edits made in
  // another session or directly via psql without needing a focus event.
  useEffect(() => {
    mounted.current = true;
    fetchFresh()
      .then((s) => { if (mounted.current) { applyFresh(s); setLoading(false); } })
      .catch(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Revalidate on window focus — catches changes made while the tab was
  // in the background (another browser session, admin tools, direct SQL).
  useEffect(() => {
    function onFocus() {
      tenantSettingsApi.get()
        .then((s) => {
          if (!mounted.current) return;
          const stale = !_cache
            || _cache.tenant_name !== s.tenant_name
            || _cache.tenant_updated_at !== s.tenant_updated_at;
          if (stale) applyFresh(s);
        })
        .catch(() => { /* silent — stale value is fine on focus failure */ });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [applyFresh]);

  function setSettings(s: TenantSettings) {
    applyFresh(s);
  }

  return (
    <Ctx.Provider value={{
      settings,
      tenantName: settings?.tenant_name ?? "",
      loading,
      setSettings,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTenant(): TenantState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}

export function useTenantName(): string {
  return useTenant().tenantName;
}
