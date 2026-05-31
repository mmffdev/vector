# FLB — Barber-pole borders on mergeable cell edges

**Captured:** 2026-05-31 (mid-session, before fixing the still-broken joiner alignment)
**Status:** ✅ IMPLEMENTED 2026-05-31. `poleEdgesFor` in `mergeTransitions.ts` (raw seam sets → per-cell edges); `FormLayoutRenderer` applies `data-pole-{top,right,bottom,left}` with grid-perimeter suppression; CSS `.flb-grid__Cell[data-pole-*]` in `app/globals.css` (3px `#FFCC33`/`#1c1c22` −45° stripe, `.flb-slot` inset 3px per poled edge). Tests: 3 cases in `bandLayout.test.tsx`. Builder-only (gated on a seam renderer; runtime draws none). Open question below was resolved as "only actual mergeable seams".

## Intent

Make it visually unmistakable which cells can merge into which. On every **edge of
a cell that participates in a mergeable seam**, draw a barber-pole stripe. When two
cells can merge across a boundary, BOTH sides of that boundary get the barber pole,
the stripes facing each other → the seam reads as "these two can join."

## Visual

- **Barber pole:** repeating diagonal stripe, **3px** thick (the border width).
- **Colours:** orange `#FFCC33` and black.
- **Stripe geometry:** `10px 10px` at **-45°**.
  - i.e. `repeating-linear-gradient(-45deg, #FFCC33 0 10px, #000 10px 20px)` (tune to taste; 10px band each colour).
- Applied as a **3px border** (top/right/bottom/left) only on the edges that face a mergeable neighbour.

## Behaviour with a field present

- If the target cell is **empty**, the barber pole simply sits on the relevant edges.
- If the target cell **contains a field**, KEEP the barber pole on the mergeable edges
  AND **push the field content inward by the border width (3px)** so the field sits
  *inside* the barber-pole frame (no overlap). If all four sides are mergeable, the
  field is inset 3px on all sides, framed by the pole.

## Hard rules (edge suppression — independent of merge state)

These are absolute grid-perimeter rules. A perimeter edge NEVER gets a border even if
logically "mergeable":

1. A **first-column** cell never has a **left** border.
2. A **last-column** cell never has a **right** border.
3. A **top-row** cell never has a **top** border.
4. A **bottom-row** cell never has a **bottom** border.

(So the barber pole only ever appears on *interior* boundaries between two real cells.)

## Where it maps in code

- Mergeable boundaries are exactly what `seamsFor` (vertical ↕) and `hSeamsFor`
  (horizontal ↔) already compute in
  [`mergeTransitions.ts`](../app/components/FormLayoutBuilder/mergeTransitions.ts).
  - A vertical seam `{rowIndex:r, colIndex:c}` = boundary between rows `r` and `r+1`
    in column `c` → the **upper** cell gets a **bottom** barber pole, the **lower**
    cell gets a **top** barber pole.
  - A horizontal seam `{rowIndex:r, colIndex:c}` = boundary between cols `c` and `c+1`
    in row `r` → the **left** cell gets a **right** pole, the **right** cell gets a
    **left** pole.
- NOTE: use the RAW `seamsFor`/`hSeamsFor` here (every mergeable boundary gets the
  pole), NOT the dominant-filtered set (which is only about WHERE the single joiner
  glyph sits). The pole marks *all* mergeable edges; the glyph marks the dominant one.
- Rendering: the cell wrapper is `.flb-grid__Cell` in
  [`FormLayoutRenderer.tsx`](../app/components/FormLayoutBuilder/FormLayoutRenderer.tsx);
  CSS namespace `flb-*` in [`app/globals.css`](../app/globals.css). Add per-edge
  modifier classes (e.g. `data-pole-top/right/bottom/left`) computed from the seam
  sets, plus the inset-on-field rule.

## Open question to confirm at build time

- Does the pole face only the **other half of an actual seam** (so a cell edge with no
  mergeable neighbour stays bare), or every edge adjacent to ANY empty target? Spec
  above = "only actual mergeable seams" (the `seamsFor`/`hSeamsFor` boundaries).
