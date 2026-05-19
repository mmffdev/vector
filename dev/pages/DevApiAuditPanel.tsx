"use client";

import { useEffect, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import { apiSite } from "@/app/lib/api";

type Status = "green" | "yellow" | "red" | "black" | "grey";

type Touchpoint = {
  id: number;
  group: string;
  location_page: string;
  location_file: string;
  fn: string;
  path: string;
  method: string;
  kind: string;
  status: Status;
  gap: string;
  snippet: string;
};

const STATUS_LABEL: Record<Status, string> = {
  green: "Compliant",
  yellow: "Warn",
  red: "Bypass",
  black: "PG-Direct",
  grey: "Unknown",
};

const STATUS_GLYPH: Record<Status, string> = {
  green: "✓",
  yellow: "!",
  red: "✗",
  black: "■",
  grey: "?",
};

// Map our status colour to the dui-* tile/pill variant.
const STATUS_TONE: Record<Status, string> = {
  green: "pass",
  yellow: "warn",
  red: "fail",
  black: "critical",
  grey: "neutral",
};

type ColFilters = {
  id: string;
  group: string;
  status: Status | "all";
  location: string;
  fn: string;
  path: string;
  gap: string;
};

const EMPTY_COL_FILTERS: ColFilters = {
  id: "",
  group: "all",
  status: "all",
  location: "",
  fn: "all",
  path: "",
  gap: "",
};

export default function DevApiAuditPanel() {
  const [rows, setRows] = useState<Touchpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [colFilters, setColFilters] = useState<ColFilters>(EMPTY_COL_FILTERS);
  // Tile-click status filter mirrors colFilters.status — single source of truth.
  const statusFilter = colFilters.status;
  const setStatusFilter = (s: Status | "all") => setColFilters((p) => ({ ...p, status: s }));

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiSite<Touchpoint[]>("/admin/dev/api-audit");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Audit fetch failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { green: 0, yellow: 0, red: 0, black: 0, grey: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.group.split(".")[0]);
    return Array.from(set).sort();
  }, [rows]);

  const fns = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.fn || "—");
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const cf = colFilters;
    return rows.filter((r) => {
      // ── per-column filters (header inputs) ──────────────────────
      if (cf.status !== "all" && r.status !== cf.status) return false;
      if (cf.group !== "all" && !r.group.startsWith(cf.group)) return false;
      if (cf.fn !== "all" && (r.fn || "—") !== cf.fn) return false;
      if (cf.id && !String(r.id).startsWith(cf.id.trim())) return false;
      if (cf.location) {
        const loc = (r.location_page + " " + r.location_file).toLowerCase();
        if (!loc.includes(cf.location.trim().toLowerCase())) return false;
      }
      if (cf.path) {
        const p = (r.method + " " + r.path).toLowerCase();
        if (!p.includes(cf.path.trim().toLowerCase())) return false;
      }
      if (cf.gap && !r.gap.toLowerCase().includes(cf.gap.trim().toLowerCase())) return false;

      // ── global free-text search (above the table) ───────────────
      if (!q) return true;
      return (
        r.group.toLowerCase().includes(q) ||
        r.location_page.toLowerCase().includes(q) ||
        r.location_file.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        r.snippet.toLowerCase().includes(q) ||
        r.gap.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, colFilters]);

  const compliancePct = rows.length
    ? Math.round((counts.green / rows.length) * 100)
    : 0;

  return (
    <div className="dui-doc">
      <Panel name="dev_api_audit_header">
        <div className="dui-toolbar">
          <span className="dui-label">API Audit · siteAPI Compliance</span>
          <span className="dui-meta">
            {loading
              ? "Loading…"
              : `${rows.length} touchpoints · ${compliancePct}% green`}
          </span>
          <button className="dui-btn dui-btn--sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </Panel>

      {err && (
        <Panel name="dev_api_audit_error" title="Audit unavailable">
          <p className="dui-empty">
            {err}
            <br />
            Run <code>bash dev/scripts/audit_api_touchpoints.sh</code> from the repo root to generate the snapshot.
          </p>
        </Panel>
      )}

      {!loading && !err && rows.length > 0 && (
        <>
          <Panel name="dev_api_audit_summary" title="Compliance Summary">
            <div className="dui-tile-grid">
              {(["green", "yellow", "red", "black", "grey"] as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`dui-tile dui-tile--${STATUS_TONE[s]} ${statusFilter === s ? "is-active" : ""}`}
                  onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                  aria-pressed={statusFilter === s}
                  aria-label={`Filter to ${STATUS_LABEL[s]}`}
                >
                  <span className="dui-tile__glyph">{STATUS_GLYPH[s]}</span>
                  <span className="dui-tile__count">{counts[s]}</span>
                  <span className="dui-tile__label">{STATUS_LABEL[s]}</span>
                </button>
              ))}
            </div>
            <p className="dui-meta">
              <strong>Compliant</strong> = uses apiSite / apiRoot (sanctioned). &nbsp;
              <strong>Warn</strong> = samanthaAPI from site, or SSE stream. &nbsp;
              <strong>Bypass</strong> = raw fetch bypassing siteAPI (Next.js shadow route). &nbsp;
              <strong>PG-Direct</strong> = pg-direct from Next.js handler (worst case). &nbsp;
              <strong>Unknown</strong> = unclassified, manual review.
            </p>
          </Panel>

          <Panel name="dev_api_audit_filters" title="Search">
            <div className="dui-toolbar dui-toolbar--stretchy">
              <input
                className="dui-input"
                placeholder="Free-text search across all columns (file, path, snippet, gap)…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Search touchpoints"
              />
              <span className="dui-meta">
                Showing {filtered.length} of {rows.length}
              </span>
              <button
                type="button"
                className="dui-btn dui-btn--sm"
                onClick={() => { setFilter(""); setColFilters(EMPTY_COL_FILTERS); }}
                disabled={!filter && colFilters === EMPTY_COL_FILTERS}
                aria-label="Clear all filters"
              >
                Clear filters
              </button>
            </div>
          </Panel>

          <Panel name="dev_api_audit_table" title="API Management — One row per touchpoint">
            <div className="dui-table-scroll">
            <table className="dui-table dui-table--sticky-head">
              <colgroup>
                <col style={{ width: 56 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 280 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 320 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th className="dui-th">ID</th>
                  <th className="dui-th">Group</th>
                  <th className="dui-th">Status</th>
                  <th className="dui-th">Location</th>
                  <th className="dui-th">Fn</th>
                  <th className="dui-th">Path + Method</th>
                  <th className="dui-th">Gap / Action</th>
                </tr>
                <tr className="dui-table__filters">
                  <th>
                    <input
                      className="dui-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="#"
                      value={colFilters.id}
                      onChange={(e) => setColFilters((p) => ({ ...p, id: e.target.value }))}
                      aria-label="Filter by ID prefix"
                    />
                  </th>
                  <th>
                    <select
                      className="dui-input"
                      value={colFilters.group}
                      onChange={(e) => setColFilters((p) => ({ ...p, group: e.target.value }))}
                      aria-label="Filter by group"
                    >
                      <option value="all">All</option>
                      {groups.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <select
                      className="dui-input"
                      value={colFilters.status}
                      onChange={(e) => setColFilters((p) => ({ ...p, status: e.target.value as Status | "all" }))}
                      aria-label="Filter by status"
                    >
                      <option value="all">All</option>
                      {(["green", "yellow", "red", "black", "grey"] as Status[]).map((s) => (
                        <option key={s} value={s}>{STATUS_GLYPH[s]} {STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <input
                      className="dui-input"
                      type="text"
                      placeholder="page or file…"
                      value={colFilters.location}
                      onChange={(e) => setColFilters((p) => ({ ...p, location: e.target.value }))}
                      aria-label="Filter by location"
                    />
                  </th>
                  <th>
                    <select
                      className="dui-input"
                      value={colFilters.fn}
                      onChange={(e) => setColFilters((p) => ({ ...p, fn: e.target.value }))}
                      aria-label="Filter by fn"
                    >
                      <option value="all">All</option>
                      {fns.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <input
                      className="dui-input"
                      type="text"
                      placeholder="path or method…"
                      value={colFilters.path}
                      onChange={(e) => setColFilters((p) => ({ ...p, path: e.target.value }))}
                      aria-label="Filter by path"
                    />
                  </th>
                  <th>
                    <input
                      className="dui-input"
                      type="text"
                      placeholder="gap text…"
                      value={colFilters.gap}
                      onChange={(e) => setColFilters((p) => ({ ...p, gap: e.target.value }))}
                      aria-label="Filter by gap"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td className="dui-td" colSpan={7}>No matches.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className={`dui-table__row--${STATUS_TONE[r.status]}`}>
                    <td className="dui-td dui-td--mono">{r.id}</td>
                    <td className="dui-td dui-td--mono">{r.group}</td>
                    <td className="dui-td">
                      <span
                        className={`dui-pill dui-pill--${STATUS_TONE[r.status]}`}
                        title={STATUS_LABEL[r.status]}
                      >
                        {STATUS_GLYPH[r.status]} {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="dui-td">
                      <div className="dui-meta">{r.location_page}</div>
                      <div className="dui-meta dui-meta--mono">{r.location_file}</div>
                    </td>
                    <td className="dui-td dui-td--mono">{r.fn}</td>
                    <td className="dui-td">
                      <div className="dui-meta dui-meta--mono">{r.method} {r.path}</div>
                      <details>
                        <summary className="dui-meta">snippet</summary>
                        <pre className="dui-code">{r.snippet}</pre>
                      </details>
                    </td>
                    <td className="dui-td">
                      {r.gap ? (
                        <span className="dui-meta">{r.gap}</span>
                      ) : (
                        <span className="dui-meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
