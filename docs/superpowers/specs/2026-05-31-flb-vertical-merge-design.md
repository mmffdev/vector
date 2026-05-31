# Form Layout Builder — Vertical Cell Merge + Picker Restyle

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending implementation plan
**Area:** `app/components/FormLayoutBuilder/`
**Builds on:** [2026-05-30-form-layout-builder-design.md](2026-05-30-form-layout-builder-design.md)

## Summary

Two changes to the Form Layout Builder, brainstormed together because they
share the same renderer + CSS surface:

1. **Vertical cell merge** — let an author fuse a column across two or more
   adjacent rows that share the same template, producing a single tall cell
   (e.g. a "Notes" field beside several short fields). Symmetric un-merge.
2. **Sidebar (field picker) restyle** — a search box, a "Mandatory fields"
   group, and a single "Available fields" group with a count badge, matching
   the reference Rick supplied. Placed-field and available-field cards adopt
   the rounded-card + left-accent-bar styling already used on the canvas.

The SERVER IS THE GATE rule is preserved: the merge geometry is re-validated
server-side (rectangular-band invariant + known templates), never trusted
from the client.

## 1. Vertical cell merge

### 1.1 Behaviour (confirmed in brainstorm)

- **Merge depth:** a column can span **any number** of stacked rows (not just
  a pair) — repeatedly joining downward grows a tall cell.
- **Eligibility:** merge is offered **only when the row above and the row
  below share the same template** (e.g. both `30-30-30`). No partial /
  cross-template alignment. This keeps every column boundary identical so a
  seam is unambiguous.
- **Independent per-column merges:** each column seam merges on its own.
  Fusing the middle column of rows A+B does not fuse the left or right
  columns; those remain independent and can be merged separately.
- **Join affordance:** a ◇ join handle appears at an aligned column seam
  between two same-template adjacent rows **only when the lower cell is
  empty**. Clicking it fuses that column's cell-above into the empty cell
  below, producing one tall cell. Seams whose lower cell is occupied show no
  handle — so a merge can never overwrite or displace a placed field, and the
  canvas only offers merges that are actually possible.
- **Un-merge:** the tall (fused) cell shows a **split handle (⊟) in its
  top-right corner**. Clicking it un-fuses that column back into one cell per
  row it spanned.
- **Rectangular-band invariant:** within a band (a run of fused rows), every
  column accounts for the same total number of sub-rows — no ragged bottoms.
  The block is always a clean rectangle.

### 1.2 Data model

Today: `LayoutDoc.rows: Row[]`, each `Row` has `cells: Cell[]` with a `span`
(width %). Purely 1-D. We extend it minimally — **no migration, old layouts
keep working** because the new field defaults to "no merge".

**Add `rowSpan` to a cell** (TS `app/lib/formLayoutsApi.ts`, Go
`backend/internal/formlayouts/types.go`):

```ts
interface FormCell {
  id: string;
  fieldKey: string | null;
  span: number;            // width % — unchanged
  rowSpan?: number;        // NEW: vertical extent in sub-rows, default 1
  absorbedBy?: string;     // NEW: if set, this is a TOMBSTONE — the cell at
                           // this grid position is covered by the cell whose
                           // id === absorbedBy in an earlier row of the band.
}
```

```go
type Cell struct {
    ID         string  `json:"id"`
    FieldKey   *string `json:"fieldKey"`
    Span       int     `json:"span"`
    RowSpan    int     `json:"rowSpan,omitempty"`    // default 1
    AbsorbedBy string  `json:"absorbedBy,omitempty"` // tombstone marker
}
```

**Tombstone model.** When a column is merged down `N` rows, the **top** cell
gets `rowSpan: N`; the cells directly below it (same column index, next `N-1`
rows) become **tombstones** — `{ fieldKey: null, absorbedBy: <topCellId> }`.
Tombstones keep the `rows[]` array rectangular so row/cell indices never
shift, and the renderer simply skips them (the tall cell's `grid-row: span N`
covers their grid track).

Worked example — 3-row band, left column "Description" merged through all 3:

```
Row 0: [ {id:c0, Description, span:33, rowSpan:3}, {id:c1, Estimate, span:33}, {id:c2, Owner, span:33} ]
Row 1: [ {id:c3, null, span:33, absorbedBy:c0},   {id:c4, null, span:33},     {id:c5, Notes, span:33} ]
Row 2: [ {id:c6, null, span:33, absorbedBy:c0},   {id:c7, PlannedStart},      {id:c8, DueDate} ]
```

**Why this shape (vs. a nested `band` object).** A true nested
`rows → bands → matrix` restructure is conceptually cleaner but is a breaking
change to every stored layout, the renderer, the runtime reader, and the
server validator — too large a blast radius for a feature at this stage.
`rowSpan` + tombstones preserve the flat `rows[]` shape: old layouts (no
`rowSpan`/`absorbedBy`) are valid untouched; the renderer extends to
`grid-row: span N`; the validator's rectangular check is a straightforward
per-band pass.

