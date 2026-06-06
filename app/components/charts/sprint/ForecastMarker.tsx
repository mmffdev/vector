/**
 * ForecastMarker — the green (optimistic) / red (pessimistic) projected-finish
 * marker for both burndown charts (design 2026-06-06): a dotted vertical line
 * from plot top to baseline, a filled baseline dot, and a chevron date pill in
 * the lane below the x-axis. Green points right, red points left (mockup).
 *
 * Shared presentation geometry — NOT projection math, so it sits outside the
 * TD-TASKMETRICS-DUP-PROJECTION duplication boundary; both charts render it.
 * All colour is via the --chart-optimistic / --chart-pessimistic tokens applied
 * through the tone-suffixed CSS classes.
 */

const PILL_W = 52;
const PILL_H = 18;
const CHEVRON = 6; // depth of the arrow point

export function ForecastMarker({
  x,
  date,
  tone,
  plotTop,
  plotBottom,
  pillY,
}: {
  x: number;
  date: string;
  tone: "opt" | "pess";
  plotTop: number;
  plotBottom: number;
  pillY: number;
}) {
  // Green pill points RIGHT (the early/good direction), red points LEFT.
  const pointsRight = tone === "opt";
  const top = pillY - PILL_H / 2;
  const bot = pillY + PILL_H / 2;
  // Chevron pill polygon, centred on x, arrow on the leading edge.
  const left = x - PILL_W / 2;
  const right = x + PILL_W / 2;
  const pill = pointsRight
    ? `${left},${top} ${right - CHEVRON},${top} ${right},${pillY} ${right - CHEVRON},${bot} ${left},${bot}`
    : `${right},${top} ${left + CHEVRON},${top} ${left},${pillY} ${left + CHEVRON},${bot} ${right},${bot}`;

  return (
    <g className={`sprint-burndown__fmark sprint-burndown__fmark--${tone}`}>
      <line
        className="sprint-burndown__fmark-line"
        x1={x}
        y1={plotTop}
        x2={x}
        y2={plotBottom}
      />
      <circle className="sprint-burndown__fmark-dot" cx={x} cy={plotBottom} r={4} />
      <polygon className="sprint-burndown__fmark-pill" points={pill} />
      <text
        className="sprint-burndown__fmark-pilltext"
        x={pointsRight ? x - CHEVRON / 2 : x + CHEVRON / 2}
        y={pillY + 3.5}
        textAnchor="middle"
      >
        {date}
      </text>
    </g>
  );
}

export default ForecastMarker;
