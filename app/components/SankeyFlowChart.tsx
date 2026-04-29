"use client";

import { useState, useEffect } from "react";

// Chart ref: C-16
// SankeyFlow chart — 2-layer flow diagram. Source nodes line the top
// edge, destination nodes line the bottom edge, and bezier curves
// carry weight from each source to each destination. Source bars and
// flows step through a 4-tone ink gradient based on source position
// so the eye can trace each source's contribution across the bundle;
// the focal destination picks up `--accent` to mark a single readout.
//
// Stub data ships by default; replace `flows` with API data when
// wiring up. Per-node totals are derived from the flow list, so a
// real-data swap only needs to set `sources`, `destinations`, and
// `flows`. Colours come from theme tokens, so the chart restyles
// automatically when the user switches theme packs.
//
// Usage: <SankeyFlowChart />                                      // 12×8 stub
//        <SankeyFlowChart sources={[...]} destinations={[...]}
//                         flows={[...]} />                        // real data
//        <SankeyFlowChart highlight={4} />                        // focal dest
//        <SankeyFlowChart randomize />                            // PREVIEW ONLY

export type SankeyFlowNode = { label: string };

export type SankeyFlow = {
  /** 0-based source index. */
  source: number;
  /** 0-based destination index. */
  dest: number;
  /** Mass carried by this flow (any positive unit). */
  value: number;
};

const DEFAULT_SOURCES: SankeyFlowNode[] = [
  { label: "Africa" },
  { label: "Asia East" },
  { label: "Asia South" },
  { label: "Asia SE" },
  { label: "Caribbean" },
  { label: "Central Am." },
  { label: "Europe" },
  { label: "Mediterranean" },
  { label: "Middle East" },
  { label: "Oceania" },
  { label: "South Am." },
  { label: "United States" },
];

const DEFAULT_DESTS: SankeyFlowNode[] = [
  { label: "British Columbia" },
  { label: "Alberta" },
  { label: "Saskatchewan" },
  { label: "Manitoba" },
  { label: "Ontario" },
  { label: "Québec" },
  { label: "New Brunswick" },
  { label: "Nova Scotia" },
];

// Representative flow shape: most mass lands in Ontario / Québec /
// BC, smaller scatter to other provinces, with each source slightly
// preferring different destinations so the bundle isn't a uniform
// scaling. Replace `DEFAULT_FLOWS` with API data when wiring up.
const DEFAULT_FLOWS: SankeyFlow[] = (() => {
  const destShare = [22, 14, 4, 5, 38, 12, 2, 3];
  const sourceShare = [10, 14, 9, 7, 5, 6, 12, 4, 11, 3, 8, 11];
  const flows: SankeyFlow[] = [];
  for (let s = 0; s < sourceShare.length; s++) {
    for (let d = 0; d < destShare.length; d++) {
      const pref = 0.7 + ((s * 7 + d * 3) % 11) / 18;
      flows.push({
        source: s,
        dest: d,
        value: Math.max(0.4, (sourceShare[s] * destShare[d] * pref) / 100),
      });
    }
  }
  return flows;
})();

const DEFAULT_HIGHLIGHT = 4; // Ontario

