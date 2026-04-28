"use client";

import { useState, useEffect } from "react";

// HorizontalStackChart — 100% horizontal stacked bar chart. Each row
// is one category; each row sums to 100% across N series segments.
// Stub data ships by default; pass `data` / `categories` / `series`
// to wire real values. Colors come from the active theme via design
// tokens, so the chart restyles automatically when the user switches
// theme packs.
//
// Usage: <HorizontalStackChart />                       // stub data
//        <HorizontalStackChart data={[...]} ... />       // real data
//        <HorizontalStackChart randomize />              // PREVIEW ONLY

export type HorizontalStackRow = number[];

const DEFAULT_TITLE = "Regional ratio of cosmetic products sales";
const DEFAULT_CATEGORIES: string[] = [
  "Nail polish",
  "Eyebrow pencil",
  "Rouge",
  "Pomade",
  "Eyeshadows",
  "Eyeliner",
  "Foundation",
  "Lip gloss",
  "Mascara",
];
const DEFAULT_SERIES: string[] = ["Florida", "Texas", "Arizona", "Nevada"];

// Replace `DEFAULT_DATA` with API data when wiring up.
// Each inner array: percentages per series for one category, summing to 100.
const DEFAULT_DATA: HorizontalStackRow[] = [
  [50, 18, 22, 10],
  [48, 20, 18, 14],
  [42, 25, 13, 20],
  [27, 30, 15, 28],
  [40, 35, 15, 10],
  [35, 40, 10, 15],
  [25, 28, 12, 35],
  [52, 28, 12, 8],
  [25, 22, 13, 40],
];

const VB_W = 720;
const VB_H = 460;

const PLOT_X0 = 140;
const PLOT_X1 = 690;
const PLOT_Y0 = 90;
const PLOT_Y1 = 400;
const PLOT_W = PLOT_X1 - PLOT_X0;

const TITLE_Y = 24;
const LEGEND_Y = 50;
const LEGEND_SWATCH_W = 14;
const LEGEND_SWATCH_H = 10;
const LEGEND_GAP = 18;
const LEGEND_TEXT_DX = 6;

const BAR_GAP = 8;
const TICKS = [0, 25, 50, 75, 100];

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every row, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape (Stacked bar / 100% stack):
//   • Each row sums to 100. Generate raw weights in [4, 50],
//     scale by 100/sum, round each, push the rounding remainder
//     to the largest segment so the row totals exactly 100.
//   • Reject any segment < 1% — re-roll that row.
//   • Coerce NaN / Infinity to floor (4).
//   • Row count and series count match the configured arrays.
// If you add a chart type with different constraints, write a
// separate generator — do not reuse this one.
// =============================================================
function randomRow(seriesCount: number): number[] {
  const FLOOR = 4;
  const CEIL = 50;
  while (true) {
    const raw = Array.from({ length: seriesCount }, () => {
      const v = FLOOR + Math.floor(Math.random() * (CEIL - FLOOR + 1));
      return Number.isFinite(v) ? v : FLOOR;
    });
    const sum = raw.reduce((s, v) => s + v, 0);
    const scaled = raw.map((v) => Math.round((v / sum) * 100));
    let total = scaled.reduce((s, v) => s + v, 0);
    const maxIdx = scaled.indexOf(Math.max(...scaled));
    scaled[maxIdx] += 100 - total;
    if (scaled.every((v) => v >= 1)) return scaled;
  }
}

function randomData(rows: number, seriesCount: number): HorizontalStackRow[] {
  return Array.from({ length: rows }, () => randomRow(seriesCount));
}

