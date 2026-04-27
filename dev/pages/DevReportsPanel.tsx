"use client";

import { useEffect, useState } from "react";
import type { MemoryReport, ReportCheck } from "@/app/api/dev/memory-reports/route";

const SCOPE_LABELS: Record<string, string> = {
  A: "All",
  M: "Memory",
  S: "Skills",
  C: "Commands",
  H: "Hooks",
};

const PAGE_SIZE = 25;

type StatusFilter = "all" | "pass" | "warn" | "fail" | "fixed";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all",   label: "All"    },
  { key: "pass",  label: "Pass"   },
  { key: "warn",  label: "Medium" },
  { key: "fail",  label: "High"   },
  { key: "fixed", label: "Fixed"  },
];

function statusIcon(status: ReportCheck["status"]) {
  if (status === "pass")  return "✓";
  if (status === "warn")  return "!";
  if (status === "fixed") return "⚙";
  return "✕";
}

function badgeClass(status: ReportCheck["status"]) {
  if (status === "pass")  return "badge badge-pass";
  if (status === "warn")  return "badge badge-medium";
  if (status === "fixed") return "badge badge-fixed";
  return "badge badge-high";
}

function badgeLabel(status: ReportCheck["status"]) {
  if (status === "pass")  return "Pass";
  if (status === "warn")  return "Medium";
  if (status === "fixed") return "Fixed";
  return "High";
}

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function SummaryPill({ count, type }: { count: number; type: "pass" | "warn" | "fail" | "fixed" }) {
  if (!count) return null;
  return <span className={`dev-report-pill dev-report-pill--${type}`}>{count}</span>;
}

function ReportItem({ report }: { report: MemoryReport }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const hasFail = report.summary.fail > 0;

  const filtered = filter === "all"
    ? report.checks
    : report.checks.filter(c => c.status === filter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function applyFilter(f: StatusFilter) {
    setFilter(f);
    setPage(1);
  }

  function countFor(f: StatusFilter) {
    if (f === "all") return report.checks.length;
    return report.checks.filter(c => c.status === f).length;
  }

  return (
    <div className={`accordion__item${hasFail ? " dev-accordion-item--fail" : ""}`}>
      <button
        className="accordion__toggle"
        onClick={() => setOpen(o => !o)}
      >
        <span className="dev-report-scope">{report.scope}</span>
        <span className="dev-report-meta">
          <span className="dev-report-name">{SCOPE_LABELS[report.scope] ?? report.scope} scan</span>
          <span className="dev-report-flag">{report.flag}</span>
          <span className="dev-report-ts">{formatTs(report.timestamp)}</span>
        </span>
        <span className="dev-report-pills">
          <SummaryPill count={report.summary.pass} type="pass" />
          <SummaryPill count={report.summary.warn} type="warn" />
          <SummaryPill count={report.summary.fail} type="fail" />
          <SummaryPill count={report.summary.fixed ?? 0} type="fixed" />
        </span>
        <span className={`accordion__chevron${open ? "" : " accordion__chevron--closed"}`} />
      </button>
      {open && (
        <div className="accordion__body">
          <div className="dev-accordion-toolbar">
            <div className="dev-accordion-toolbar__filters">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`dev-accordion-toolbar__filter${filter === f.key ? " dev-accordion-toolbar__filter--active" : ""}`}
                  onClick={() => applyFilter(f.key)}
                >
                  {f.label}
                  <span className="dev-accordion-toolbar__count">{countFor(f.key)}</span>
                </button>
              ))}
            </div>
            <div className="dev-accordion-toolbar__pagination">
              <button
                className="dev-accordion-toolbar__page-btn"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
              >‹</button>
              <span className="dev-accordion-toolbar__page-info">{page} / {totalPages}</span>
              <button
                className="dev-accordion-toolbar__page-btn"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
              >›</button>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr className="table__head">
                <th className="table__cell dev-report-col--icon" />
                <th className="table__cell dev-report-col--label">Check</th>
                <th className="table__cell dev-report-col--detail">Detail</th>
                <th className="table__cell dev-report-col--badge">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr key={i} className={`table__row dev-report-row dev-report-row--${c.status}`}>
                  <td className="table__cell dev-report-col--icon dev-report-row__icon">{statusIcon(c.status)}</td>
                  <td className="table__cell dev-report-col--label dev-report-row__label">{c.label}</td>
                  <td className="table__cell dev-report-col--detail dev-report-row__detail">{c.detail}</td>
                  <td className="table__cell dev-report-col--badge">
                    <span className={badgeClass(c.status)}>{badgeLabel(c.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DevReportsPanel() {
  const [reports, setReports] = useState<MemoryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/memory-reports");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="dev-reports-panel">
      <div className="dev-reports-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Reports generated by <code>&lt;memory&gt; -A/M/S/C/H</code> in the CLI. Each run creates a timestamped file in <code>dev/reports/</code>.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="dev-btn dev-btn--sm">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="dev-alert dev-alert--error">{error}</div>
      )}

      {!loading && reports.length === 0 && !error && (
        <div className="dev-reports-empty">
          No reports yet. Run <code>&lt;memory&gt; -A</code> in the Claude Code CLI to generate one.
        </div>
      )}

      {reports.length > 0 && (
        <div className="accordion">
          {reports.map(r => <ReportItem key={r.id} report={r} />)}
        </div>
      )}
    </div>
  );
}
