"use client";

import { useState, useEffect } from "react";

// Chart ref: C-14
// AdjacencyMatrixChart — categorical relationship matrix.
// Each row and column is a category (room, team, capability). Each
// off-diagonal cell holds an ordinal "priority" level encoding how
// strongly the row category should be adjacent to the column category.
// The matrix is symmetric: cell (r, c) == cell (c, r). The diagonal
// is always empty (a category isn't adjacent to itself).
//
// Levels are ordinal (1=MAYBE, 2=SHOULD, 3=MUST). They render as ink
// dots whose RADIUS encodes priority (size carries the categorical
// signal); ink saturation amplifies the same axis. The brand accent
// is reserved for the single highlighted focal cell so it stays
// visually exclusive across the chart.
//
// Stub data ships by default; replace `pairs` with API data when
// wiring up. Colors come from the active theme via design tokens, so
// the chart restyles automatically when the user switches theme packs.
//
// Usage: <AdjacencyMatrixChart />                       // 21×21 stub
//        <AdjacencyMatrixChart pairs={[...]} />         // real data
//        <AdjacencyMatrixChart highlight={{r:14,c:16}}/>// focal cell
//        <AdjacencyMatrixChart randomize />             // PREVIEW ONLY

export type AdjacencyLevel = 1 | 2 | 3; // 1=MAYBE, 2=SHOULD, 3=MUST

export type AdjacencyPair = {
  /** 0-based row index. */
  row: number;
  /** 0-based column index. */
  col: number;
  level: AdjacencyLevel;
};

export type AdjacencyHighlight = {
  /** 0-based row index. */
  row: number;
  /** 0-based column index. */
  col: number;
};

const DEFAULT_LABELS: string[] = [
  "ENTRY",
  "LOBBY",
  "RECEPTION",
  "ADMINISTRATION",
  "SECURITY",
  "LOUNGE",
  "RESTROOMS",
  "EMPLOYEE LOUNGE",
  "GIFT SHOP",
  "CAFÉ",
  "CLASSROOMS",
  "REC. STUDIO",
  "WORKSHOP",
  "RECITAL HALL",
  "GRAND THEATER",
  "DRESSING ROOM",
  "REHEARSAL",
  "MUSICIAN LOUNGE",
  "MECH. ROOM",
  "CONTROL ROOM",
  "STORAGE",
];

// Hand-curated upper-triangle adjacency seed. Mirroring is handled by
// expandSymmetric() so callers only have to supply (r < c) entries.
// Replace `DEFAULT_PAIRS` with API data when wiring up.
const DEFAULT_PAIRS: AdjacencyPair[] = [
  // ENTRY → ...
  { row: 0, col: 1, level: 3 },
  { row: 0, col: 4, level: 3 },
  { row: 0, col: 6, level: 2 },
  // LOBBY → ...
  { row: 1, col: 2, level: 3 },
  { row: 1, col: 5, level: 3 },
  { row: 1, col: 6, level: 3 },
  { row: 1, col: 8, level: 2 },
  { row: 1, col: 9, level: 2 },
  { row: 1, col: 14, level: 3 },
  { row: 1, col: 13, level: 2 },
  // RECEPTION → ...
  { row: 2, col: 3, level: 3 },
  { row: 2, col: 4, level: 2 },
  { row: 2, col: 8, level: 1 },
  // ADMINISTRATION → ...
  { row: 3, col: 4, level: 2 },
  { row: 3, col: 7, level: 2 },
  { row: 3, col: 19, level: 1 },
  // SECURITY → ...
  { row: 4, col: 19, level: 2 },
  { row: 4, col: 20, level: 1 },
  // LOUNGE → ...
  { row: 5, col: 6, level: 3 },
  { row: 5, col: 9, level: 2 },
  { row: 5, col: 13, level: 2 },
  { row: 5, col: 14, level: 2 },
  // RESTROOMS → ...
  { row: 6, col: 7, level: 1 },
  { row: 6, col: 13, level: 2 },
  { row: 6, col: 14, level: 2 },
  // EMPLOYEE LOUNGE → ...
  { row: 7, col: 17, level: 3 },
  { row: 7, col: 15, level: 2 },
  // GIFT SHOP → ...
  { row: 8, col: 9, level: 2 },
  // CAFÉ → ...
  { row: 9, col: 14, level: 1 },
  // CLASSROOMS → ...
  { row: 10, col: 11, level: 3 },
  { row: 10, col: 12, level: 2 },
  { row: 10, col: 16, level: 2 },
  { row: 10, col: 20, level: 1 },
  // REC. STUDIO → ...
  { row: 11, col: 12, level: 2 },
  { row: 11, col: 16, level: 3 },
  { row: 11, col: 19, level: 3 },
  { row: 11, col: 20, level: 1 },
  // WORKSHOP → ...
  { row: 12, col: 15, level: 2 },
  { row: 12, col: 18, level: 2 },
  { row: 12, col: 20, level: 2 },
  // RECITAL HALL → ...
  { row: 13, col: 15, level: 3 },
  { row: 13, col: 16, level: 3 },
  { row: 13, col: 19, level: 3 },
  { row: 13, col: 20, level: 1 },
  // GRAND THEATER → ...
  { row: 14, col: 15, level: 3 },
  { row: 14, col: 16, level: 3 },
  { row: 14, col: 17, level: 2 },
  { row: 14, col: 19, level: 3 },
  { row: 14, col: 20, level: 2 },
  // DRESSING ROOM → ...
  { row: 15, col: 16, level: 3 },
  { row: 15, col: 17, level: 3 },
  // REHEARSAL → ...
  { row: 16, col: 17, level: 3 },
  { row: 16, col: 19, level: 2 },
  { row: 16, col: 20, level: 1 },
  // MUSICIAN LOUNGE → ...
  { row: 17, col: 20, level: 1 },
  // MECH. ROOM → ...
  { row: 18, col: 19, level: 2 },
  { row: 18, col: 20, level: 2 },
  // CONTROL ROOM → ...
  { row: 19, col: 20, level: 1 },
];