export default function HorizontalStackChart({
  title = DEFAULT_TITLE,
  categories = DEFAULT_CATEGORIES,
  series = DEFAULT_SERIES,
  data = DEFAULT_DATA,
  randomize = false,
}: {
  title?: string;
  categories?: string[];
  series?: string[];
  data?: HorizontalStackRow[];
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [rows, setRows] = useState<HorizontalStackRow[]>(data);
  useEffect(() => {
    if (randomize) setRows(randomData(categories.length, series.length));
  }, [randomize, categories.length, series.length]);

  if (categories.length === 0 || series.length === 0) return null;

  const rowCount = categories.length;
  const seriesCount = series.length;
  const plotH = PLOT_Y1 - PLOT_Y0;
  const rowH = plotH / rowCount;
  const barH = Math.max(8, rowH - BAR_GAP);

  // Pre-measure legend so we can centre it
  const legendApproxWidths = series.map(
    (s) => LEGEND_SWATCH_W + LEGEND_TEXT_DX + s.length * 6.5
  );
  const legendTotalW =
    legendApproxWidths.reduce((s, w) => s + w, 0) + LEGEND_GAP * (seriesCount - 1);
  let legendCursor = (VB_W - legendTotalW) / 2;

  const svg = (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="horizontal-stack-chart"
      role="img"
      aria-label={title}
    >
      <text
        x={VB_W / 2}
        y={TITLE_Y}
        textAnchor="middle"
        className="horizontal-stack-chart__title"
      >
        {title}
      </text>

      {series.map((s, i) => {
        const tone = ((i % 4) + 1) as 1 | 2 | 3 | 4;
        const x = legendCursor;
        legendCursor += legendApproxWidths[i] + LEGEND_GAP;
        return (
          <g key={`legend-${i}`} transform={`translate(${x} ${LEGEND_Y - LEGEND_SWATCH_H + 2})`}>
            <rect
              width={LEGEND_SWATCH_W}
              height={LEGEND_SWATCH_H}
              className={`horizontal-stack-chart__swatch horizontal-stack-chart__swatch--tone-${tone}`}
            />
            <text
              x={LEGEND_SWATCH_W + LEGEND_TEXT_DX}
              y={LEGEND_SWATCH_H - 1}
              className="horizontal-stack-chart__legend-label"
            >
              {s}
            </text>
          </g>
        );
      })}

      {TICKS.map((t) => {
        const x = PLOT_X0 + (t / 100) * PLOT_W;
        return (
          <line
            key={`grid-${t}`}
            x1={x}
            y1={PLOT_Y0}
            x2={x}
            y2={PLOT_Y1}
            className="horizontal-stack-chart__grid"
          />
        );
      })}

      {rows.map((row, ri) => {
        const cy = PLOT_Y0 + ri * rowH + rowH / 2;
        const by = cy - barH / 2;
        let acc = 0;
        return (
          <g key={`row-${ri}`}>
            <text
              x={PLOT_X0 - 12}
              y={cy + 4}
              textAnchor="end"
              className="horizontal-stack-chart__category"
            >
              {categories[ri] ?? ""}
            </text>
            {row.map((pct, si) => {
              const tone = ((si % 4) + 1) as 1 | 2 | 3 | 4;
              const x = PLOT_X0 + (acc / 100) * PLOT_W;
              const w = (pct / 100) * PLOT_W;
              acc += pct;
              return (
                <rect
                  key={`seg-${ri}-${si}`}
                  x={x}
                  y={by}
                  width={w}
                  height={barH}
                  className={`horizontal-stack-chart__segment horizontal-stack-chart__segment--tone-${tone}`}
                />
              );
            })}
          </g>
        );
      })}

      <line
        x1={PLOT_X0}
        y1={PLOT_Y1}
        x2={PLOT_X1}
        y2={PLOT_Y1}
        className="horizontal-stack-chart__axis"
      />

      {TICKS.map((t) => {
        const x = PLOT_X0 + (t / 100) * PLOT_W;
        return (
          <text
            key={`tick-${t}`}
            x={x}
            y={PLOT_Y1 + 18}
            textAnchor="middle"
            className="horizontal-stack-chart__tick"
          >
            {t}%
          </text>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="chart-demo-host">
      <button
        type="button"
        className="chart-demo-reroll"
        onClick={() => setRows(randomData(rowCount, seriesCount))}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
