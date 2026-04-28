"use client";

import { useState, useEffect } from "react";

// LadderChart — probability ladder matrix (per-row stochastic heatmap).
// Each row represents an entity (team, candidate, project) and each
// column represents a possible outcome rank (1st, 2nd, ... Nth). Cell
// intensity scales with the probability that the row's entity finishes
// in the column's rank. Each row is a contiguous "bell" of probability
// mass that sums to 100. One cell may be highlighted as a focal point.
//
// Stub data ships by default; replace `rows` with API data when wiring
// up. Colors come from the active theme via design tokens, so the
// chart restyles automatically when the user switches theme packs.
//
// Usage: <LadderChart />                                  // 20×20 stub
//        <LadderChart rows={[...]} columns={[...]} />     // real data
//        <LadderChart highlight={{ row: 14, col: 17 }} /> // focal cell
//        <LadderChart randomize />                        // PREVIEW ONLY

export type LadderRow = {
  label: string;
  // values[i] = probability (0..max) for column i. Length must equal
  // columns.length; cells with 0 are not rendered. Per-row sum should
  // equal max (the component does not re-normalise — bad data renders
  // visibly so it can be caught).
  values: number[];
};

export type LadderHighlight = {
  /** 0-based row index (0 = top row). */
  row: number;
  /** 0-based column index (0 = leftmost / 1st place). */
  col: number;
};

const DEFAULT_COLUMNS: string[] = [
  "1ST", "2ND", "3RD", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
];

const DEFAULT_LABELS: string[] = [
  "Aurora", "Beacon", "Cinder", "Drift", "Ember",
  "Fathom", "Glint", "Halo", "Iris", "Junction",
  "Kestrel", "Lumen", "Marrow", "Nimbus", "Orbit",
  "Pivot", "Quartz", "Relay", "Stratus", "Tempo",
];

// Build a discrete Gaussian-ish bell of mass 100, centered on `mode`,
// truncated to a contiguous window. Used to seed both the stub data
// and the preview-only random generator below — the bell shape is the
// chart's visual signature, so both paths share this primitive.
function bellRow(label: string, mode: number, sigma: number, colCount: number): LadderRow {
  const safeMode = Math.max(0, Math.min(colCount - 1, Math.round(mode)));
  const safeSigma = Math.max(0.4, sigma);
  const raw = Array.from({ length: colCount }, (_, i) => {
    const dx = (i - safeMode) / safeSigma;
    return Math.exp(-0.5 * dx * dx);
  });
  // Trim tails below 5% of peak so support stays contiguous and tight.
  const peak = Math.max(...raw);
  const trimmed = raw.map((v) => (v < peak * 0.05 ? 0 : v));
  const sum = trimmed.reduce((a, b) => a + b, 0) || 1;
  const scaled = trimmed.map((v) => Math.round((v / sum) * 100));
  const remainder = 100 - scaled.reduce((a, b) => a + b, 0);
  scaled[safeMode] = Math.max(0, scaled[safeMode] + remainder);
  return { label, values: scaled };
}

// Replace `DEFAULT_ROWS` with API data when wiring up.
const DEFAULT_ROWS: LadderRow[] = DEFAULT_LABELS.map((label, i) =>
  // First and last rows are nearly certain; middle rows fan out wider.
  bellRow(label, i, i === 0 || i === DEFAULT_LABELS.length - 1 ? 0.4 : 1.4 + (i % 3) * 0.3, DEFAULT_COLUMNS.length),
);

const DEFAULT_HIGHLIGHT: LadderHighlight = { row: 14, col: 17 }; // Orbit, rank 18

// --- Geometry --------------------------------------------------------
const COL_W = 26;
const ROW_H = 26;
const LABEL_W = 110;
const HEADER_H = 28;
const CELL_INSET = 2; // px gap between cells (visual breathing room)

function clampInt(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(max, Math.round(v)));
}

