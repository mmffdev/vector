"use client";

import { SERVICE_HEALTH_POLL_MS, useServiceHealth, type ServiceStatus } from "./useServiceHealth";

const STATUS_LABEL: Record<ServiceStatus | "checking", string> = {
  up: "Up", down: "Down", degraded: "Degraded", checking: "…",
};

export default function ServiceHealthPanel() {
  const { result, loading, tick, refresh } = useServiceHealth();
  const services = result?.services ?? [];

  const progressStyle = {
    "--devf-poll-ms": `${SERVICE_HEALTH_POLL_MS}ms`,
  } as React.CSSProperties;

  return (
    <div className="svch" data-id="service-health">
      <div className="devf__header">
        <span className="dev-eyebrow">Service health</span>
        {result?.activeEnv && (
          <span className={`devf__env devf__env--${result.activeEnv}`}>
            {result.activeEnv}
          </span>
        )}
        {loading && result && <span className="dev-services-spinner" aria-hidden />}
        {result?.checkedAt && (
          <span className="devf__ts">
            {new Date(result.checkedAt).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
          </span>
        )}
        <button className="dev-btn dev-btn--sm" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="devf__progress" style={progressStyle} aria-hidden>
        <div key={tick} className="devf__progress-bar" />
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
              <tr key={svc.id} className={svc.active ? "devf__row--active" : undefined}>
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
  );
}
