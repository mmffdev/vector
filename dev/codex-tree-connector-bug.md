# Bug: tree-grid connector rails render wrong on last-child rows

## TL;DR
On the `/scope` page we render a hierarchical work-item grid. Each row draws SVG
"tree connector" rails (the ├ / └ / │ lines that visually link a parent to its
children, Rally/Jira-style). When a group is expanded, the **last child** in a
group renders the wrong connector: it shows a full-height vertical with no clean
elbow, and/or a vertical that dangles into the gap below the last child instead
of terminating cleanly. Non-last children render correctly. The connector
*topology logic* worked correctly two days ago (commit `1216e042`); an
in-flight visual redesign (row height 30→48px, curved "hook" connector style,
caret repositioning) changed the geometry constants and the bug appeared. We
need the connectors to render correctly again **without reverting the new visual
design** (keep 48px rows, keep the curved hook style).

---

## The files involved

All paths are relative to repo root.

### 1. `app/components/Grid/Grid__Tree_Lines.tsx`  (THE MAIN SUSPECT)
A pure presentational React component. Given a node's tree geometry, it returns
a single inline `<svg class="grid__Tree_Lines">` containing `<path>` elements
that draw the connector rails for ONE row. It owns no state — it's a pure
function of its props.

**Props (`GridTreeLinesProps`):**
- `depth: number` — nesting level. Roots = 0, their children = 1, etc.
- `isLast: boolean` — is this row the last among its direct siblings?
- `hasChildren: boolean` — does this node have children (caret shown)?
- `hasVisibleChildren: boolean` — is it currently expanded with children rendered?
- `continuations: boolean[]` — one flag per ANCESTOR (root → immediate parent).
  `continuations[i] === true` means "the ancestor at depth `i` has more siblings
  below this subtree", i.e. a vertical through-line should pass through this row
  at that ancestor's column. Length === `depth`. The LAST entry
  (`continuations[depth-1]`) is the immediate parent.

**Geometry constants (current, post-redesign):**
- `TREE_STEP = 28` — horizontal indent per depth level (px).
- `TREE_ROW_H = 48` — row height (px). (Was 30 in the working version.)
- `HOOK_RADIUS = 8` — quarter-arc radius for the curved "hook" style.
- `CARET_CENTRE = 5` — x-offset of a caret's visual centre within its flex slot.
  (Was a constant called `CARET_OFFSET = 33` in the working version — see below.)
- `CARET_LEFT = -3` — caret's visual left edge within its flex slot.
- `CONNECTOR_STYLE = "hook"` — active style (curved). `"elbow"` (sharp ├/└) is
  kept as a dead branch for later use.

**Derived geometry (per render):**
- `MID = H / 2` → 24. The vertical centre where horizontal tails land.
  (Working version used `MID = (H-1)/2 - 5` = 9.5 — note the **-5 nudge**.)
- `W = depth * step` — the indent width; the `<svg>` wrapper's layout width.
- `lineX = (depth-1)*step + CARET_CENTRE` — x of the PARENT's caret column;
  this row's incoming rail rises here.
- `childLineX = depth*step + CARET_CENTRE` — x of THIS row's own caret column;
  the drop-stub into its children descends here.
