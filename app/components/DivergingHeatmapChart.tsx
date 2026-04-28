"use client";

import { useState, useEffect } from "react";

// DivergingHeatmapChart — sparse diverging heatmap matrix. Each row is
// an entity (player, candidate, project) and each column a time-step
// or category bucket. Cells encode a signed magnitude on a two-pole
// scale: warm (positive) on one side, cool (negative) on the other,
// with intensity scaling cell saturation. Missing observations render
// as empty cells so the matrix can be sparse without padding zeros.
//
// Stub data ships by default; replace `rows` / `columns` with API data
// when wiring up. Colors come from the active theme via design tokens
// (--heat-warm / --heat-cool, derived from --danger / --info), so the
// chart restyles automatically when the user switches theme packs.
//
// Usage: <DivergingHeatmapChart />                              // stub
//        <DivergingHeatmapChart rows={[...]} columns={[...]} /> // real
//        <DivergingHeatmapChart randomize />                    // PREVIEW

export type DivergingHeatmapRow = {
  label: string;
  // values[i] ∈ [-max, +max] for column i, or null when no observation
  // exists for that cell. Length must equal columns.length; longer
  // arrays are truncated, shorter arrays render trailing empties.
  values: Array<number | null>;
};

const DEFAULT_COLUMNS: string[] = [
  "17", "18", "19", "20", "21", "22", "23", "24", "25",
  "26", "27", "28", "29", "30", "31", "32", "33", "34", "35",
];

// Generic stub labels — replace with real entity names when wiring up.
const DEFAULT_LABELS: string[] = [
  "Aurora", "Beacon", "Cinder", "Drift", "Ember",
  "Fathom", "Glint", "Halo", "Iris", "Junction",
  "Kestrel", "Lumen", "Marrow", "Nimbus", "Orbit",
  "Pivot", "Quartz", "Relay", "Stratus", "Tempo",
  "Umbra", "Vector", "Willow", "Xenon", "Yonder",
  "Zephyr", "Anvil", "Brace", "Cleat", "Delta",
];

// --- Geometry --------------------------------------------------------
const COL_W = 22;
const ROW_H = 18;
const LABEL_W = 130;
const HEADER_H = 26;
const CELL_INSET = 1; // px gap between cells

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

// Map |value| / max → opacity in [0, 1]. 0.08 minimum so non-zero
// cells are still visible against the surface; 1.0 ceiling at saturated.
function cellTone(value: number, max: number): number {
  const t = Math.min(1, Math.abs(value) / max);
  return 0.08 + 0.92 * t;
}

// Build the stub rows: each row picks a peak column and decays away
// from it on a Gaussian, with sign chosen so top rows lean warm and
// bottom rows lean cool. Cells outside the row's "active window"
// render as null. This keeps the matrix sparse and gives the catalog
// page a recognisable diagonal shape.
function buildStubRow(
  label: string,
  rowIndex: number,
  rowCount: number,
  colCount: number,
): DivergingHeatmapRow {
  const seed = (rowIndex * 9301 + 49297) % 233280; // deterministic
  const rand = (n: number) => ((seed * (n + 1)) % 1000) / 1000;

  // Active window — most rows occupy a contiguous span of columns.
  const span = Math.round(colCount * (0.45 + rand(1) * 0.45));
  const start = Math.round(rand(2) * (colCount - span));
  const end = start + span - 1;

  // Sign bias: top rows trend warm, bottom rows trend cool.
  const bias = 1 - 2 * (rowIndex / Math.max(1, rowCount - 1));
  const peakMag = Math.round((bias * 70 + (rand(3) - 0.5) * 40));
  const peakCol = start + Math.round(rand(4) * (span - 1));
  const sigma = 1.5 + rand(5) * 2.5;

  const values: Array<number | null> = Array.from({ length: colCount }, (_, c) => {
    if (c < start || c > end) return null;
    const dx = (c - peakCol) / sigma;
    const decay = Math.exp(-0.5 * dx * dx);
    const noise = (rand(c + 6) - 0.5) * 25;
    return Math.round(clamp(peakMag * decay + noise, -100, 100));
  });

  return { label, values };
}

