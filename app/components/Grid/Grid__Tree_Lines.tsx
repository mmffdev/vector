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
export const TREE_STEP = 28;
export const TREE_ROW_H = 30; // row height (matches --tree-row-h)
// Base x for the rail verticals. Caret centres sit at 24, 48, 72, … (cell
// left-pad 16 + half caret 8, then +step per level); 24 would put the rail
// dead-centre under the chevron. Set to 33 to position the whole rail (│
// through-lines, ├└ downstrokes, child drop-stub) relative to the chevron.
const CARET_OFFSET = 33;
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
  // A depth-0 row has no incoming rail, but if it has visible children it still
  // needs to draw the drop-stub that descends from its own badge into the first
  // child — without it the parent's vertical would "stop at the row top" and not
  // connect. So we only bail when there's truly nothing to draw.
  if (depth === 0 && !hasVisibleChildren) return null;

  const H = rowH;
  // Vertical centre of the row's CONTENT, nudged 5px up to sit dead-centre on
  // the badge ((H-1)/2 content-centre, minus 5).
  const MID = (H - 1) / 2 - 5;
  // SVG LAYOUT width = the true indent (0 at depth 0, so a root row gets no
  // indent). The drop-stub at childLineX overflows this box (overflow:visible),
  // so a root with children still draws its descending vertical without pushing
  // its own caret right.
  const W = depth * step;
  const lineX = (depth - 1) * step + CARET_OFFSET; // on the PARENT caret centre
  // The drop-stub / child-elbow anchor sits one level deeper, under THIS row's
  // own caret — i.e. where this row's children's rail rises to.
  const childLineX = depth * step + CARET_OFFSET;
  // Horizontal elbow/tee end — runs to just past this row's own caret toward the
  // badge so the rail visibly TOUCHES it. Overflows the SVG box (overflow:visible).
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

  // This row's own connector (skipped at depth 0, which has no incoming rail).
  // Horizontal runs to stubEndX (touches the badge); vertical sits on the
  // parent caret centre (lineX).
  if (depth > 0) {
    if (isLast) {
      // └ — down to mid, then right.
      paths.push(`M${lineX} 0 L${lineX} ${MID} L${stubEndX} ${MID}`);
    } else {
      // ├ — full-height vertical + horizontal at mid.
      paths.push(`M${lineX} 0 L${lineX} ${H}`);
      paths.push(`M${lineX} ${MID} L${stubEndX} ${MID}`);
    }
  }

  // Drop-stub: when this row is expanded with children, descend from THIS row's
  // mid (caret/badge level) to the bottom edge so it meets the first child's
  // vertical (which starts at the child row's top) — a continuous line from the
  // parent down into the child, at every level (including depth 0).
  if (hasVisibleChildren) {
    paths.push(`M${childLineX} ${MID} L${childLineX} ${H}`);
  }

  // Layout: an in-flow spacer provides the indent width (W); the SVG overlays it
  // absolutely so its drawing (including the badge-touching horizontal + the
  // drop-stub, which both overflow past W) never shifts the caret/badge. The
  // overlay's drawing box is generously wide (DRAW_W) so no path is clipped.
  const DRAW_W = childLineX + STUB_EXTEND + step;
  const allPaths = [...throughPaths, ...paths];
  // Node dot at the ├/└ junction (where this row's vertical meets its
  // horizontal). Reads as the tree node for this row. Only on connector rows.
  const showNode = depth > 0;

  return (
    <span className="grid__Tree_LinesWrap" style={{ width: `${W}px` }}>
      <svg
        className="grid__Tree_Lines"
        width={DRAW_W}
        height={H}
        viewBox={`0 0 ${DRAW_W} ${H}`}
        aria-hidden="true"
      >
        {allPaths.map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="var(--tree-connector)"
            strokeWidth="1.25"
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {showNode && (
          <circle
            cx={lineX}
            cy={MID}
            r={2}
            className="grid__Tree_LinesNode"
          />
        )}
      </svg>
    </span>
  );
}