- `stubEndX = depth*step + (hasChildren ? CARET_LEFT : BADGE_OFFSET)` — where the
  horizontal tail ends (lands on the caret edge for a branch row, or on the
  badge's left edge for a leaf row). `BADGE_OFFSET = 21`.

**Path-building logic (current):**
1. **Ancestor through-lines**: iterate `continuations.slice(0, -1)` (drops the
   immediate-parent entry on purpose) and, for each `true`, push a full-height
   vertical `M{x} 0 L{x} H` at `x = i*step + CARET_CENTRE`.
2. **This row's own connector** (only if `depth > 0`):
   `needThroughVertical = !isLast`.
   - If `needThroughVertical` (non-last): push a full-height vertical at `lineX`
     PLUS a quarter-arc hook from `MID-R` curving right to `stubEndX` at `MID`
     (a ├-style tee with a curve).
   - Else (last child): push only the `╰` curve — descend from top to `MID-R`,
     arc through `MID`, run right to `stubEndX` (a └-style elbow, no vertical
     past mid).
3. **Drop-stub**: if `hasVisibleChildren`, push `M{childLineX} MID L{childLineX} H`
   — descends from this row's mid to its bottom edge, to meet the first child's
   incoming vertical (which starts at the child row's top).

### 2. `app/components/Grid/Grid__Tree_Row.tsx`
Renders one grid row. The PRIMARY (first) cell contains, in flex order:
`<GridTreeLines/>` (the indent SVG, width = `depth*step`), THEN the caret
`<button class="grid__Tree_Caret">` (or `<span class="grid__Tree_CaretSpacer">`
for leaf rows), THEN the column's badge/label content. So the visual layout is
`[indent SVG][caret][badge]`. Because the caret comes AFTER the SVG and the cell
has `gap: 0`, the caret's visual centre at depth N sits at
`x = N*step + CARET_CENTRE` in the SVG's coordinate space — which is exactly what
`childLineX` targets.

### 3. `app/components/Grid/useTree.ts`  (NOT changed; data source — trust it)
The headless tree hook. It computes `depth`, `isLast`, and `continuations` for
every node and is covered by passing unit tests
(`app/components/Grid/__tests__/useTree.test.tsx`) that explicitly assert these
values for lazy-loaded nested children. **This file is unchanged from the
working version and its tests pass — treat its output as correct.** The bug is
NOT in how `isLast`/`continuations` are computed; it's in how
`Grid__Tree_Lines.tsx` + the CSS turn them into pixels.

A confirmed live reading (from the actual broken DOM, last child of an expanded
group) was: `depth=2, isLast=true, continuations=[true, true]`.

### 4. `app/globals.css`  (the connector CSS)
Relevant selectors (current state):

```css
.grid__Tree_Row {
  display: grid;
  align-items: center;        /* centres each grid cell to content height */
  height: var(--tree-row-h);  /* 48px */
  border-bottom: 1px solid var(--border);
}
.grid__Tree_Cell {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;            /* 16px left padding */
  overflow: hidden;
}
.grid__Tree_Cell--primary {
  gap: 0;                     /* SVG butts straight against the caret */
  overflow: visible;          /* so the horizontal tail isn't clipped */
  align-self: stretch;        /* ADDED THIS SESSION: make cell full row height */
}
.grid__Tree_LinesWrap {       /* the in-flow spacer that reserves the indent */
  position: relative;
  flex-shrink: 0;
  align-self: stretch;
}
.grid__Tree_Lines {           /* the SVG, overlaid absolutely on the wrap */
  position: absolute;
  top: 0; left: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 0;                 /* behind caret/badge/label */
}
.grid__Tree_Caret,
.grid__Tree_CaretSpacer {
  flex: 0 0 auto;
  width: 16px; height: 16px;
  margin: 0 8px 0 -3px;       /* advance: -3 + 16 + 8 = 21px; centre at +5 */
}
```

Connector stroke colour: `var(--grid-tree-row-connector)`; width 1px.

---

## What it SHOULD look like (expected)

A standard file-tree / Rally backlog connector:

```
EP-11934            ─┐  (parent, expanded)
 ├─ US-18119         │   non-last child: vertical passes through + branch hook
 └─ US-18120         │   ...
     ├─ TA-58345     │   non-last grandchild: through-vertical + hook to badge
     └─ TA-58346         last grandchild: clean └ elbow, NO vertical below it
EP-11948                next root sibling
```

Rules:
1. A child's connector branches off its PARENT's column (the vertical at
   `lineX`) and curves right into the child's badge/caret.
2. A **non-last** child draws a through-vertical at its parent's column that
   continues full-height (so the next sibling can hang off it).
3. A **last** child draws a `└`/`╰` elbow — the parent's column rail TERMINATES
   at that child (nothing dangles below it).
4. Every horizontal tail lands at the row's vertical centre (`MID`), dead-centre
   on the caret/badge.
5. An ancestor that has more siblings below the current subtree draws a
   full-height through-line at that ancestor's column (so deep descendants still
   show the higher-level rails passing on their left).
6. A vertical must visually CONNECT to the next thing — terminate exactly on a
   caret/badge centre, never dangle into an empty inter-row gap.

## What's going WRONG (observed)

On expanded groups, the **last child** row renders wrong:
- It shows a full-height vertical at its parent's column (looks like a non-last
  ├ tee) instead of a clean terminating `└`/`╰` elbow; and/or
