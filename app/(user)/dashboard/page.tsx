import PageShell from "@/app/components/PageShell";
import PetalChart from "@/app/components/PetalChart";
import FilledPetalChart from "@/app/components/FilledPetalChart";
import FillPetalEqualChart from "@/app/components/FillPetalEqualChart";
import FillPetalEqualChartRounded from "@/app/components/FillPetalEqualChartRounded";
import RaydaleChart from "@/app/components/RaydaleChart";
import ConcentricArcChart from "@/app/components/ConcentricArcChart";
import ConcentricArcChartNonClosed from "@/app/components/ConcentricArcChartNonClosed";
import DonutChart from "@/app/components/DonutChart";
import ThroughputChart from "@/app/components/ThroughputChart";
import LadderChart from "@/app/components/LadderChart";
import SankeyFlowChart from "@/app/components/SankeyFlowChart";
import JourneyDomeChart from "@/app/components/JourneyDomeChart";
import PortfolioGraphChart from "@/app/components/PortfolioGraphChart";
import HorizontalStackChart from "@/app/components/HorizontalStackChart";
import PercentileDotChart from "@/app/components/PercentileDotChart";
import DivergingHeatmapChart from "@/app/components/DivergingHeatmapChart";
import AdjacencyMatrixChart from "@/app/components/AdjacencyMatrixChart";
import BarGrid3DChart from "@/app/components/BarGrid3DChart";

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
        Portfolio dimensions
      </h3>
      <div className="dashboard-charts-row">
        <div className="card chart-card chart-card--petal">
          <PetalChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample weighting — petal length reflects relative value across eight dimensions.</span>
          </div>
        </div>
        <div className="card chart-card chart-card--petal">
          <FilledPetalChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample health — outer petals identical; inner fill scales with each dimension&rsquo;s score (0–100).</span>
          </div>
        </div>
        <div className="card chart-card chart-card--petal">
          <FillPetalEqualChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample fill — petals occupy equal angular slots and touch at boundaries; inner fill scales with score (0–100).</span>
          </div>
        </div>
        <div className="card chart-card chart-card--petal">
          <FillPetalEqualChartRounded randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample bloom — same equal-slot fill, with every corner filleted for a softer, flower-like silhouette.</span>
          </div>
        </div>
        <div className="card chart-card chart-card--petal">
          <RaydaleChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample raydale — two audiences plotted across 17 activity axes; vertex distance from centre = score (0–100). Click ↻ to re-roll preview data.</span>
          </div>
        </div>
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        Quarterly objectives
      </h3>
      <div className="dashboard-charts-row">
        <div className="card chart-card">
          <ConcentricArcChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample objectives — each ring sweeps clockwise by completion %, outermost first.</span>
          </div>
        </div>
        <div className="card chart-card">
          <ConcentricArcChartNonClosed randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Same data, no track — arcs read as open sweeps against the canvas.</span>
          </div>
        </div>
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        More dimensions
      </h3>
      <div className="dashboard-charts-row">
        <div className="card chart-card">
          <h4 className="eyebrow">Throughput (last 12 weeks)</h4>
          <ThroughputChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--pri" /> This quarter</span>
            <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--cmp" /> Last quarter</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Resource allocation</h4>
          <DonutChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample allocation — each slice scales with value; the highlighted slice gets a leader-line callout.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Stage journey</h4>
          <JourneyDomeChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample stage dome — concentric rings represent ordered stages of a journey; icon callouts mark the focal moment of each stage. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Outcome distribution</h4>
          <LadderChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample probability ladder — each row is an entity&rsquo;s distribution across ranked outcomes; cell intensity scales with probability, the highlighted cell marks a focal cell. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Origin → destination flow</h4>
          <SankeyFlowChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample sankey — sources line the top, destinations the bottom; bezier curves carry mass between them and the highlighted destination picks up the brand accent. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Portfolio hierarchy</h4>
          <PortfolioGraphChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample portfolio graph — pick a root level from the dropdown, click a node to expand or collapse its children, drag any node to reorganise. Spring physics pull child nodes along when you move a parent. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Regional sales mix</h4>
          <HorizontalStackChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample regional split — each row sums to 100% across four series. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Distribution across entities</h4>
          <PercentileDotChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample percentile dot plot — three dots per row (low, mid, high) joined by a connector line; rows sort top-down by spread so the most uneven entities float to the top. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Performance over time</h4>
          <DivergingHeatmapChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample diverging heatmap — each row is an entity tracked across time-step columns; cells encode signed magnitude on a warm/cool scale, missing observations render empty. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card">
          <h4 className="eyebrow">Spatial adjacency</h4>
          <AdjacencyMatrixChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample adjacency matrix — symmetric across the diagonal; dot size and ink weight encode priority (MUST / SHOULD / MAYBE), brand accent marks the focal pairing. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        Source × day breakdown (3D)
      </h3>
      <div className="dashboard-charts-row">
        <div className="card chart-card chart-card--half">
          <h4 className="eyebrow">Mono — theme tones</h4>
          <BarGrid3DChart randomize />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample 3D grid (mono) — drag horizontally to rotate; bar height = cell value, row tone cycles the four-tone ladder. Click ↻ to re-roll preview data.</span>
          </div>
        </div>
        <div className="card chart-card chart-card--half">
          <h4 className="eyebrow">Rainbow — heatmap mode</h4>
          <BarGrid3DChart randomize colorMode="rainbow" />
          <div className="chart-card__legend">
            <span className="chart-legend">Sample 3D grid (rainbow) — same data shape, hue gradient encodes Z so colour conveys magnitude. Opt-in via the colorMode prop. Click ↻ to re-roll preview data.</span>
          </div>
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
