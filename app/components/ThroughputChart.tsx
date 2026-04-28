"use client";

import { useState, useEffect } from "react";

// Vector throughput chart — two-series line chart over 12 weeks.
// Primary series in --ink, comparison series in --ink-muted. Dashed
// gridlines at the 0/50/100 marks; --ink-subtle axis labels. Brand
// colour never used.
//
// Usage:
//   <ThroughputChart />
//   <ThroughputChart series={{ primary: [...12], comparison: [...12] }} />
//   <ThroughputChart randomize />                              // PREVIEW ONLY

export type ThroughputSeries = {
  primary: number[];     // 12 values, range 0–200
  comparison: number[];  // 12 values, range 0–200
};

const DEFAULT_SERIES: ThroughputSeries = {
  primary:    [10, 25, 35, 60, 75, 100, 95, 130, 135, 165, 180, 205],
  comparison: [25, 40, 50, 80, 75, 95, 87, 110, 115, 125, 145, 160],
};

const VB_W = 600;
const VB_H = 200;
const X0 = 40;
const X1 = 580;
const Y_TOP = 40;     // y = 200 maps here
const Y_BOT = 160;    // y = 0   maps here
const Y_MID = 100;    // y = 100 maps here
const N = 12;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// both series, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Two independent series — no sum constraint between them.
//   • Clamp each value to [5, 195] integer bounds (within the
//     0–200 chart range) so polylines never escape the gridlines
//     and the lines stay legible at the chart edges.
// =============================================================
function randomSeries(): ThroughputSeries {
  const gen = () =>
    Array.from({ length: N }, () => 5 + Math.floor(Math.random() * 191));
  return { primary: gen(), comparison: gen() };
}

function pointsFor(values: number[]): string {
  const step = (X1 - X0) / (N - 1);
  return values
    .map((v, i) => {
      const t = Math.max(0, Math.min(200, v)) / 200;
      const x = X0 + i * step;
      const y = Y_BOT - t * (Y_BOT - Y_TOP);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function ThroughputChart({
  series: seriesProp = DEFAULT_SERIES,
  randomize = false,
}: {
  series?: ThroughputSeries;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [series, setSeries] = useState<ThroughputSeries>(seriesProp);

  useEffect(() => {
    if (randomize) setSeries(randomSeries());
  }, [randomize]);

  const svg = (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="chart-card__svg" role="img" aria-label="Throughput line chart">
      <g className="chart-grid">
        <line x1={X0} y1={Y_TOP} x2={X1} y2={Y_TOP} />
        <line x1={X0} y1={Y_MID} x2={X1} y2={Y_MID} />
        <line x1={X0} y1={Y_BOT} x2={X1} y2={Y_BOT} />
      </g>
      <text x="32" y="44"  className="chart-axis" textAnchor="end">100</text>
      <text x="32" y="104" className="chart-axis" textAnchor="end">50</text>
      <text x="32" y="164" className="chart-axis" textAnchor="end">0</text>
      <polyline className="chart-series chart-series--cmp" points={pointsFor(series.comparison)} />
      <polyline className="chart-series chart-series--pri" points={pointsFor(series.primary)} />
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="chart-demo-host">
      <button
        type="button"
        className="chart-demo-reroll"
        onClick={() => setSeries(randomSeries())}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
