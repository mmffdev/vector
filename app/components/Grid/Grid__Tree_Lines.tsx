"use client";

// Grid__Tree_Lines — the per-row tree connector + indent, drawn as a single
// inline SVG inside the PRIMARY cell. The SVG's width (depth × STEP) IS the
// indent. The caret is rendered BEFORE this SVG (fixed column at every depth),
// so only the badge/label content shifts with depth; the +/− boxes stay
// vertically aligned. Rails anchor on the BADGE column at each depth (Rally
// pattern) — not the caret — and curve into each child badge from the left.
//
// Geometry (CONNECTOR_STYLE='hook', the active default — Rally-style curved
// hooks; each child gets its own quarter-arc from the parent's column out to
// the badge):
//   • continuations[i] === true → a │ through-line at ancestor level i (that
//     ancestor has more siblings below this subtree).
//   • non-last sibling → full through-vertical AT this row's parent column,
//     plus a quarter-arc branching off at MID and curving right to the badge.
//   • last sibling → no through-vertical past the curve; the curve descends
//     from the top to MID-R, arcs through MID, then runs right.
//   • hasVisibleChildren → a short ↓ stub dropping to the first child's rail.
//
// Geometry (CONNECTOR_STYLE='elbow', preserved for potential later use):
//   • isLast → this row's own connector is an elbow └; else a tee ├.
//   • horizontal runs from the parent column to stubEndX at MID.

// Indent per depth level. The primary cell renders [indent SVG][caret][badge]
// (caret sits AFTER the indent), so the caret is indented by depth × TREE_STEP
// — same per-level offset as the badge column. SVG x=0 is the cell-content
// start; the caret centre at depth N is at SVG x = N*step + CARET_CENTRE.
export const TREE_STEP = 28;
export const TREE_ROW_H = 48; // row height (matches --tree-row-h)
// Connector visual style. 'hook' = Rally-style curved quarter-arcs (active
// default). 'elbow' = sharp ├/└ tees/elbows (kept available for later use).
type ConnectorStyle = "hook" | "elbow";
const CONNECTOR_STYLE: ConnectorStyle = "hook";
// Quarter-arc radius for the 'hook' style. The curve descends to MID-R, arcs
// through MID, then runs horizontally to stubEndX.
const HOOK_RADIUS = 8;
// Caret centre's x offset within its flex slot. Caret is 16px wide with
// margin-left: -3 (CSS .grid__Tree_Caret), so its border-box left sits at
// slot-x = -3 and its visual centre at slot-x = -3 + 8 = 5.
const CARET_CENTRE = 5;
// Caret's visual LEFT EDGE within its flex slot (margin-left: -3). The elbow
// tail ends here so the connector lands on the caret's left middle.
const CARET_LEFT = -3;

export interface GridTreeLinesProps {
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  step?: number;
  rowH?: number;
}

export function GridTreeLines({
  depth,
  isLast,
  hasChildren,
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
  // Vertical centre of the stretched row. The primary cell and lines wrapper
  // both align-self:stretch, so SVG top:0 is row-top; do not add a second Y
  // nudge here or tails drift off the caret/badge centre.
  const MID = H / 2;
  // SVG layout width = the indent before the caret (0 at depth 0). The caret
  // sits AFTER the SVG in flex flow, so the caret column at depth N is at
  // SVG x = N*step + CARET_CENTRE. Drop-stub overflows past W via overflow:visible.
  const W = depth * step;
  // Parent caret centre column (this row's incoming rail rises here).
  const lineX = (depth - 1) * step + CARET_CENTRE;
  // THIS row's caret centre column — drop-stub descends here into the children.
  const childLineX = depth * step + CARET_CENTRE;
  // Elbow tail ends at:
  //   - branch row (hasChildren): child caret's LEFT EDGE (depth*step - 3)
  //   - leaf row (no caret): the BADGE's LEFT EDGE, after the invisible
  //     CaretSpacer's 21px advance, so the connector visibly reaches the
  //     badge instead of stopping in mid-air.
  const BADGE_OFFSET = 21; // caret/spacer advance: -3 margin-left + 16 width + 8 margin-right
  const stubEndX = depth * step + (hasChildren ? CARET_LEFT : BADGE_OFFSET);

  const ancestorPaths: string[] = [];
  const currentRowPaths: string[] = [];

  // Ancestor through-lines: a full-height │ at every GRANDPARENT-and-above
  // level still continuing below this subtree. We drop the LAST continuations
  // entry (the immediate parent) because THIS row's own ├/└ connector already
  // draws the parent-level vertical — keeping it here would overdraw a last
  // child's └ into a ├ (the bug: bottom sibling getting a tee, not an elbow).
  const ancestors = continuations.slice(0, -1);
  ancestors.forEach((cont, i) => {
    if (cont) {
      const x = i * step + CARET_CENTRE;
      ancestorPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  // This row's own connector (skipped at depth 0, which has no incoming rail).
  // Horizontal runs to stubEndX (touches the badge); vertical sits on the
  // parent caret centre (lineX). Last child = elbow only (no through-pole
  // descending past this row); non-last = through-vertical + hook.
  if (depth > 0) {
    const needThroughVertical = !isLast;
    if (CONNECTOR_STYLE === "hook") {
      const R = HOOK_RADIUS;
      if (needThroughVertical) {
        currentRowPaths.push(`M${lineX} 0 L${lineX} ${H}`);
        currentRowPaths.push(
          `M${lineX} ${MID - R} Q${lineX} ${MID} ${lineX + R} ${MID} L${stubEndX} ${MID}`,
        );
      } else {
        // ╰ — descend to MID-R, quarter-arc through MID, then run right.
        currentRowPaths.push(
          `M${lineX} 0 L${lineX} ${MID - R} Q${lineX} ${MID} ${lineX + R} ${MID} L${stubEndX} ${MID}`,
        );
      }
    } else {
      // 'elbow' style — kept available for later use.
      if (needThroughVertical) {
        // ├ — full-height vertical + horizontal at mid.
        currentRowPaths.push(`M${lineX} 0 L${lineX} ${H}`);
        currentRowPaths.push(`M${lineX} ${MID} L${stubEndX} ${MID}`);
      } else {
        // └ — down to mid, then right.
        currentRowPaths.push(`M${lineX} 0 L${lineX} ${MID} L${stubEndX} ${MID}`);
      }
    }
  }

  // Drop-stub: when this row is expanded with children, descend from THIS
  // row's MID (caret centre Y) to the row bottom. The caret button sits ON
  // the line — visually the line passes through the caret area rather than
  // emerging "hard" from its bottom edge.
  if (hasVisibleChildren) {
    currentRowPaths.push(`M${childLineX} ${MID} L${childLineX} ${H}`);
  }

  // Layout: an in-flow spacer provides the indent width (W); the SVG overlays
  // it absolutely so its drawing (drop-stub + tail, which both overflow past W)
  // never shifts the caret/badge. DRAW_W must cover childLineX (the rightmost
  // path x) plus a small buffer.
  const DRAW_W = childLineX + step;
  const allPaths = [...ancestorPaths, ...currentRowPaths];
  // Node dot at the ├/└ junction. Only meaningful for sharp-elbow rendering;
  // in 'hook' mode the curve provides its own visual continuity so the dot is
  // suppressed.
  const showNode = depth > 0 && CONNECTOR_STYLE === "elbow";

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
            stroke="var(--grid-tree-row-connector)"
            strokeWidth="1"
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
