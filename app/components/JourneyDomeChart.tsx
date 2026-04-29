"use client";

import { useState, useEffect } from "react";

// Chart ref: C-09
// JourneyDomeChart — semicircular concentric-stage chart. N rings
// stack from a small central title core out to an outer ring; each
// ring carries a curved label and an icon callout positioned at a
// specific angle along the half-circle. Ring tones step from
// faint → solid as you move inward so the eye is drawn to the core.
//
// Stub data ships by default; replace `stages` (and optionally
// `title`) with real data when wiring up. Colors come from the
// active theme via design tokens, so the chart restyles
// automatically when the user switches theme packs.
//
// Usage: <JourneyDomeChart />                              // stub
//        <JourneyDomeChart stages={[...]} title="..." />   // real data
//        <JourneyDomeChart randomize />                    // PREVIEW ONLY

export type JourneyStage = {
  /** Curved label text rendered along the ring's top arc. */
  label: string;
  /** 0° = right, 90° = top, 180° = left. Defaults to evenly-spread slot. */
  iconAngleDeg?: number;
  /** Single-glyph fallback shown inside the icon callout circle. */
  iconLetter?: string;
};

// Replace `DEFAULT_STAGES` and `DEFAULT_TITLE` with API data when wiring up.
const DEFAULT_STAGES: JourneyStage[] = [
  { label: "AWARENESS",     iconAngleDeg: 158, iconLetter: "A" },
  { label: "CONSIDERATION", iconAngleDeg: 122, iconLetter: "C" },
  { label: "PURCHASE",      iconAngleDeg:  86, iconLetter: "P" },
  { label: "ADVOCACY",      iconAngleDeg:  48, iconLetter: "V" },
  { label: "RETENTION",     iconAngleDeg:  14, iconLetter: "R" },
];

const DEFAULT_TITLE = "CUSTOMER JOURNEY";

