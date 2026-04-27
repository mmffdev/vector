"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ServiceStatus = "up" | "down" | "degraded";

type ServiceResult = {
  id: string;
  label: string;
  group: string;
  status: ServiceStatus;
  latencyMs?: number;
  detail?: string;
};

type CheckResult = {
  services: ServiceResult[];
  checkedAt: string;
};

const INITIAL_ROWS: ServiceResult[] = [
  { id: "backend",  label: "Vector Backend",  group: "Core",  status: "down" },
  { id: "db-tunnel",label: "Database",         group: "Core",  status: "down" },
  { id: "planka",   label: "Planka Board",     group: "Tools", status: "down" },
  { id: "api-docs", label: "API Reference",    group: "Tools", status: "down" },
];

const STATUS_LABEL: Record<ServiceStatus, string> = {
  up:       "Up",
  down:     "Down",
  degraded: "Degraded",
};

export default function DevServicesPanel() {
  const [result, setResult]   = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const timerRef              = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/services", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 30_000);
    return () => clearInterval(timerRef.current);
  }, [check]);

  const rows = result?.services ?? (loading ? INITIAL_ROWS : []);
  const allUp = rows.length > 0 && rows.every((s) => s.status === "up");

  return (
    <section className="dev-section">
      <div className="dev-services-header">
        <span className="dev-eyebrow">Service health</span>
        {loading && result && <span className="dev-services-spinner" aria-hidden />}
        {result?.checkedAt && (
          <span className="dev-services-ts">
            {new Date(result.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        <button className="dev-btn dev-btn--sm" onClick={check} disabled={loading}>
          {loading && !result ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      <div className="dev-services-wrap">
        <table className="dev-services-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Group</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((svc) => {
              const isChecking = loading && !result;
              const statusKey  = isChecking ? ("checking" as const) : svc.status;
              return (
                <tr key={svc.id}>
                  <td className="dev-services-name">{svc.label}</td>
                  <td className="dev-services-group">{svc.group}</td>
                  <td>
                    <span className={`dev-services-pill dev-services-pill--${statusKey}`}>
                      <span className="dev-services-dot" />
                      {isChecking ? "Checking" : STATUS_LABEL[svc.status]}
                    </span>
                  </td>
                  <td className="dev-services-latency">
                    {!isChecking && svc.latencyMs !== undefined ? `${svc.latencyMs} ms` : "—"}
                  </td>
                  <td className="dev-services-detail">
                    {isChecking ? "" : (svc.detail ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && allUp && (
          <div className="dev-services-footer">
            All services reachable
          </div>
        )}
      </div>
    </section>
  );
}