### 1.3 Geometry / rendering (`FormLayoutRenderer.tsx`)

The renderer currently emits one `flb-grid__Row` per `Row` with a horizontal
`grid-template-columns`. To support vertical spans it must render a **band**
(a maximal run of adjacent same-template rows that contains at least one
`rowSpan > 1`, OR just a single row when nothing is merged) as **one CSS grid**
with both columns and rows:

- `grid-template-columns`: from the band's shared template spans (unchanged
  maths).
- `grid-template-rows`: `repeat(<subRowCount>, minmax(72px, auto))`.
- Each **real** cell (non-tombstone) is placed with
  `grid-column` (its column track) and `grid-row: <r> / span <rowSpan>`.
- **Tombstone** cells render nothing (skipped) — the spanning cell above
  covers their track.

A band with no merges is the degenerate case: `subRowCount === 1`, every cell
`rowSpan: 1` — visually identical to today.

`renderCell` signature gains nothing required; callers that need to know a
cell is tall can read `cell.rowSpan`. The renderer must expose enough for the
builder to place **join handles in empty seams** and a **split handle on tall
cells** — done via a new optional render prop:

```ts
renderSeamJoin?: (args: { bandIndex; colIndex; topAddr; bottomAddr }) => ReactNode;
// The builder returns null from this unless the LOWER cell (bottomAddr) is
// empty — so handles only appear on mergeable seams (§1.1).
// (split handle is rendered inside renderCell by the builder, keyed on cell.rowSpan>1)
```

This keeps the renderer geometry-only (per its existing contract) — the
builder owns the interactive chrome.

### 1.4 State engine (`useFormBuilderState.ts`)

New pure transitions (no dnd, no fetch — consistent with the existing engine):

- `mergeDown(addr: CellAddr)` — fuse the cell at `addr` with the cell directly
  below it (same column). Pre-conditions (all enforced, no-op if violated):
  the two rows share a template; **the cell below is empty** (`fieldKey ==
  null` and not a tombstone); neither cell crosses a different band boundary.
  Effect: top cell `rowSpan += 1`, the empty cell below becomes a tombstone
  pointing at the top cell id. Because the lower cell is always empty
  (enforced by only rendering the seam handle on empty seams — §1.3), a merge
  never displaces a field; no bump-to-sidebar path exists.
- `splitCell(addr: CellAddr)` — un-fuse a tall cell: set its `rowSpan` back to
  `1` and convert its tombstones back into empty cells.
- Helpers: `bandsOf(rows)` (group adjacent same-template rows into bands +
  compute sub-row counts), `isTombstone(cell)`, `seamsFor(band)` (the list of
  mergeable column seams between each adjacent row pair in a band).

`collectPlacedKeys` already ignores `fieldKey === null`, so tombstones are
naturally excluded from the placed set — no change needed there.