const DEFAULT_HIGHLIGHT: AdjacencyHighlight = { row: 14, col: 16 }; // GRAND THEATER × REHEARSAL

// --- Geometry --------------------------------------------------------
const VBW = 760;
const VBH = 760;
const LABEL_W = 150;
const HEADER_H = 150;
const CELL_SIZE = 28;

// Per-level dot radius. Categorical signal is carried by SIZE first;
// the CSS rule maps the same level to ink saturation as a secondary
// amplifier so colour-blind users still get the ranking from area.
const LEVEL_RADIUS: Record<AdjacencyLevel, number> = {
  1: 3.5,
  2: 6.5,
  3: 10,
};

function expandSymmetric(pairs: AdjacencyPair[]): Map<string, AdjacencyLevel> {
  const out = new Map<string, AdjacencyLevel>();
  for (const p of pairs) {
    if (p.row === p.col) continue; // diagonal stays empty
    const a = `${p.row}:${p.col}`;
    const b = `${p.col}:${p.row}`;
    out.set(a, p.level);
    out.set(b, p.level);
  }
  return out;
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every cell, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — categorical adjacency
// matrix (symmetric, diagonal-empty, ordinal levels). Not in the
// generic matrix; closest cousin is the probability ladder, but
// here cells are independent ordinal categories rather than a row-
// stochastic distribution:
//   • Diagonal cells (r == r) are ALWAYS empty — a category is
//     never adjacent to itself.
//   • Matrix is SYMMETRIC: only the upper triangle (r < c) is
//     sampled; mirror to (c, r). Asymmetric writes would render
//     as visual noise across the diagonal.
//   • Level distribution is sparse and weighted to match the
//     visual density of an architect's adjacency chart:
//       ~70% empty, ~14% MAYBE (1), ~12% SHOULD (2), ~4% MUST (3).
//     A fully-dense matrix is unreadable; a fully-empty one is
//     uninformative — these weights keep the chart legible.
//   • Highlight cell is re-picked from the resulting non-empty
//     pairs so the focal accent always lands on a real value.
//   • If the random pass produces zero non-empty cells (very
//     unlikely with N=21), fall back to the default highlight
//     and inject one MUST cell at the default highlight position.
// If you build another categorical-relationship chart with
// different semantics (directed edges, multi-label cells), write
// a separate generator — do not reuse this one.
// =============================================================
function randomAdjacency(
  labelCount: number,
): { pairs: AdjacencyPair[]; highlight: AdjacencyHighlight } {
  const pairs: AdjacencyPair[] = [];
  for (let r = 0; r < labelCount; r++) {
    for (let c = r + 1; c < labelCount; c++) {
      const roll = Math.random();
      if (roll < 0.70) continue; // empty
      let level: AdjacencyLevel;
      if (roll < 0.84) level = 1;
      else if (roll < 0.96) level = 2;
      else level = 3;
      pairs.push({ row: r, col: c, level });
    }
  }

  if (pairs.length === 0) {
    pairs.push({ ...DEFAULT_HIGHLIGHT, level: 3 });
    return { pairs, highlight: DEFAULT_HIGHLIGHT };
  }

  // Prefer a MUST cell for the focal point; fall back to any pair.
  const musts = pairs.filter((p) => p.level === 3);
  const pool = musts.length > 0 ? musts : pairs;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { pairs, highlight: { row: pick.row, col: pick.col } };
}

type HoverState = {
  rowLabel: string;
  colLabel: string;
  level: AdjacencyLevel;
  // Cursor position relative to the host wrapper, used to anchor
  // the tooltip without escaping the chart card.
  px: number;
  py: number;
};

const LEVEL_NAME: Record<AdjacencyLevel, string> = {
  1: "MAYBE",
  2: "SHOULD",
  3: "MUST",
};

export default function AdjacencyMatrixChart({
  labels = DEFAULT_LABELS,
  pairs = DEFAULT_PAIRS,
  highlight = DEFAULT_HIGHLIGHT,
  randomize = false,
}: {
  labels?: string[];
  pairs?: AdjacencyPair[];
  highlight?: AdjacencyHighlight;
  /** PREVIEW ONLY — generate random pairs on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activePairs, setActivePairs] = useState(pairs);
  const [activeHighlight, setActiveHighlight] = useState(highlight);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    if (randomize) {
      const r = randomAdjacency(labels.length);
      setActivePairs(r.pairs);
      setActiveHighlight(r.highlight);
    }
  }, [randomize, labels.length]);

  const n = labels.length;
  const lookup = expandSymmetric(activePairs);
  const gridW = n * CELL_SIZE;
  const gridH = n * CELL_SIZE;
  const width = LABEL_W + gridW;
  const height = HEADER_H + gridH;

  // Inline legend lives in the top-left header well so the SVG is
  // self-contained (the chart-card legend below the SVG describes the
  // chart itself; this in-canvas legend decodes the dots).
  const legendX = 12;
  const legendY = 16;
  const legendRowH = 22;

  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="adjacency-matrix-chart chart-card__svg"
      role="img"
      aria-label="Spatial adjacency matrix"
    >
      {/* Legend (top-left header well) */}
      <g className="adjacency-matrix-chart__legend">
        <text
          x={legendX}
          y={legendY}
          className="adjacency-matrix-chart__legend-title"
        >
          PRIORITY
        </text>
        {([3, 2, 1] as AdjacencyLevel[]).map((lvl, i) => {
          const cy = legendY + 14 + i * legendRowH;
          const label = lvl === 3 ? "MUST" : lvl === 2 ? "SHOULD" : "MAYBE";
          return (
            <g key={`legend-${lvl}`}>
              <circle
                cx={legendX + 12}
                cy={cy}
                r={LEVEL_RADIUS[lvl]}
                className={`adjacency-matrix-chart__dot adjacency-matrix-chart__dot--level-${lvl}`}
              />
              <text
                x={legendX + 30}
                y={cy + 4}
                className="adjacency-matrix-chart__legend-text"
              >
                {label}
              </text>
            </g>
          );
        })}
      </g>

      {/* Grid lines (one per cell boundary) */}
      {Array.from({ length: n + 1 }, (_, i) => (
        <line
          key={`vline-${i}`}
          x1={LABEL_W + i * CELL_SIZE + 0.5}
          x2={LABEL_W + i * CELL_SIZE + 0.5}
          y1={HEADER_H}
          y2={HEADER_H + gridH}
          className="adjacency-matrix-chart__gridline"
        />
      ))}
      {Array.from({ length: n + 1 }, (_, i) => (
        <line
          key={`hline-${i}`}
          x1={LABEL_W}
          x2={LABEL_W + gridW}
          y1={HEADER_H + i * CELL_SIZE + 0.5}
          y2={HEADER_H + i * CELL_SIZE + 0.5}
          className="adjacency-matrix-chart__gridline"
        />
      ))}

      {/* Diagonal shading — visually mark the empty diagonal so the
          eye reads the matrix as symmetric without having to count. */}
      {labels.map((_, i) => (
        <rect
          key={`diag-${i}`}
          x={LABEL_W + i * CELL_SIZE + 1}
          y={HEADER_H + i * CELL_SIZE + 1}
          width={CELL_SIZE - 2}
          height={CELL_SIZE - 2}
          className="adjacency-matrix-chart__diagonal"
        />
      ))}

      {/* Column header labels — rotated 270° (anti-clockwise) so they
          sit above their column without crowding. */}
      {labels.map((label, c) => {
        const x = LABEL_W + c * CELL_SIZE + CELL_SIZE / 2;
        const y = HEADER_H - 6;
        return (
          <text
            key={`colhead-${c}`}
            x={x}
            y={y}
            transform={`rotate(-60 ${x} ${y})`}
            className="adjacency-matrix-chart__collabel"
            textAnchor="start"
          >
            {label}
          </text>
        );
      })}

      {/* Row labels */}
      {labels.map((label, r) => (
        <text
          key={`rowlabel-${r}`}
          x={LABEL_W - 8}
          y={HEADER_H + r * CELL_SIZE + CELL_SIZE / 2}
          className="adjacency-matrix-chart__rowlabel"
          textAnchor="end"
          dominantBaseline="middle"
        >
          {label}
        </text>
      ))}

      {/* Dots — only render cells where lookup has a level. The lookup
          is already symmetric so the loop visits both triangles. */}
      {labels.map((_, r) =>
        labels.map((__, c) => {
          if (r === c) return null;
          const level = lookup.get(`${r}:${c}`);
          if (!level) return null;
          const cx = LABEL_W + c * CELL_SIZE + CELL_SIZE / 2;
          const cy = HEADER_H + r * CELL_SIZE + CELL_SIZE / 2;
          const isHL =
            activeHighlight.row === r && activeHighlight.col === c;
          const cls = isHL
            ? `adjacency-matrix-chart__dot adjacency-matrix-chart__dot--level-${level} adjacency-matrix-chart__dot--highlight`
            : `adjacency-matrix-chart__dot adjacency-matrix-chart__dot--level-${level}`;
          return (
            <circle
              key={`dot-${r}-${c}`}
              cx={cx}
              cy={cy}
              r={LEVEL_RADIUS[level]}
              className={cls}
            />
          );
        }),
      )}

      {/* Hit-rects — invisible cell-sized targets sit on top so hover
          works even when the dot is tiny (MAYBE radius is ~3.5 px).
          Empty + diagonal cells get NO hit-rect, which is exactly the
          "don't roll over empty squares" rule from the spec. */}
      {labels.map((_, r) =>
        labels.map((__, c) => {
          if (r === c) return null;
          const level = lookup.get(`${r}:${c}`);
          if (!level) return null;
          const x = LABEL_W + c * CELL_SIZE;
          const y = HEADER_H + r * CELL_SIZE;
          const isHover =
            hover && hover.rowLabel === labels[r] && hover.colLabel === labels[c];
          const updateFromEvent = (e: React.MouseEvent<SVGRectElement>) => {
            const host = (e.currentTarget.ownerSVGElement?.parentElement) as HTMLElement | null;
            if (!host) return;
            const rect = host.getBoundingClientRect();
            setHover({
              rowLabel: labels[r],
              colLabel: labels[c],
              level,
              px: e.clientX - rect.left,
              py: e.clientY - rect.top,
            });
          };
          const cls = isHover
            ? "adjacency-matrix-chart__hit adjacency-matrix-chart__hit--hover"
            : "adjacency-matrix-chart__hit";
          return (
            <rect
              key={`hit-${r}-${c}`}
              x={x + 1}
              y={y + 1}
              width={CELL_SIZE - 2}
              height={CELL_SIZE - 2}
              className={cls}
              onMouseEnter={updateFromEvent}
              onMouseMove={updateFromEvent}
              onMouseLeave={() => setHover(null)}
            />
          );
        }),
      )}
    </svg>
  );

  return (
    <div className="adjacency-matrix-chart-host">
      {randomize && (
        <button
          type="button"
          className="adjacency-matrix-chart__reroll"
          onClick={() => {
            const r = randomAdjacency(labels.length);
            setActivePairs(r.pairs);
            setActiveHighlight(r.highlight);
          }}
          aria-label="Generate new random data"
          title="Generate new random data (preview only)"
        >
          ↻
        </button>
      )}
      {svg}
      {hover && (
        <div
          className="adjacency-matrix-chart__tooltip"
          style={{ left: hover.px, top: hover.py }}
        >
          <div className="adjacency-matrix-chart__tooltip-row">
            {hover.rowLabel}
          </div>
          <div className="adjacency-matrix-chart__tooltip-col">
            × {hover.colLabel}
          </div>
          <div
            className={`adjacency-matrix-chart__tooltip-value adjacency-matrix-chart__tooltip-value--level-${hover.level}`}
          >
            {LEVEL_NAME[hover.level]}
          </div>
        </div>
      )}
    </div>
  );
}