// Replace `DEFAULT_ROWS` with API data when wiring up.
const DEFAULT_ROWS: DivergingHeatmapRow[] = DEFAULT_LABELS.map((label, i) =>
  buildStubRow(label, i, DEFAULT_LABELS.length, DEFAULT_COLUMNS.length),
);

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every row, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — "sparse diverging
// heatmap" (per-cell signed magnitude with optional nulls). Not
// in the generic matrix; closest cousin is the per-cell-bounds
// row, but with a two-pole signed range and explicit null cells:
//   • Each cell value clamps to [-max, +max] then rounds to int.
//   • Each row gets a contiguous "active window" of columns;
//     cells outside the window are null (no observation). The
//     window covers ≥35% of columns so a row never collapses
//     to a single cell or disappears entirely.
//   • Within the window, values follow a Gaussian decay from a
//     per-row peak so rows read as a smooth career arc rather
//     than per-cell noise; small jitter is added on top.
//   • Sign bias is row-position-dependent: top rows lean warm
//     (positive), bottom rows lean cool (negative), mid rows
//     mix. Preserves the diagonal "best at the top" gestalt.
//   • NaN / Infinity → 0 (not null) so a bad cell still paints
//     and surfaces upstream issues rather than silently
//     vanishing as missing data.
//   • Row / column counts are pinned to the props — pad nulls
//     or truncate so the matrix stays rectangular.
// If you build another diverging heatmap with different
// semantics (e.g. dense, no nulls, or per-row sum constraint),
// write a separate generator — do not reuse this one.
// =============================================================
function randomHeatmap(
  baseLabels: string[],
  colCount: number,
): DivergingHeatmapRow[] {
  return baseLabels.map((label, i) => {
    const span = Math.round(colCount * (0.35 + Math.random() * 0.55));
    const start = Math.round(Math.random() * (colCount - span));
    const end = start + span - 1;
    const bias = 1 - 2 * (i / Math.max(1, baseLabels.length - 1));
    const peakMag = Math.round((bias * 75 + (Math.random() - 0.5) * 50));
    const peakCol = start + Math.round(Math.random() * (span - 1));
    const sigma = 1.2 + Math.random() * 3.0;

    const values: Array<number | null> = Array.from({ length: colCount }, (_, c) => {
      if (c < start || c > end) return null;
      const dx = (c - peakCol) / sigma;
      const decay = Math.exp(-0.5 * dx * dx);
      const noise = (Math.random() - 0.5) * 35;
      const raw = peakMag * decay + noise;
      return Math.round(clamp(raw, -100, 100));
    });

    return { label, values };
  });
}

type HoverState = {
  rowLabel: string;
  colLabel: string;
  value: number;
  // Cursor position relative to the host wrapper, used to anchor
  // the tooltip without escaping the chart card.
  px: number;
  py: number;
};