// --- Geometry --------------------------------------------------------
// Drawing in a 920×580 viewBox with the dome origin near the bottom
// edge so the rings sweep up. Icon callouts sit just outside the
// outermost ring at a uniform radius so they read as a coherent
// satellite ring of annotations.
const W = 920;
const H = 580;
const CX = W / 2;
const CY = H - 110;
const R_OUTER = 360;
const R_CORE = 78;
const RING_GAP = 6;
const ICON_RADIUS = 22;
const ICON_OFFSET = 40;
const ICON_R = R_OUTER + ICON_OFFSET + ICON_RADIUS;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// SVG ring band path from a1 to a2 (degrees), with given outer/inner
// radii. Sweep flag is chosen so the band fills the upper half of the
// circle when a1 > a2.
function ringPath(cx: number, cy: number, rOuter: number, rInner: number, a1: number, a2: number): string {
  const o1 = polar(cx, cy, rOuter, a1);
  const o2 = polar(cx, cy, rOuter, a2);
  const i2 = polar(cx, cy, rInner, a2);
  const i1 = polar(cx, cy, rInner, a1);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i1.x} ${i1.y}`,
    `Z`,
  ].join(" ");
}

// Reference path for <textPath>. Travels left → over the top → right
// so labels read upright and centred.
function labelArcPath(cx: number, cy: number, r: number): string {
  const start = polar(cx, cy, r, 175);
  const end = polar(cx, cy, r, 5);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every stage, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — "stage dome / staged
// concentric semicircles". Closest cousin in the matrix is
// "Concentric arcs / progress rings" but rings here are
// structural (each ring is one stage, always full sweep) rather
// than completion-driven:
//   • Stage count is held constant per re-roll — never drop or
//     duplicate stages mid-roll (the geometry would jump).
//   • Icon angles are spread across the upper half-circle so
//     callouts never overlap: divide [10°, 170°] into N equal
//     slots and jitter each by ±25% of the slot width. Outermost
//     ring takes the leftmost slot, innermost the rightmost, so
//     the callouts read as a left-to-right journey progression.
//   • Stage labels are sampled WITHOUT REPLACEMENT from a fixed
//     pool of journey terms — every re-roll yields N distinct
//     labels.
//   • iconLetter mirrors the first character of the new label.
//   • Title is sampled from a small pool of journey names so the
//     core stays meaningful.
// If you build another structural-arc chart with different
// semantics (variable arc widths, partial sweeps, multi-segment
// rings) write a separate generator — do not reuse this one.
// =============================================================
const RANDOM_LABEL_POOL = [
  "DISCOVERY", "INTEREST", "EVALUATION", "TRIAL", "ONBOARDING",
  "ACTIVATION", "ENGAGEMENT", "EXPANSION", "RENEWAL", "REFERRAL",
  "FEEDBACK", "SUPPORT", "RECOVERY", "REWARD", "MILESTONE",
];
const RANDOM_TITLE_POOL = [
  "USER LIFECYCLE", "ONBOARDING FLOW", "ADOPTION ARC",
  "GROWTH PATH", "PRODUCT JOURNEY", "EXPANSION LOOP",
];

function randomDome(stageCount: number): { stages: JourneyStage[]; title: string } {
  const slot = (170 - 10) / stageCount;
  const labels = [...RANDOM_LABEL_POOL]
    .sort(() => Math.random() - 0.5)
    .slice(0, stageCount);
  const stages: JourneyStage[] = labels.map((label, i) => {
    const center = 170 - slot * (i + 0.5); // outer ring → leftmost angle
    const jitter = (Math.random() - 0.5) * slot * 0.5;
    return {
      label,
      iconAngleDeg: Math.max(8, Math.min(172, center + jitter)),
      iconLetter: label.charAt(0),
    };
  });
  const title = RANDOM_TITLE_POOL[Math.floor(Math.random() * RANDOM_TITLE_POOL.length)];
  return { stages, title };
}

export default function JourneyDomeChart({
  stages = DEFAULT_STAGES,
  title = DEFAULT_TITLE,
  randomize = false,
}: {
  stages?: JourneyStage[];
  title?: string;
  /** PREVIEW ONLY — generate random stages on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeStages, setActiveStages] = useState(stages);
  const [activeTitle, setActiveTitle] = useState(title);

  useEffect(() => {
    if (randomize) {
      const r = randomDome(stages.length || DEFAULT_STAGES.length);
      setActiveStages(r.stages);
      setActiveTitle(r.title);
    }
  }, [randomize, stages.length]);

  const n = activeStages.length;
  const span = R_OUTER - R_CORE;
  const ringT = (span - RING_GAP * (n - 1)) / n;

  const rings = activeStages.map((stage, i) => {
    const rOuter = R_OUTER - i * (ringT + RING_GAP);
    const rInner = rOuter - ringT;
    // Bias label slightly toward the outer edge so descenders don't
    // collide with the inner ring boundary.
    const labelR = (rOuter + rInner) / 2 + 3;
    return { stage, rOuter, rInner, labelR, toneIndex: i };
  });

  // Split title onto two lines if it has whitespace.
  const titleWords = activeTitle.split(/\s+/);
  const titleLines = titleWords.length === 1
    ? [activeTitle]
    : [
        titleWords.slice(0, Math.ceil(titleWords.length / 2)).join(" "),
        titleWords.slice(Math.ceil(titleWords.length / 2)).join(" "),
      ];
  const titleLh = 16;
  const titleYStart = CY - ((titleLines.length - 1) * titleLh) / 2 - R_CORE * 0.35;

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="journey-dome-chart chart-card__svg"
      role="img"
      aria-label={`Journey dome chart — ${activeTitle}`}
    >
      <defs>
        {rings.map((r, i) => (
          <path
            key={`labelpath-${i}`}
            id={`journey-label-path-${i}`}
            d={labelArcPath(CX, CY, r.labelR)}
            fill="none"
          />
        ))}
      </defs>

      {/* rings */}
      {rings.map((r, i) => (
        <path
          key={`ring-${i}`}
          d={ringPath(CX, CY, r.rOuter, r.rInner, 180, 0)}
          className={`journey-dome-chart__ring journey-dome-chart__ring--tone-${(i % 5) + 1}`}
        />
      ))}

      {/* curved labels — tone modifier flips fill so the label stays
          legible on the underlying ring tone (AUTO-CONTRAST rule) */}
      {rings.map((r, i) => {
        const toneSlot = (i % 5) + 1;
        return (
          <text
            key={`label-${i}`}
            className={`journey-dome-chart__label journey-dome-chart__label--tone-${toneSlot}`}
          >
            <textPath href={`#journey-label-path-${i}`} startOffset="50%" textAnchor="middle">
              {r.stage.label}
            </textPath>
          </text>
        );
      })}

      {/* central title core (semicircle) */}
      <path
        d={ringPath(CX, CY, R_CORE, 0, 180, 0)}
        className="journey-dome-chart__core"
      />
      {titleLines.map((line, i) => (
        <text
          key={`title-${i}`}
          x={CX}
          y={titleYStart + i * titleLh}
          className="journey-dome-chart__title"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {line}
        </text>
      ))}

      {/* icon callouts — leader from the ring outer edge to a fixed
          satellite radius outside the dome; icon circle sits at the
          satellite radius so all callouts read as one annotation ring */}
      {rings.map((r, i) => {
        const angle = r.stage.iconAngleDeg ?? (170 - ((170 - 10) / n) * (i + 0.5));
        const ringPoint = polar(CX, CY, r.rOuter, angle);
        const iconCenter = polar(CX, CY, ICON_R, angle);
        return (
          <g key={`callout-${i}`}>
            <line
              x1={ringPoint.x}
              y1={ringPoint.y}
              x2={iconCenter.x}
              y2={iconCenter.y}
              className="journey-dome-chart__leader"
            />
            <circle
              cx={iconCenter.x}
              cy={iconCenter.y}
              r={ICON_RADIUS}
              className="journey-dome-chart__icon-bg"
            />
            <text
              x={iconCenter.x}
              y={iconCenter.y}
              className="journey-dome-chart__icon-glyph"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {r.stage.iconLetter ?? r.stage.label.charAt(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="journey-dome-chart-host">
      <button
        type="button"
        className="journey-dome-chart__reroll"
        onClick={() => {
          const r = randomDome(stages.length || DEFAULT_STAGES.length);
          setActiveStages(r.stages);
          setActiveTitle(r.title);
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
