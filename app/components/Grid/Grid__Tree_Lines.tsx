"use client";

// Grid__Tree_Lines — the per-row tree connector + indent, drawn as a single
// inline SVG inside the PRIMARY cell. Copied from ResourceTree's TreeLines so
// the rails read identically. The SVG's width (depth × STEP) IS the indent —
// it sits inline before the caret, so only the primary cell content shifts;
// the lead columns (stripe/checkbox/drag/cog) never move.
//
// Geometry:
//   • continuations[i] === true → a │ through-line at ancestor level i (that
//     ancestor has more siblings below this subtree).
//   • isLast → this row's own connector is an elbow └; else a tee ├.
//   • hasVisibleChildren → a short ↓ stub dropping to the first child's rail.

// Indent per depth level. The primary cell has gap:0 (.grid__Tree_Cell--primary)
// so the indent SVG butts straight against the caret — consecutive caret centres
// therefore step by exactly TREE_STEP, which is what lets one constant offset
// align the rail on every level's caret.
export const TREE_STEP = 24;
export const TREE_ROW_H = 30; // row height (matches --tree-row-h)
// Depth-0 caret centre = cell left-padding (16) + half caret (8) = 24. A child's
// rail vertical at (depth-1)*step + CARET_OFFSET then lands on the parent caret
// centre (24, 48, 72, …) at EVERY level.
const CARET_OFFSET = 24;
// Horizontal ├/└ stub length past its rail vertical — reaches under this row's
// own caret and on toward the badge (longer = closer to the badge). Tuned so the
// tee/elbow sits just under the badge.
const STUB_EXTEND = 29;

export interface GridTreeLinesProps {
  depth: number;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  step?: number;
  rowH?: number;
}

export function GridTreeLines({
  depth,
  isLast,
  hasVisibleChildren,
  continuations,
  step = TREE_STEP,
  rowH = TREE_ROW_H,
}: GridTreeLinesProps) {
  if (depth === 0) return null;

  const H = rowH;
  const MID = H / 2;
  const W = depth * step; // SVG layout width = the indent (caret sits after it)
  const lineX = (depth - 1) * step + CARET_OFFSET; // on the PARENT caret centre
  const childLineX = depth * step + CARET_OFFSET; // on THIS row's caret centre
  // Horizontal stub end — runs from the parent-centred rail to just past THIS
  // row's own caret centre, toward the badge. Overflows the SVG box
  // (overflow:visible) so it doesn't shift the caret.
  const stubEndX = lineX + STUB_EXTEND;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  // Ancestor through-lines: a full-height │ at every GRANDPARENT-and-above
  // level still continuing below this subtree. We drop the LAST continuations
  // entry (the immediate parent) because THIS row's own ├/└ connector already
  // draws the parent-level vertical — keeping it here would overdraw a last
  // child's └ into a ├ (the bug: bottom sibling getting a tee, not an elbow).
  const ancestors = continuations.slice(0, -1);
  ancestors.forEach((cont, i) => {
    if (cont) {
      const x = i * step + CARET_OFFSET;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  // This row's own connector. Horizontal runs to stubEndX (under the caret,
  // toward the badge); vertical sits on the parent caret centre (lineX).
  if (isLast) {
    // └ — down to mid, then right.
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${stubEndX} ${MID}`);
  } else {
    // ├ — full-height vertical + horizontal at mid.
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${stubEndX} ${MID}`);
  }

  // Drop stub to the first child's rail when expanded with children.
  if (hasVisibleChildren) {
    paths.push(`M${childLineX} ${MID + 6} L${childLineX} ${H}`);
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="grid__Tree_Lines"
      aria-hidden="true"
    >
      {throughPaths.map((d, i) => (
        <path
          key={`t${i}`}
          d={d}
          stroke="var(--tree-connector)"
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {paths.map((d, i) => (
        <path
          key={`c${i}`}
          d={d}
          stroke="var(--tree-connector)"
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