export default function DivergingHeatmapChart({
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  max = 100,
  randomize = false,
}: {
  columns?: string[];
  rows?: DivergingHeatmapRow[];
  max?: number;
  /** PREVIEW ONLY — generate random rows on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeRows, setActiveRows] = useState(rows);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    if (randomize) setActiveRows(randomHeatmap(DEFAULT_LABELS, columns.length));
  }, [randomize, columns.length]);

  const colCount = columns.length;
  const rowCount = activeRows.length;
  const width = LABEL_W + colCount * COL_W;
  const height = HEADER_H + rowCount * ROW_H;

  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="diverging-heatmap-chart chart-card__svg"
      role="img"
      aria-label="Diverging heatmap matrix"
    >
      {/* Column header labels */}
      {columns.map((label, c) => (
        <text
          key={`colhead-${c}-${label}`}
          x={LABEL_W + c * COL_W + COL_W / 2}
          y={HEADER_H - 10}
          className="diverging-heatmap-chart__colhead"
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
          className="diverging-heatmap-chart__rowlabel"
          textAnchor="end"
          dominantBaseline="middle"
        >
          {row.label}
        </text>
      ))}

      {/* Cells. Empty cells (null / undefined) intentionally render
          nothing — no rect, no hit target, so hover tracking ignores
          them and the tooltip never fires for missing observations. */}
      {activeRows.map((row, r) =>
        row.values.slice(0, colCount).map((raw, c) => {
          if (raw === null || raw === undefined) return null;
          const v = clamp(Math.round(raw), -max, max);
          const tone = cellTone(v, max);
          const isWarm = v >= 0;
          const x = LABEL_W + c * COL_W + CELL_INSET;
          const y = HEADER_H + r * ROW_H + CELL_INSET;
          const w = COL_W - CELL_INSET * 2;
          const h = ROW_H - CELL_INSET * 2;
          const isHovered =
            hover && hover.rowLabel === row.label && hover.colLabel === columns[c];
          const cellClass = [
            "diverging-heatmap-chart__cell",
            isWarm
              ? "diverging-heatmap-chart__cell--warm"
              : "diverging-heatmap-chart__cell--cool",
            isHovered ? "diverging-heatmap-chart__cell--hover" : "",
          ]
            .filter(Boolean)
            .join(" ");
          // CSS custom property carries per-cell opacity so the base
          // rule in globals.css owns the color tokens.
          const toneStyle = { ["--heatmap-cell-tone" as string]: tone } as React.CSSProperties;
          return (
            <rect
              key={`cell-${r}-${c}`}
              x={x}
              y={y}
              width={w}
              height={h}
              className={cellClass}
              style={toneStyle}
              onMouseEnter={(e) => {
                const host = (e.currentTarget.ownerSVGElement?.parentElement) ?? null;
                const hostRect = host?.getBoundingClientRect();
                setHover({
                  rowLabel: row.label,
                  colLabel: columns[c],
                  value: v,
                  px: hostRect ? e.clientX - hostRect.left : e.clientX,
                  py: hostRect ? e.clientY - hostRect.top : e.clientY,
                });
              }}
              onMouseMove={(e) => {
                const host = (e.currentTarget.ownerSVGElement?.parentElement) ?? null;
                const hostRect = host?.getBoundingClientRect();
                setHover((prev) =>
                  prev
                    ? {
                        ...prev,
                        px: hostRect ? e.clientX - hostRect.left : e.clientX,
                        py: hostRect ? e.clientY - hostRect.top : e.clientY,
                      }
                    : prev,
                );
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        }),
      )}
    </svg>
  );

  return (
    <div className="diverging-heatmap-chart-host">
      {randomize && (
        <button
          type="button"
          className="diverging-heatmap-chart__reroll"
          onClick={() => setActiveRows(randomHeatmap(DEFAULT_LABELS, columns.length))}
          aria-label="Generate new random data"
          title="Generate new random data (preview only)"
        >
          ↻
        </button>
      )}
      {svg}
      {hover && (
        <div
          className="diverging-heatmap-chart__tooltip"
          role="tooltip"
          style={{ left: hover.px, top: hover.py }}
        >
          <div className="diverging-heatmap-chart__tooltip-row">{hover.rowLabel}</div>
          <div className="diverging-heatmap-chart__tooltip-col">{hover.colLabel}</div>
          <div
            className={
              hover.value >= 0
                ? "diverging-heatmap-chart__tooltip-value diverging-heatmap-chart__tooltip-value--warm"
                : "diverging-heatmap-chart__tooltip-value diverging-heatmap-chart__tooltip-value--cool"
            }
          >
            {hover.value > 0 ? `+${hover.value}` : hover.value}
          </div>
        </div>
      )}
    </div>
  );
}
