/**
 * ForecastMarker — the green (optimistic) / red (pessimistic) projected-finish
 * marker for both burndown charts (design 2026-06-06): a dotted vertical line
 * from plot top to baseline, a filled baseline dot, and a chevron date pill in
 * the lane below the x-axis.
 *
 * Pill orientation (per the mockup): the chevron TIP sits exactly on the marker
 * line `x`, and the pill body extends AWAY from the tip — green points RIGHT
 * (tip on line, body to the LEFT), red points LEFT (tip on line, body to the
 * RIGHT). The two pills mirror each other.
 *
 * Shared presentation geometry — NOT projection math, so it sits outside the
 * TD-TASKMETRICS-DUP-PROJECTION boundary; both charts render it. Colour is via
 * the --chart-optimistic / --chart-pessimistic tokens through tone classes.
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
  const top = pillY - PILL_H / 2;
  const bot = pillY + PILL_H / 2;

  // Tip is ON the line (x). Green points RIGHT → tip at x is the RIGHT edge, body
  // runs LEFT to (x - PILL_W). Red points LEFT → tip at x is the LEFT edge, body
  // runs RIGHT to (x + PILL_W).
  const pointsRight = tone === "opt";
  let pill: string;
  let textX: number;
  if (pointsRight) {
    const bodyLeft = x - PILL_W;
    // body rectangle (bodyLeft..x-CHEVRON) + chevron tip at x.
    pill = `${bodyLeft},${top} ${x - CHEVRON},${top} ${x},${pillY} ${x - CHEVRON},${bot} ${bodyLeft},${bot}`;
    textX = bodyLeft + (PILL_W - CHEVRON) / 2;
  } else {
    const bodyRight = x + PILL_W;
    pill = `${bodyRight},${top} ${x + CHEVRON},${top} ${x},${pillY} ${x + CHEVRON},${bot} ${bodyRight},${bot}`;
    textX = bodyRight - (PILL_W - CHEVRON) / 2;
  }

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
        x={textX}
        y={pillY + 3.5}
        textAnchor="middle"
      >
        {date}
      </text>
    </g>
  );
}

export default ForecastMarker;
