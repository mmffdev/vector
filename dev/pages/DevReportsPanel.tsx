"use client";

import { useEffect, useState } from "react";
import type { MemoryReport, ReportCheck } from "@/app/api/dev/memory-reports/route";
import { DevAccordion, DevAccordionItem, DevAccordionToolbar } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

const SCOPE_LABELS: Record<string, string> = {
  A: "All",
  M: "Memory",
  S: "Skills",
  C: "Commands",
  H: "Hooks",
};

const PAGE_SIZE = 25;

type StatusFilter = "all" | "pass" | "warn" | "fail" | "fixed";

const FILTER_DEFS: { key: StatusFilter; label: string }[] = [
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
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const hasFail = report.summary.fail > 0;

  const filtered = filter === "all"
    ? report.checks
    : report.checks.filter(c => c.status === filter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function countFor(f: StatusFilter) {
    if (f === "all") return report.checks.length;
    return report.checks.filter(c => c.status === f).length;
  }

  const filters = FILTER_DEFS.map(f => ({ key: f.key, label: f.label, count: countFor(f.key) }));

  const header = (
    <>
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
    </>
  );

  return (
    <DevAccordionItem header={header} accent={hasFail ? "fail" : null}>
      <DevAccordionToolbar
        filters={filters}
        activeFilter={filter}
        onFilterChange={f => { setFilter(f); setPage(1); }}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />

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
    </DevAccordionItem>
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
    <Panel name="dev_reports" title="Reports">
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
        <DevAccordion>
          {reports.map(r => <ReportItem key={r.id} report={r} />)}
        </DevAccordion>
      )}
    </div>
    </Panel>
  );
}