- A vertical segment dangles in the whitespace BELOW the last child, pointing at
  nothing, before the next group's row.

Non-last children look fine. The original complaint also noted the horizontal
tails sat a few px **too low** (below the badge's vertical centre) — that was
introduced when the redesign changed `MID` from `(H-1)/2 - 5` to a flat `H/2`
without otherwise compensating for the SVG's vertical origin (see next section).

## Two known geometry changes the redesign made (likely root causes)

The last-known-good commit (`1216e042`, "yesterday") rendered correctly. Diffing
that against the current working tree, the connector geometry changed in ways
that are the prime suspects:

1. **Vertical centring / SVG origin.** Working version used `MID = (H-1)/2 - 5`
   (a deliberate **-5px nudge upward**) AND did NOT set `align-self: stretch` on
   `.grid__Tree_Cell--primary`. The current version uses flat `MID = H/2` with no
   nudge. Because `.grid__Tree_Row` is `display:grid; align-items:center`, a grid
   cell shrinks to its content height and is vertically centred in the 48px row —
   so the absolutely-positioned SVG's `top:0` does NOT coincide with the row top,
   pushing every `MID`-anchored tail downward. (This session added
   `align-self: stretch` to the primary cell to force it full-height so
   `top:0 == row-top`; verify this is actually correct and sufficient, or replace
   it with the equivalent `MID` nudge — but only ONE compensation should exist,
   not both.)

2. **Column x-offset.** Working version used `CARET_OFFSET = 33` for the rail
   columns; current uses `CARET_CENTRE = 5`. The caret CSS (`margin: 0 8px 0 -3px`)
   is identical in both versions, so verify which constant actually lands the
   rails dead-centre on the carets/badges in the live DOM. The two cannot both be
   right unless something else also moved.

The connector *decision logic* (`needThroughVertical = !isLast`, and the
`continuations.slice(0, -1)` ancestor rule) is byte-for-byte identical to the
working commit, so the regression is almost certainly in the **geometry
constants / CSS layout**, not the branch logic.

## Your task

1. Make the tree connectors render per the "expected" rules above, on `/scope`,
   for arbitrary depth and last/non-last positions — especially the last child
   of an expanded group and last-children under still-continuing ancestors.
2. KEEP the new visual design: 48px rows, curved "hook" connector style.
3. Verify the rails land dead-centre on carets/badges (both x and y) at every
   depth. Reconcile the `CARET_CENTRE`/`MID` math against the ACTUAL rendered
   caret position (cell `padding-left:16`, `gap:0`, caret `margin-left:-3`,
   SVG width `depth*step`). Don't keep two competing vertical-centring fixes.
4. Add a focused unit/snapshot test over `GridTreeLines` that pins the exact
   `<path d="…">` output for: a non-last leaf, a true last-of-line leaf, a last
   child whose parent still continues (`continuations=[…,true]`, `isLast=true`),
   and an expanded branch with a drop-stub. Lock the topology so this can't
   regress again.

## How to reproduce / verify

- Dev frontend runs on `http://localhost:5101`, backend on `:5100` (env `dev`).
- Page: `/scope`. Expand a group (the `+`/`−` caret in the first column) that has
  children which themselves have children, so you get ≥2 nesting levels with a
  clear last-child at the bottom of a group.
- Tests: `npx vitest run app/components/Grid/`.
- Type check: `npx tsc --noEmit -p tsconfig.json` (must stay clean for Grid).

## Reference: the last-known-good geometry (commit 1216e042)

For a depth-2 last child with `continuations=[true,true]`, the working version
emitted (offset 33, MID 9.5, H 30):
- ancestor through-line: `M33 0 L33 30`
- own elbow (└): `M61 0 L61 9.5 L90 9.5`

For a depth-1 non-last branch row with children, `continuations=[true]`:
- `M33 0 L33 30` (├ vertical) + `M33 9.5 L62 9.5` (horizontal) +
  `M61 9.5 L61 30` (drop-stub).

Use these as a topology reference (the SHAPES, not the literal numbers — the new
design legitimately changes step/row-height/curve).