// --- Geometry --------------------------------------------------------
const VBW = 720;
const VBH = 460;
const SIDE_PAD = 24;
const SOURCE_BAR_Y = 70;
const SOURCE_BAR_H = 12;
const DEST_BAR_H = 16;
const DEST_LABEL_H = 60;
const DEST_BAR_Y = VBH - DEST_LABEL_H - DEST_BAR_H;
const NODE_GAP = 2; // px gap between adjacent source / dest segments
const TONE_COUNT = 4;

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function toneFor(idx: number, count: number): number {
  if (count <= 1) return 1;
  return clampInt(Math.floor((idx * TONE_COUNT) / count), 0, TONE_COUNT - 1) + 1;
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// the flow matrix, and the inline ↻ button re-rolls again on
// click. DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — 2-layer sankey /
// origin-destination flow with per-source mass conservation:
//   • Generate a per-source weight in [4, 24] for each source.
//   • Generate a per-destination preference in [0.4, 1.6] for
//     each dest (scales how much mass each dest tends to receive).
//   • For each source, allocate its weight across destinations
//     proportional to dest preference × per-cell jitter; floor each
//     allocation at 0.3 so no flow vanishes (keeps the curve bundle
//     visually continuous).
//   • Re-balance per source so the row sum equals the source weight
//     exactly — push the rounding residual to the largest cell so
//     the source's total mass is preserved. (Per-source conservation
//     is the visual contract; per-dest totals are emergent.)
//   • NaN / Infinity → 0.3; the per-cell floor + sigma floor
//     together guarantee no source collapses to all-zero.
//   • Highlight: pick a destination at random — visual marker only,
//     does not change any flow.
// If you build another flow chart with different conservation
// semantics (multi-layer sankey, asymmetric balance, signed flows),
// write a separate generator — do not reuse this one.
// =============================================================
function randomSankey(
  sourceCount: number,
  destCount: number,
): { flows: SankeyFlow[]; highlight: number } {
  const sourceWeights = Array.from({ length: sourceCount }, () => 4 + Math.random() * 20);
  const destPrefs = Array.from({ length: destCount }, () => 0.4 + Math.random() * 1.2);
  const flows: SankeyFlow[] = [];
  for (let s = 0; s < sourceCount; s++) {
    const raw = destPrefs.map((p) => Math.max(0.3, p * (0.6 + Math.random() * 0.8)));
    const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
    const scaled = raw.map((v) => (v / rawSum) * sourceWeights[s]);
    let largest = 0;
    for (let d = 1; d < scaled.length; d++) if (scaled[d] > scaled[largest]) largest = d;
    const residual = sourceWeights[s] - scaled.reduce((a, b) => a + b, 0);
    scaled[largest] = Math.max(0.3, scaled[largest] + residual);
    for (let d = 0; d < destCount; d++) {
      const v = scaled[d];
      flows.push({ source: s, dest: d, value: Number.isFinite(v) ? Math.max(0.3, v) : 0.3 });
    }
  }
  const highlight = Math.floor(Math.random() * destCount);
  return { flows, highlight };
}

export default function SankeyFlowChart({
  sources = DEFAULT_SOURCES,
  destinations = DEFAULT_DESTS,
  flows = DEFAULT_FLOWS,
  highlight = DEFAULT_HIGHLIGHT,
  randomize = false,
}: {
  sources?: SankeyFlowNode[];
  destinations?: SankeyFlowNode[];
  flows?: SankeyFlow[];
  /** 0-based destination index marked as the focal node. */
  highlight?: number;
  /** PREVIEW ONLY — generate random flows on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeFlows, setActiveFlows] = useState(flows);
  const [activeHighlight, setActiveHighlight] = useState(highlight);

  useEffect(() => {
    if (randomize) {
      const r = randomSankey(sources.length, destinations.length);
      setActiveFlows(r.flows);
      setActiveHighlight(r.highlight);
    }
  }, [randomize, sources.length, destinations.length]);

  const sourceTotals: number[] = sources.map(() => 0);
  const destTotals: number[] = destinations.map(() => 0);
  for (const f of activeFlows) {
    if (f.source >= 0 && f.source < sources.length) sourceTotals[f.source] += f.value;
    if (f.dest >= 0 && f.dest < destinations.length) destTotals[f.dest] += f.value;
  }
  const totalMass = sourceTotals.reduce((a, b) => a + b, 0) || 1;

  const innerW = VBW - SIDE_PAD * 2;
  const sourceX: number[] = [];
  const sourceW: number[] = [];
  {
    let cursor = SIDE_PAD;
    for (let s = 0; s < sources.length; s++) {
      const w = Math.max(2, (sourceTotals[s] / totalMass) * innerW - NODE_GAP);
      sourceX.push(cursor);
      sourceW.push(w);
      cursor += w + NODE_GAP;
    }
  }
  const destX: number[] = [];
  const destW: number[] = [];
  {
    let cursor = SIDE_PAD;
    for (let d = 0; d < destinations.length; d++) {
      const w = Math.max(2, (destTotals[d] / totalMass) * innerW - NODE_GAP);
      destX.push(cursor);
      destW.push(w);
      cursor += w + NODE_GAP;
    }
  }

  // Anchors: each flow gets a sub-stripe on its source bar (ordered
  // by dest index, fans the source's outflow left-to-right) and on
  // its dest bar (ordered by source index, packs the dest's inflow
  // by origin). Computing both passes up front lets us render flows
  // sorted by size without losing alignment.
  const bySrc: number[][] = sources.map(() => []);
  const byDst: number[][] = destinations.map(() => []);
  activeFlows.forEach((f, i) => {
    if (
      f.source >= 0 && f.source < sources.length &&
      f.dest >= 0 && f.dest < destinations.length &&
      f.value > 0
    ) {
      bySrc[f.source].push(i);
      byDst[f.dest].push(i);
    }
  });
  bySrc.forEach((idx) => idx.sort((a, b) => activeFlows[a].dest - activeFlows[b].dest));
  byDst.forEach((idx) => idx.sort((a, b) => activeFlows[a].source - activeFlows[b].source));

  const srcAnchor = new Map<number, { sxMid: number; sw: number }>();
  for (let s = 0; s < sources.length; s++) {
    let cursor = sourceX[s];
    for (const i of bySrc[s]) {
      const v = activeFlows[i].value;
      const sw = sourceTotals[s] > 0 ? (v / sourceTotals[s]) * sourceW[s] : 0;
      srcAnchor.set(i, { sxMid: cursor + sw / 2, sw });
      cursor += sw;
    }
  }
  const dstAnchor = new Map<number, { dxMid: number; dw: number }>();
  for (let d = 0; d < destinations.length; d++) {
    let cursor = destX[d];
    for (const i of byDst[d]) {
      const v = activeFlows[i].value;
      const dw = destTotals[d] > 0 ? (v / destTotals[d]) * destW[d] : 0;
      dstAnchor.set(i, { dxMid: cursor + dw / 2, dw });
      cursor += dw;
    }
  }

  const sourceBarBottom = SOURCE_BAR_Y + SOURCE_BAR_H;
  const destBarTop = DEST_BAR_Y;
  // Anchor each bezier 1px INSIDE the bar fill on both ends. Combined
  // with butt linecaps in CSS this guarantees the (opaque) bar rect
  // covers every endpoint — no nub, no anti-alias sliver, regardless
  // of stroke width.
  const flowYStart = sourceBarBottom - 1;
  const flowYEnd = destBarTop + 1;
  const cy = flowYStart + (flowYEnd - flowYStart) * 0.5;

  type RenderedFlow = {
    i: number;
    path: string;
    strokeW: number;
    tone: number;
  };

  const flowPaths: RenderedFlow[] = activeFlows
    .map((f, i) => {
      const sa = srcAnchor.get(i);
      const da = dstAnchor.get(i);
      if (!sa || !da) return null;
      const path = `M ${sa.sxMid.toFixed(2)} ${flowYStart} C ${sa.sxMid.toFixed(2)} ${cy.toFixed(2)}, ${da.dxMid.toFixed(2)} ${cy.toFixed(2)}, ${da.dxMid.toFixed(2)} ${flowYEnd}`;
      const strokeW = Math.max(0.6, Math.min(sa.sw, da.dw));
      const tone = toneFor(f.source, sources.length);
      return { i, path, strokeW, tone };
    })
    .filter((x): x is RenderedFlow => x !== null)
    .sort((a, b) => b.strokeW - a.strokeW);

  const svg = (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      className="sankeyflow-chart chart-card__svg"
      role="img"
      aria-label="Sankey flow chart"
    >
      <g className="sankeyflow-chart__flows">
        {flowPaths.map((p) => (
          <path
            key={`flow-${p.i}`}
            d={p.path}
            className={`sankeyflow-chart__flow sankeyflow-chart__flow--tone-${p.tone}`}
            strokeWidth={p.strokeW}
            fill="none"
          />
        ))}
      </g>

      {sources.map((s, i) => {
        const tone = toneFor(i, sources.length);
        const x = sourceX[i];
        const w = sourceW[i];
        const labelX = x + w / 2;
        return (
          <g key={`src-${i}`}>
            <rect
              x={x}
              y={SOURCE_BAR_Y}
              width={w}
              height={SOURCE_BAR_H}
              className={`sankeyflow-chart__sourcebar sankeyflow-chart__sourcebar--tone-${tone}`}
            />
            <text
              x={labelX}
              y={SOURCE_BAR_Y - 6}
              className="sankeyflow-chart__sourcelabel"
              textAnchor="start"
              transform={`rotate(-58 ${labelX} ${SOURCE_BAR_Y - 6})`}
            >
              {s.label}
            </text>
          </g>
        );
      })}

      {destinations.map((d, i) => {
        const x = destX[i];
        const w = destW[i];
        const isHL = i === activeHighlight;
        const barCls = isHL
          ? "sankeyflow-chart__destbar sankeyflow-chart__destbar--highlight"
          : "sankeyflow-chart__destbar";
        const labelCls = isHL
          ? "sankeyflow-chart__destlabel sankeyflow-chart__destlabel--highlight"
          : "sankeyflow-chart__destlabel";
        return (
          <g key={`dst-${i}`}>
            <rect
              x={x}
              y={DEST_BAR_Y}
              width={w}
              height={DEST_BAR_H}
              className={barCls}
            />
            <text
              x={x + w / 2}
              y={DEST_BAR_Y + DEST_BAR_H + 14}
              className={labelCls}
              textAnchor="middle"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="sankeyflow-chart-host">
      <button
        type="button"
        className="sankeyflow-chart__reroll"
        onClick={() => {
          const r = randomSankey(sources.length, destinations.length);
          setActiveFlows(r.flows);
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