// Map probability (0..max) → opacity in [0, 1]. 0 returns 0 so the
// cell renders as empty; >=max returns 1 so the cell reads as solid.
function cellTone(value: number, max: number): number {
  if (value < 1) return 0;
  if (value >= max) return 1;
  const t = value / max;
  return 0.08 + 0.92 * t;
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every row, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — "probability ladder"
// (per-row stochastic heatmap with bell support). Not in the
// generic matrix; closest cousin is donut/stacked-percent (sum
// constraint) but with the additional structural constraint that
// each row's mass must occupy a contiguous window of columns:
//   • Per row, pick a mode within ±2 of the row's anchor index
//     (clamped to [0, colCount-1]) so the diagonal ladder shape
//     remains readable across re-rolls.
//   • Generate a Gaussian-ish bell with random sigma in [0.6, 2.4]
//     centered on the mode; trim cells below 5% of peak so support
//     stays contiguous (no gaps inside the bell, no stray pips
//     outside).
//   • Scale to a per-row sum of exactly 100; round to int; push
//     the rounding remainder onto the mode cell so the row total
//     is preserved.
//   • NaN / Infinity → 0; never let a row collapse to all-zero
//     (sigma floor + remainder push together guarantee at least
//     one cell ≥ 1).
//   • Highlight cell is re-picked from the random rows: pick a
//     row at random, then pick a column at random from that row's
//     non-zero support so the highlight always lands on a real
//     value.
// If you build another row-stochastic heatmap with different
// support semantics (e.g. multimodal, uncapped tails), write a
// separate generator — do not reuse this one.
// =============================================================
function randomLadder(
  baseLabels: string[],
  colCount: number,
): { rows: LadderRow[]; highlight: LadderHighlight } {
  const rows = baseLabels.map((label, i) => {
    const jitter = Math.round((Math.random() - 0.5) * 4); // -2..+2
    const mode = clampInt(i + jitter, colCount - 1);
    const sigma = 0.6 + Math.random() * 1.8;
    return bellRow(label, mode, sigma, colCount);
  });
  // Pick a highlight cell that is guaranteed to fall on a non-zero value.
  const hRow = Math.floor(Math.random() * rows.length);
  const candidates = rows[hRow].values
    .map((v, c) => ({ v, c }))
    .filter((x) => x.v > 0);
  const pick = candidates[Math.floor(Math.random() * candidates.length)] || { c: 0 };
  return { rows, highlight: { row: hRow, col: pick.c } };
}

export default function LadderChart({
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  highlight = DEFAULT_HIGHLIGHT,
  max = 100,
  randomize = false,
}: {
  columns?: string[];
  rows?: LadderRow[];
  highlight?: LadderHighlight;
  max?: number;
  /** PREVIEW ONLY — generate random rows on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeRows, setActiveRows] = useState(rows);
  const [activeHighlight, setActiveHighlight] = useState(highlight);

  useEffect(() => {
    if (randomize) {
      const r = randomLadder(DEFAULT_LABELS, columns.length);
      setActiveRows(r.rows);
      setActiveHighlight(r.highlight);
    }
  }, [randomize, columns.length]);

  const colCount = columns.length;
  const rowCount = activeRows.length;
  const width = LABEL_W + colCount * COL_W;
  const height = HEADER_H + rowCount * ROW_H;

  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="ladder-chart chart-card__svg"
      role="img"
      aria-label="Probability ladder matrix"
    >
      {/* Column separator bands behind cells */}
      {columns.map((_, c) => (
        <line
          key={`colsep-${c}`}
          x1={LABEL_W + c * COL_W + 0.5}
          x2={LABEL_W + c * COL_W + 0.5}
          y1={HEADER_H - 4}
          y2={height}
          className="ladder-chart__colsep"
        />
      ))}

      {/* Column header labels */}
      {columns.map((label, c) => (
        <text
          key={`colhead-${c}-${label}`}
          x={LABEL_W + c * COL_W + COL_W / 2}
          y={HEADER_H - 10}
          className="ladder-chart__colhead"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}

      {/* Row labels */}
      {activeRows.map((row, r) => (
        <text
          key={`rowlabel-${r}-${row.label}`}
          x={LABEL_W - 10}
          y={HEADER_H + r * ROW_H + ROW_H / 2}
          className="ladder-chart__rowlabel"
          textAnchor="end"
          dominantBaseline="middle"
        >
          {row.label}
        </text>
      ))}

      {/* Cells */}
      {activeRows.map((row, r) =>
        row.values.slice(0, colCount).map((raw, c) => {
          const v = clampInt(raw, max);
          const tone = cellTone(v, max);
          if (tone === 0) return null;
          const isHL =
            activeHighlight && activeHighlight.row === r && activeHighlight.col === c;
          const x = LABEL_W + c * COL_W + CELL_INSET;
          const y = HEADER_H + r * ROW_H + CELL_INSET;
          const w = COL_W - CELL_INSET * 2;
          const h = ROW_H - CELL_INSET * 2;
          const isSolid = tone >= 0.55 || isHL;
          const cellClass = isHL
            ? "ladder-chart__cell ladder-chart__cell--highlight"
            : v >= max
              ? "ladder-chart__cell ladder-chart__cell--max"
              : "ladder-chart__cell";
          // CSS custom property carries the per-cell opacity so the
          // base rule in globals.css owns the color; --max and
          // --highlight modifiers override the opacity to 1.
          const toneStyle = { ["--ladder-cell-tone" as string]: tone } as React.CSSProperties;
          return (
            <g key={`cell-${r}-${c}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                className={cellClass}
                style={toneStyle}
              />
              <text
                x={x + w / 2}
                y={y + h / 2}
                className={
                  isSolid
                    ? "ladder-chart__cellnum ladder-chart__cellnum--on-solid"
                    : "ladder-chart__cellnum"
                }
                textAnchor="middle"
                dominantBaseline="central"
              >
                {v}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="ladder-chart-host">
      <button
        type="button"
        className="ladder-chart__reroll"
        onClick={() => {
          const r = randomLadder(DEFAULT_LABELS, columns.length);
          setActiveRows(r.rows);
          setActiveHighlight(r.highlight);
        }}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
