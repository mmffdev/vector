"use client";

import { useEffect, useState } from "react";
import Panel from "@/app/components/Panel";

type ApiChangelogData = {
  changelog: string;
  caller_map: Record<string, string[]>;
  dead_apis: string[];
  snapshot_version: string;
  snapshot_date: string;
};

export default function DevApiChangelogPanel() {
  const [data, setData] = useState<ApiChangelogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/api-changelog");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredMap = data
    ? Object.entries(data.caller_map).filter(([p, callers]) =>
        !filter ||
        p.toLowerCase().includes(filter.toLowerCase()) ||
        callers.some((c) => c.toLowerCase().includes(filter.toLowerCase()))
      )
    : [];

  return (
    <div className="dev-doc">
      <Panel name="dev_api_changelog_header">
        <div className="dui-section-header">
          <span className="dui-label">API Changelog</span>
          <span className="dui-meta">
            {data ? `Snapshot ${data.snapshot_version} · ${data.snapshot_date || "—"}` : "Loading…"}
          </span>
          <button className="dui-btn dui-btn--sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </Panel>

      {loading && <p className="dui-empty">Loading…</p>}

      {!loading && data && (
        <>
          <Panel name="dev_api_changelog_blast" title="Blast Radius — Changes vs Previous Snapshot">
            {data.changelog ? (
              <pre className="dui-code">{data.changelog}</pre>
            ) : (
              <p className="dui-empty">No changelog — this is the first snapshot, or <code>npm run api:snap</code> has not been run yet.</p>
            )}
          </Panel>

          <Panel name="dev_api_changelog_callers" title={`Caller Map · ${Object.keys(data.caller_map).length} endpoints mapped`}>
            <input
              className="dui-input"
              placeholder="Filter by endpoint or file…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <table className="dui-table">
              <thead>
                <tr>
                  <th className="dui-th">Endpoint</th>
                  <th className="dui-th">Callers</th>
                </tr>
              </thead>
              <tbody>
                {filteredMap.length === 0 ? (
                  <tr><td className="dui-td" colSpan={2}>No matches</td></tr>
                ) : (
                  filteredMap.map(([p, callers]) => (
                    <tr key={p}>
                      <td className="dui-td dui-td--mono">{p}</td>
                      <td className="dui-td">
                        {callers.map((c) => (
                          <div key={c} className="dui-meta">{c}</div>
                        ))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Panel>

          <Panel name="dev_api_changelog_dead" title={`Dead APIs · ${data.dead_apis.length} uncalled spec path(s)`}>
            {data.dead_apis.length === 0 ? (
              <p className="dui-empty">No dead APIs detected.</p>
            ) : (
              <ul className="dui-list">
                {data.dead_apis.map((p) => (
                  <li key={p} className="dui-list-item dui-td--mono">{p}</li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
