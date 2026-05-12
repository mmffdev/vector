"use client";

import PageContent from "@/app/components/PageContent";
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import ChartWidget from "@/app/components/ChartWidget";
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

const TILES: Array<{ label: string; value: string; hint?: string }> = [
  { label: "Active items", value: "0", hint: "Across all portfolios" },
  { label: "In progress", value: "0", hint: "You + your reports" },
  { label: "Blocked", value: "0", hint: "Awaiting decision" },
  { label: "Due this week", value: "0", hint: "Across all teams" },
];

export default function Dashboard() {
  return (
    <PageContent>
    <PageShell title="Dashboard" subtitle="Your workspace overview">
      <StrictRoute>
        <Panel name="overview" title="Overview">
          <div className="dashboard-grid">
            {TILES.map((t) => (
              <div key={t.label} className="card tile">
                <div className="tile__label">{t.label}</div>
                <div className="t-metric">{t.value}</div>
                {t.hint && <div className="tile__hint">{t.hint}</div>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel name="portfolio_dimensions" title="Portfolio dimensions">
          <div className="dashboard-charts-row">
            <ChartWidget
              petal
              chartRef="C-01"
              legend={<span className="chart-legend">Sample weighting — petal length reflects relative value across eight dimensions.</span>}
            >
              <PetalChart randomize />
            </ChartWidget>

            <ChartWidget
              petal
              chartRef="C-04"
              legend={<span className="chart-legend">Sample health — outer petals identical; inner fill scales with each dimension&rsquo;s score (0–100).</span>}
            >
              <FilledPetalChart randomize />
            </ChartWidget>

            <ChartWidget
              petal
              chartRef="C-02"
              legend={<span className="chart-legend">Sample fill — petals occupy equal angular slots and touch at boundaries; inner fill scales with score (0–100).</span>}
            >
              <FillPetalEqualChart randomize />
            </ChartWidget>

            <ChartWidget
              petal
              chartRef="C-03"
              legend={<span className="chart-legend">Sample bloom — same equal-slot fill, with every corner filleted for a softer, flower-like silhouette.</span>}
            >
              <FillPetalEqualChartRounded randomize />
            </ChartWidget>

            <ChartWidget
              petal
              chartRef="C-08"
              legend={<span className="chart-legend">Sample raydale — two audiences plotted across 17 activity axes; vertex distance from centre = score (0–100). Click ↻ to re-roll preview data.</span>}
            >
              <RaydaleChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-05"
              legend={<span className="chart-legend">Sample objectives — each ring sweeps clockwise by completion %, outermost first.</span>}
            >
              <ConcentricArcChart randomize />
            </ChartWidget>
          </div>
        </Panel>

        <Panel name="objectives_and_flow" title="Objectives & flow">
          <div className="dashboard-charts-row">
            <ChartWidget
              chartRef="C-06"
              legend={<span className="chart-legend">Same data, no track — arcs read as open sweeps against the canvas.</span>}
            >
              <ConcentricArcChartNonClosed randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-10"
              title="Throughput (last 12 weeks)"
              legend={
                <>
                  <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--pri" /> This quarter</span>
                  <span className="chart-legend"><span className="chart-legend__swatch chart-legend__swatch--cmp" /> Last quarter</span>
                </>
              }
            >
              <ThroughputChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-07"
              title="Resource allocation"
              legend={<span className="chart-legend">Sample allocation — each slice scales with value; the highlighted slice gets a leader-line callout.</span>}
            >
              <DonutChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-09"
              title="Stage journey"
              legend={<span className="chart-legend">Sample stage dome — concentric rings represent ordered stages of a journey; icon callouts mark the focal moment of each stage. Click ↻ to re-roll preview data.</span>}
            >
              <JourneyDomeChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-12"
              title="Outcome distribution"
              legend={<span className="chart-legend">Sample probability ladder — each row is an entity&rsquo;s distribution across ranked outcomes; cell intensity scales with probability, the highlighted cell marks a focal cell. Click ↻ to re-roll preview data.</span>}
            >
              <LadderChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-16"
              title="Origin → destination flow"
              legend={<span className="chart-legend">Sample sankey — sources line the top, destinations the bottom; bezier curves carry mass between them and the highlighted destination picks up the brand accent. Click ↻ to re-roll preview data.</span>}
            >
              <SankeyFlowChart randomize />
            </ChartWidget>
          </div>
        </Panel>

        <Panel name="advanced_analysis" title="Advanced analysis">
          <div className="dashboard-charts-row">
            <ChartWidget
              chartRef="C-18"
              title="Portfolio hierarchy"
              legend={<span className="chart-legend">Sample portfolio graph — pick a root level from the dropdown, click a node to expand or collapse its children, drag any node to reorganise. Spring physics pull child nodes along when you move a parent. Click ↻ to re-roll preview data.</span>}
            >
              <PortfolioGraphChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-11"
              title="Regional sales mix"
              legend={<span className="chart-legend">Sample regional split — each row sums to 100% across four series. Click ↻ to re-roll preview data.</span>}
            >
              <HorizontalStackChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-15"
              title="Distribution across entities"
              legend={<span className="chart-legend">Sample percentile dot plot — three dots per row (low, mid, high) joined by a connector line; rows sort top-down by spread so the most uneven entities float to the top. Click ↻ to re-roll preview data.</span>}
            >
              <PercentileDotChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-13"
              title="Performance over time"
              legend={<span className="chart-legend">Sample diverging heatmap — each row is an entity tracked across time-step columns; cells encode signed magnitude on a warm/cool scale, missing observations render empty. Click ↻ to re-roll preview data.</span>}
            >
              <DivergingHeatmapChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-14"
              title="Spatial adjacency"
              legend={<span className="chart-legend">Sample adjacency matrix — symmetric across the diagonal; dot size and ink weight encode priority (MUST / SHOULD / MAYBE), brand accent marks the focal pairing. Click ↻ to re-roll preview data.</span>}
            >
              <AdjacencyMatrixChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-17"
              title="Source × day (mono)"
              legend={<span className="chart-legend">Sample 3D grid (mono) — drag horizontally to rotate; bar height = cell value, row tone cycles the four-tone ladder. Click ↻ to re-roll preview data.</span>}
            >
              <BarGrid3DChart randomize />
            </ChartWidget>

            <ChartWidget
              chartRef="C-17"
              title="Source × day (rainbow)"
              legend={<span className="chart-legend">Sample 3D grid (rainbow) — same data shape, hue gradient encodes Z so colour conveys magnitude. Opt-in via the colorMode prop. Click ↻ to re-roll preview data.</span>}
            >
              <BarGrid3DChart randomize colorMode="rainbow" />
            </ChartWidget>
          </div>
        </Panel>

        <Panel name="recent_activity" title="Recent activity">
          <Table<{ id: string; when: string; item: string; action: string; by: string }>
            pageId="dashboard"
            slot="recent_activity"
            ariaLabel="Recent activity"
            columns={[
              { key: "when", header: "When" },
              { key: "item", header: "Item" },
              { key: "action", header: "Action" },
              { key: "by", header: "By" },
            ]}
            rows={[]}
            rowKey={(r) => r.id}
            empty="No activity yet."
          />
        </Panel>
      </StrictRoute>
    </PageShell>
    </PageContent>
  );
}
