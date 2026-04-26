import PageShell from "@/app/components/PageShell";

// Phase 1 dashboard layout (Vector kit). Real data wiring lands in
// later cards; for now the page demonstrates the metric-tile grid
// + .t-metric scale called out by AC 00086. Tile values are
// placeholders — they live in this file so a single backend swap
// can replace them when telemetry lands.
const TILES: Array<{ label: string; value: string; hint?: string }> = [
  { label: "Active items", value: "0", hint: "Across all portfolios" },
  { label: "In progress", value: "0", hint: "You + your reports" },
  { label: "Blocked", value: "0", hint: "Awaiting decision" },
  { label: "Due this week", value: "0", hint: "Across all teams" },
];

export default function Dashboard() {
  return (
    <PageShell title="Dashboard" subtitle="Your workspace overview">
      <h3 className="eyebrow">Overview</h3>
      <div className="dashboard-grid">
        {TILES.map((t) => (
          <div key={t.label} className="card tile">
            <div className="tile__label">{t.label}</div>
            <div className="t-metric">{t.value}</div>
            {t.hint && <div className="tile__hint">{t.hint}</div>}
          </div>
        ))}
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        Throughput (last 12 weeks)
      </h3>
      <div className="card chart-card">
        {/* Inline mini-chart: two series (primary --ink, comparison
            --ink-muted), dashed --border gridlines, --ink-subtle
            axis labels. Brand colour never used. */}
        <svg viewBox="0 0 600 200" className="chart-card__svg" role="img" aria-label="Throughput line chart">
          <g className="chart-grid">
            <line x1="40" y1="40"  x2="580" y2="40"  />
            <line x1="40" y1="100" x2="580" y2="100" />
            <line x1="40" y1="160" x2="580" y2="160" />
          </g>
          <text x="32" y="44"  className="chart-axis" textAnchor="end">100</text>
          <text x="32" y="104" className="chart-axis" textAnchor="end">50</text>
          <text x="32" y="164" className="chart-axis" textAnchor="end">0</text>
          <polyline className="chart-series chart-series--cmp" points="40,150 90,140 140,135 190,120 240,125 290,110 340,118 390,100 440,95 490,90 540,82 580,75" />
          <polyline className="chart-series chart-series--pri" points="40,160 90,148 140,140 190,118 240,110 290,90 340,95 390,72 440,68 490,55 540,48 580,38" />
        </svg>
        <div className="chart-card__legend">
          <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--pri" /> This quarter</span>
          <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--cmp" /> Last quarter</span>
        </div>
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        Recent activity
      </h3>
      <div className="table-wrap">
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              <th className="table__cell">When</th>
              <th className="table__cell">Item</th>
              <th className="table__cell">Action</th>
              <th className="table__cell">By</th>
            </tr>
          </thead>
          <tbody>
            <tr className="table__row">
              <td className="table__cell">—</td>
              <td className="table__cell">No activity yet</td>
              <td className="table__cell">—</td>
              <td className="table__cell">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
