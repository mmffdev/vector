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

function pillClass(status: ReportCheck["status"]) {
  if (status === "pass")  return "dui-pill dui-pill--pass";
  if (status === "warn")  return "dui-pill dui-pill--warn";
  if (status === "fixed") return "dui-pill dui-pill--fixed";
  return "dui-pill dui-pill--fail";
}

function pillLabel(status: ReportCheck["status"]) {
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
  return <span className={`dui-pill dui-pill--${type}`}>{count}</span>;
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
    <span className="dui-meta">
      <span className="dui-meta__id">{report.scope}</span>
      <span className="dui-meta__title">{SCOPE_LABELS[report.scope] ?? report.scope} scan</span>
      <span className="dui-meta__sub">
        <span>{report.flag}</span>
        <span>{formatTs(report.timestamp)}</span>
      </span>
      <span className="dui-meta__summary">
        <SummaryPill count={report.summary.pass} type="pass" />
        <SummaryPill count={report.summary.warn} type="warn" />
        <SummaryPill count={report.summary.fail} type="fail" />
        <SummaryPill count={report.summary.fixed ?? 0} type="fixed" />
      </span>
    </span>
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

      <table className="dui-table">
        <thead>
          <tr>
            <th className="dui-table__cell--shrink" />
            <th>Check</th>
            <th>Detail</th>
            <th className="dui-table__cell--shrink">Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c, i) => (
            <tr key={i}>
              <td className="dui-table__cell--shrink dui-table__cell--mono">{statusIcon(c.status)}</td>
              <td className="dui-table__cell--name">{c.label}</td>
              <td className="dui-table__cell--muted">{c.detail}</td>
              <td className="dui-table__cell--shrink">
                <span className={pillClass(c.status)}>{pillLabel(c.status)}</span>
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
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Reports</h1>
            <p className="dui-page__subtitle">
              Reports generated by <code>&lt;memory&gt; -A/M/S/C/H</code> in the CLI. Each run creates a timestamped file in <code>dev/reports/</code>.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="dui-pager__btn"
            aria-label="Refresh reports list"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        {error && <div className="dui-empty">{error}</div>}

        {!loading && reports.length === 0 && !error && (
          <div className="dui-empty">
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