Interaction model: **merge/split is click-driven, not drag-driven.** Join
handles (◇) and split handles (⊟) are buttons, not dnd targets — they don't
touch the `@dnd-kit` wiring at all. Dragging a placed field out of a tall cell
still works (it's a normal `cell` drag); doing so leaves an empty tall cell
which the author can split.

### 1.5 Server validation (`service.go`)

Extend `collectPlacedAndValidate` (the shared structural validator used by
both the publish and draft paths):

1. **Known template** — unchanged.
2. **Cell count per row** — unchanged (`len(row.Cells) == len(spans)`).
3. **NEW — rowSpan sanity:** `rowSpan >= 1`; a cell with `rowSpan > 1` must
   have exactly `rowSpan - 1` tombstones directly beneath it in the same
   column, each `absorbedBy` pointing at its id, and all within rows that
   share the cell's template. A tombstone must have `fieldKey == nil`.
4. **NEW — rectangular band:** for each band, every column's spans cover the
   identical sub-row count (no ragged bottom). Reject with `ErrBadTemplate`
   (extend its `Reason`) otherwise.

Field-key validation (`validateFieldKey`) and the compulsory-field gate are
unchanged — tombstones carry no key so they're skipped, and a merged field is
still "placed" exactly once (the top cell), so the gate counts it correctly.

### 1.6 Runtime reader (`FormLayoutRuntime.tsx`)

The runtime renders saved layouts through the **same** `FormLayoutRenderer`,
so it inherits band geometry for free. Two touch-ups:
- `placedKeys` / carried-field computation must skip tombstones (they already
  skip `fieldKey === null`, so this is automatic — verify with a test).
- A tall field cell renders one input that visually occupies the band height
  (e.g. a richtext "Notes" beside several short fields) — the CSS
  `grid-row: span N` handles it; the input just fills its cell.

## 2. Sidebar (field picker) restyle

### 2.1 Structure (matches reference)

- **Search box** at the top — `Search fields` placeholder, filters both groups
  by label (case-insensitive substring). Client-only; no API change.
- **MANDATORY FIELDS** group — hint "Must be placed to save". Each field is a
  card; once placed it shows the greyed/sunken state with `ON FORM` tag and a
  left accent bar.
- **AVAILABLE FIELDS** group — header carries a **count badge** of the number
  of not-yet-placed available fields. **Folds today's "Optional" + "Custom"
  into one list** (the data-type tag distinguishes them; custom fields still
  show their type). Each card: ⠿ grip (left), bold label, right-aligned
  data-type tag (`SELECT`, `DATE`, `RELATION`, `USER`, `COLOUR`, …).
- **Add custom field** button stays at the bottom of Available (unchanged
  behaviour; restyled to match).

This changes `Sidebar` in `FormBuilderShell.tsx` from three
`SidebarSection`s to two, plus a search input and a count badge. The
`mandatoryFields` / `optionalFields` / `customFields` partition becomes
`mandatoryFields` + `availableFields` (optional ∪ custom), filtered by the
search query.

### 2.2 Card styling (shared with canvas)

A new shared visual treatment, used by both the sidebar cards and the canvas
placed-cells so the two read as one system:

- Rounded card (`--radius-md`+), subtle shadow.
- **Left accent bar that follows the card's border radius** — i.e. a coloured
  `border-left` that inherits `border-radius` (curves along top-left /
  bottom-left), NOT a floating inset pill. (Explicit Rick correction.)
- Label (14px/600) + uppercase data-type meta (11px, subtle).
- ⠿ grip inside the card on the left (signals "drag me to a slot").

### 2.3 Numbered row markers (canvas gutter)

The canvas left gutter shows a **numbered marker per row** (`01`, `02`, …),
**top-anchored** to each row, with a **vertical line spanning the row's
height** — and for a merged band, the line spans the **full band height**.
This replaces / augments the current `flb-row-aside` drag/delete cluster:
- The ⠿ drag-reorder + × delete controls move to the **vertical centre** of
  the row/band (confirmed in brainstorm).
- Numbering is per visual row-slot; a band that fuses rows 02+03 still shows
  both 02 and 03 anchors (band occupies two slots). *(Open Q resolved →
  show both, faintly, so the row count stays legible.)*

## 3. CSS (`app/globals.css`, `flb-*` namespace)

New / changed selectors (root-block__Container_Child_leaf naming):
- `.flb-sidebar__Search`, `.flb-sidebar__Search_Input`
- `.flb-sidebar__Section_Count` (the badge)
- `.flb-fieldcard` family (shared sidebar+canvas card): `__Grip`, `__Main`,
  `__Label`, `__Meta`, accent-bar via `border-left` + `border-radius`.
- `.flb-gutter`, `.flb-gutter__Num`, `.flb-gutter__Line`
- `.flb-seam`, `.flb-seam__Join` (◇ button), `.flb-cell__Split` (⊟ button)
- `.flb-cell-tall` (the spanning cell)

No inline `style={{}}` except the dynamic `grid-template-columns` /
`grid-template-rows` / `grid-row` values, which are data-driven and already
the established exception in `FormLayoutRenderer`/`TemplateGlyph`.

## 4. Out of scope (YAGNI)

- Cross-template merge / partial-seam alignment.
- Horizontal cell merge (spanning columns) — only vertical was requested.
- Drag-to-merge — merge is click-driven via the seam handle.
- Persisting picker search state across sessions.

## 5. Testing

- **State engine (unit):** `mergeDown` produces correct `rowSpan` + tombstone;
  `splitCell` is its exact inverse; band detection groups adjacent
  same-template rows; merge is a no-op across template boundaries or when the
  lower cell is occupied (and `seamsFor` omits occupied-lower seams so no
  handle is offered).
- **Server (Go):** `collectPlacedAndValidate` accepts a valid band; rejects a
  ragged band, a tombstone with a fieldKey, a `rowSpan` that overruns the
  band, and a dangling `absorbedBy`. Compulsory-gate still counts a merged
  field exactly once.
- **Runtime:** a saved merged layout round-trips through the renderer; carried
  fields ignore tombstones.
- **Backwards-compat:** an old layout (no `rowSpan`/`absorbedBy`) loads,
  renders, and re-saves byte-stable.

## 6. Decisions resolved during brainstorm

| Question | Decision |
|---|---|
| Merge depth | Any number of stacked rows (2D rowSpan model) |
| Eligibility | Identical templates only |
| Repeat merge | Independent per-column |
| Un-merge | Split handle (⊟) on the tall cell, top-right |
| Block shape | Rectangular band, no ragged bottoms |
| Join handles | ◇ only on seams whose lower cell is empty |
| Lower cell occupied on merge | No handle shown — merge only offered on empty seams |
| Picker groups | Two: Mandatory + Available (Optional ∪ Custom) w/ count badge |
| Accent bar | border-left that follows the card radius |
| Row markers | Per-slot 01/02…, top-anchored, line spans band height |
