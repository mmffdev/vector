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
    </PageShell>
  );
}
