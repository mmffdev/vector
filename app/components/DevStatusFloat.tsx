"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@dev/styles/dev.css";

type ServiceStatus = "up" | "down" | "degraded";

type ServiceResult = {
  id: string;
  label: string;
  status: ServiceStatus;
  latencyMs?: number;
  detail?: string;
};

type CheckResult = {
  services: ServiceResult[];
  checkedAt: string;
};

// Dead-code eliminated in production build — returns null if not dev.
export default function DevStatusFloat() {
  if (process.env.NODE_ENV !== "development") return null;
  return <FloatPanel />;
}

function FloatPanel() {
  const [open, setOpen]       = useState(false);
  const [result, setResult]   = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const rootRef               = useRef<HTMLDivElement>(null);
  const timerRef              = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/services", { cache: "no-store" });
      if (res.ok) setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 30_000);
    return () => clearInterval(timerRef.current);
  }, [check]);

  useEffect(() => {
    if (!open) return;
    const onKey   = (e: KeyboardEvent)  => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent)     => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const services   = result?.services ?? [];
  const downCount  = services.filter((s) => s.status === "down").length;
  const dotStatus  =
    loading && !result   ? "checking"
    : downCount > 0      ? "down"
    : services.length > 0 ? "up"
    : "checking";

  const STATUS_LABEL: Record<ServiceStatus | "checking", string> = {
    up: "Up", down: "Down", degraded: "Degraded", checking: "…",
  };

  return (
    <div className="devf" ref={rootRef}>
      {open && (
        <div className="devf__panel" role="dialog" aria-label="Service health">
          <div className="devf__header">
            <span className="dev-eyebrow">Service health</span>
            {loading && result && <span className="dev-services-spinner" aria-hidden />}
            {result?.checkedAt && (
              <span className="devf__ts">
                {new Date(result.checkedAt).toLocaleTimeString([], {
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })}
              </span>
            )}
            <button className="dev-btn dev-btn--sm" onClick={check} disabled={loading}>
              Refresh
            </button>
          </div>

          <table className="dev-services-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0
                ? (
                  <tr>
                    <td colSpan={4} className="devf__empty">Checking services…</td>
                  </tr>
                )
                : services.map((svc) => (
                  <tr key={svc.id}>
                    <td className="dev-services-name">{svc.label}</td>
                    <td>
                      <span className={`dev-services-pill dev-services-pill--${svc.status}`}>
                        <span className="dev-services-dot" />
                        {STATUS_LABEL[svc.status]}
                      </span>
                    </td>
                    <td className="dev-services-latency">
                      {svc.latencyMs !== undefined ? `${svc.latencyMs} ms` : "—"}
                    </td>
                    <td className="dev-services-detail">{svc.detail ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        className={`devf__trigger devf__trigger--${dotStatus}`}
        onClick={() => setOpen((o) => !o)}
        title="Dev service health"
        aria-label="Toggle service health panel"
        aria-expanded={open}
      >
        <ServerIcon />
        <span className={`devf__dot devf__dot--${dotStatus}`} aria-hidden />
      </button>
    </div>
  );
}

function ServerIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <circle cx="18" cy="7"  r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
