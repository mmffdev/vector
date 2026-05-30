# `<DataGrid>` — scaffold + page-owned sidecar

A lightweight, configurable replacement for `<ObjectTreeV2>`'s grid surface. The scaffold owns **only** the universal chrome (title bars, action bar, header row, body rows, pagination) and two pluggable mechanics (column management, row flyout). Everything dataset-specific — columns, fetch, flyout body, row menu, actions — lives in a **page-owned sidecar config**.

> **The firewall this design enforces:** editing one page's sidecar **cannot** affect another page's grid. Sidecars live next to their pages, not next to the scaffold. The scaffold is page-blind.

---

## TL;DR

- One scaffold (`app/components/DataGrid/`), one config per page (`app/(user)/<page>/p_<page>_dataGridConfig.tsx`).
- Scaffold reads the config, the config decides everything. Scaffold has zero `if (page === …)` branching anywhere.
- A row flyout is a **DOM sibling** of the clicked row — pushes the grid taller in flow, no internal scroller.
- Forms inside flyouts can be hand-written JSX OR a declarative `FormSpec` consumed by `<FormRenderer>`.
- Column resize uses the neighbour-absorbs-then-flex algorithm ported wholesale from [`ResourceTree.tsx`](../app/components/ResourceTree.tsx) — drag the gutter, neighbour shrinks first, flex column absorbs spill, total width stays constant.

---

## Why this exists

`<ObjectTreeV2>` is universally used today across work-items, portfolio, risks, value-sprint, custom-fields, and several admin surfaces. The accumulated wound: page-specific behaviour got wired **into** the OTV2 component itself, so editing it for page A silently changed pages B–F. The canonical regression — value-sprint added "hide child expanders" inline → work-items lost child expanders too — is the failure mode this design closes.

The fix is not "rebuild OTV2 cleaner." It is **invert the ownership model**: the scaffold owns universals, every page owns a sidecar, the scaffold never branches on which page it serves.

---

## File layout

```
app/components/DataGrid/                       ← THE SCAFFOLD
├── p_DataGrid.tsx                             ← entry component; consumes a DataGridConfig
├── types.ts                                   ← public type contract
├── useColumnManager.ts                        ← widths + sort + drag-resize
├── useRowFlyout.ts                            ← single-flyout open/close state
├── formSpec.ts                                ← declarative form vocabulary
└── FormRenderer.tsx                           ← renders a FormSpec inside any flyout

app/(user)/<page>/                             ← THE SIDECAR (one per page)
├── page.tsx                                   ← <DataGrid config={…} />
└── p_<page>_dataGridConfig.tsx                ← columns, fetch, flyout body, actions
```

The rule is mechanical: to break work-items, you must physically edit a file inside `app/(user)/work-items/`. The scaffold under `app/components/DataGrid/` cannot affect work-items because work-items' sidecar is the only file that hands it page-specific behaviour. Other pages do the same in their own directories.

---

## The scaffold's visible shape

```
┌────────────────────────────────────────────────────────────────┐
│ TitleBar        Title text                          [?]        │  ← config.title + helper
│                 description (optional)                          │
├────────────────────────────────────────────────────────────────┤
│ DataBar         [██] SubTitle                                  │  ← config.identBlockText
│                      sub-title description (optional)           │     + config.subTitle
├────────────────────────────────────────────────────────────────┤
│ ActionBar       [+ Create New]  [🔍 Search…]  [Type][Status]…  │  ← config.createAction
│                                                                │     + config.filters
├────────────────────────────────────────────────────────────────┤
│ Grid HeaderRow   ID    SUMMARY  STATUS  PTS  OWNER  PARENT     │  ← config.columns
├────────────────────────────────────────────────────────────────┤
│ Body Row 1                                                     │
│ Body Row 2                                                     │
│ ▼ Body Row 3 (open)                                            │  ← clicked row
│ ┌──────────────────────────────────────────────────────────┐  │  ← flyout sibling
│ │  Form / dataset / chart — whatever the sidecar returns    │  │     (config.rowFlyout)
│ └──────────────────────────────────────────────────────────┘  │
│ Body Row 4 (pushed down)                                       │
│ Body Row 5                                                     │
├────────────────────────────────────────────────────────────────┤
│ Pagination      1–14 of 14                  10 [25] 50 100     │  ← config.pageSizeOptions
└────────────────────────────────────────────────────────────────┘
```

**Critical property:** when the flyout opens, the grid grows taller — pagination shifts down with it, no scrollbar appears inside the grid. The flyout has no `overflow`, no `max-height`. It's a plain flow-block sibling.

---

## The sidecar contract

A single object passed to `<DataGrid>`:

```ts
import type { DataGridConfig } from "@/app/components/DataGrid/types";

export const myPageGridConfig: DataGridConfig<MyRow> = {
  id: "my-page-grid",

  // Chrome — what the title bars + data bar render
  title:               "My page",
  titleDescription:    "Optional muted text below the title.",
  subTitle:            "Dense grid",
  subTitleDescription: "Spreadsheet-fast. 28px rows.",
  identBlockText:      "05",
  searchPlaceholder:   "Search…",

  // Data shape — required
  columns:   [/* DataGridColumn<MyRow>[] */],
  rowIdOf:   (row) => row.id,
  fetchRows: async ({ page, pageSize, sort, search }) => ({ rows: [...], total: N }),

  // Pagination — optional, defaults [10, 25, 50, 100] / 25
  pageSizeOptions: [10, 25, 50, 100],
  defaultPageSize: 25,
  defaultSort:     null,

  // Row flyout — OPTIONAL. Off if absent.
  rowFlyout: {
    fetchDetail: (rowId) => apiSite.get(`/my-resource/${rowId}`),
    renderBody:  ({ data, mode, rowId, ctx }) => <MyFlyoutBody … />,
    renderLoading: () => <p>Loading…</p>,
    renderError:   (e) => <p>Failed: {String(e)}</p>,
  },

  // Row gear menu — OPTIONAL.
  rowMenu: [
    { id: "view",      label: "View",      onClick: (row, ctx) => ctx.openFlyout("view") },
    { id: "duplicate", label: "Duplicate", onClick: (row, ctx) => ctx.openFlyout("duplicate") },
    { id: "delete",    label: "Delete",    onClick: (row, ctx) => ctx.openFlyout("delete") },
  ],

  // Create + filter buttons — OPTIONAL.
  createAction: { label: "Create New", onClick: (ctx) => /* open create wizard */ },
  filters:      [{ id: "status", label: "Status", icon: <…/>, onClick: () => /* open filter */ }],
};
```

Full type definitions: [`app/components/DataGrid/types.ts`](../app/components/DataGrid/types.ts).

### The opt-in rule (non-negotiable)

Every feature beyond the chrome + grid skeleton is **optional with safe-default-off semantics**. Adding a new feature to the scaffold means:

1. New property goes onto `DataGridConfig` as `?` optional.
2. Absence = behaviour off. Existing sidecars continue to work unchanged.
3. Pages opt in by adding the property.

This rule is what makes the firewall hold. A new `childExpander?` field on `DataGridConfig` cannot affect a page that doesn't supply it.

---

## The two pluggable mechanics

### Column manager — `useColumnManager`

Owns column widths and sort. Ported from [`ResourceTree.tsx`](../app/components/ResourceTree.tsx) lines 507–672. Battle-tested across OTV1 and OTV2.

**Width model:**
- Each column has a `defaultWidth: number | null`. `null` marks the single flex column that absorbs leftover space.
- On mount + on container resize (`ResizeObserver`), widths are fit via `fitToContainer(defaults, containerWidth)`: fixed columns hold their declared px; the flex column gets `max(MIN_FLEX_WIDTH, containerWidth − sum(fixed))`.

**Drag-resize semantics:**
- Drag column[i]'s right-edge gutter → mouse delta is applied as: take from neighbour[i+1]'s slack first; when neighbour pinned at `MIN_FIXED_WIDTH`, spill into the flex column.
- Total grid width stays constant — there is no horizontal scrollbar, ever.
- During drag, widths are mutated **directly on the DOM** (`headerRowRef.style.gridTemplateColumns = …`, same for every body row via the registry). React state is committed once on `mouseup`. This is the 60fps trick the original ResourceTree uses.

**Double-click reset:**
- Fixed column: snap to declared default; refund the delta to the flex column.
- Flex column: refit the whole layout to current container width.

**Sort:**
- Header click on a sortable column cycles `none → asc → desc → none`.
- Resize gutter has `stopPropagation` on click so dragging doesn't fire a sort.

Min widths: `60px` fixed, `260px` flex.

### Row flyout — `useRowFlyout`

Owns single-flyout open/close. At most one row is open at a time across the whole grid.

**Open state:** `{ rowId: string, mode: "view" | "duplicate" | "delete" } | null`.

**Triggers:**
- Whole-row click → `openFor(rowId, "view")`.
- Row gear menu item → `openFor(rowId, mode)`.
- Re-clicking the same row+mode → toggle close.
- Opening a different row → closes the prior flyout, opens the new one.

**Mounting:**
- The flyout is a **DOM sibling** of the row inside a `<Fragment>`, NOT a child. This is why clicks inside the flyout body don't bubble back to the row's `onClick`.
- One fetch per `rowId`, cached. Switching `mode` on the open row does NOT re-fetch — fetched data is shared across all modes. (Convention: consumer keys the flyout body by `rowId`, not `${rowId}:${mode}`, so React doesn't unmount on mode change.)

**Closing affordances:**
- `ctx.close()` exposed to the flyout body so it can dismiss itself (after save, cancel, confirm-delete, etc.).
- `ctx.switchMode(mode)` exposed so a confirm screen can flip back to view without closing.

---

## What goes inside a flyout — two patterns

### Pattern A — hand-written JSX

Simplest. The sidecar's `renderBody` returns any React element it wants. Use this for one-off shapes (a related-data dashboard, a chart, a multi-section dataset panel).

```ts
rowFlyout: {
  fetchDetail: (rowId) => Promise.all([
    apiSite.get(`/risks/${rowId}`),
    apiSite.get(`/risks/${rowId}/dependents`),
  ]).then(([risk, deps]) => ({ risk, deps })),
  renderBody: ({ data }) => {
    const { risk, deps } = data as RiskDetail;
    return (
      <>
        <RiskHeader risk={risk} />
        <DependentsTable rows={deps} />
      </>
    );
  },
}
```

### Pattern B — declarative `FormSpec` consumed by `<FormRenderer>`

Used when the flyout is a form. Replicates OTV2's `ArtefactInlineForm` shape from a single declarative object — head band (with banner colours), action toolbar (with confirm-arm flow), 1- or 2-column body, footer.

```ts
import { FormRenderer } from "@/app/components/DataGrid/FormRenderer";
import type { FormSpec } from "@/app/components/DataGrid/formSpec";

const formSpec: FormSpec = {
  title: (v) => `${v.id} — ${v.title}`,
  bannerFromValue: (v) => (v.is_duplicate ? "duplicate" : null),

  actions: [
    { id: "duplicate", label: "Duplicate", onClick: ({ close }) => { /* clone */ close(); } },
    { id: "delete",    label: "Delete", danger: true, confirm: true,
      onClick: ({ close }) => { /* delete */ close(); } },
  ],

  layout: {
    columns: [
      { id: "left",  sections: [{ id: "main", fields: [
        { id: "title", kind: "text", label: "Title", liveCommit: true },
        { id: "description", kind: "textarea", label: "Description", rows: 5 },
      ]}]},
      { id: "right", sections: [{ id: "meta", fields: [
        { id: "owner_id", kind: "select", label: "Owner", options: OWNER_OPTIONS },
        { id: "is_blocked", kind: "toggle", label: "Blocked",
          renderExtra: (v, onChange) => <input value={v.blocked_reason} … /> },
      ]}]},
    ],
  },

  footer: { label: "Finished", onClick: ({ close }) => close() },
};

// In the sidecar:
rowFlyout: {
  fetchDetail,
  renderBody: ({ data, ctx }) => (
    <FormRenderer spec={formSpec} initial={data} onClose={ctx.close} onChange={…} />
  ),
}
```

**Field vocabulary (FormSpec):**
- `text`, `textarea`, `number` — each supports `liveCommit?: boolean` (default false = blur-commit; true = every-keystroke for live-bound consumers like an accessor-driven header title).
- `select` — flat `options` or grouped `groups` (optgroup).
- `toggle` — checkbox with optional `renderExtra` (e.g. a "Reason" input when on).
- `static` — read-only render function over the current value.
- `custom` — escape hatch; render whatever, with `(value, onChange) => ReactNode`.

**Action vocabulary:**
- `danger: true` styles the button red.
- `confirm: true` wires the OTV2 two-state confirm flow: first click ARMS, toolbar replaces with `[Cancel] [Confirm <label>]`, head band goes red, second click on Confirm fires `onClick`.
- `hidden: (value) => boolean` derives per-row visibility (e.g. "Add Tasks" only on `US-` / `DE-` types).

**Banner states:**
- `bannerFromValue(value)` decides the head band tint: `null` = neutral, `"duplicate"` = amber, `"deleting"` = red.
- Armed-confirm-on-danger-action overrides to `"deleting"` for the duration of the confirm.

Full vocabulary: [`app/components/DataGrid/formSpec.ts`](../app/components/DataGrid/formSpec.ts).

---

## CSS naming chain

The scaffold follows the project's `root-block__Container_Child_leaf` convention ([`.claude/memory/css_naming_convention.md`](../.claude/memory/css_naming_convention.md)):

```
.data-grid

.data-grid__TitleBar
.data-grid__TitleBar_Heading
.data-grid__TitleBar_Heading_Title
.data-grid__TitleBar_Heading_Description
.data-grid__TitleBar_HelperBtn

.data-grid__DataBar
.data-grid__DataBar_Ident
.data-grid__DataBar_Heading
.data-grid__DataBar_Heading_Title
.data-grid__DataBar_Heading_Description

.data-grid__ActionBar
.data-grid__ActionBar_CreateBtn
.data-grid__ActionBar_Search
.data-grid__ActionBar_Search_Icon
.data-grid__ActionBar_Search_Input
.data-grid__ActionBar_Filters
.data-grid__ActionBar_Filters_Btn
.data-grid__ActionBar_Filters_Clear

.data-grid__Grid
.data-grid__Grid_HeaderRow
.data-grid__Grid_HeaderRow_Cell
.data-grid__Grid_HeaderRow_Cell_Label
.data-grid__Grid_HeaderRow_Cell_SortCaret
.data-grid__Grid_HeaderRow_Cell_ResizeHandle
.data-grid__Grid_Body
.data-grid__Grid_Body_Row
.data-grid__Grid_Body_Row-open                ← modifier
.data-grid__Grid_Body_Row_Cell
.data-grid__Grid_Body_Row_Menu
.data-grid__Grid_Body_Row_Menu_Trigger
.data-grid__Grid_Body_Row_Menu_List
.data-grid__Grid_Body_Row_Menu_List_Item
.data-grid__Grid_Body_Flyout
.data-grid__Grid_Body_Flyout_Inner

.data-grid__Pagination
.data-grid__Pagination_Range
.data-grid__Pagination_PageSizes
.data-grid__Pagination_PageSizes_Btn
.data-grid__Pagination_PageSizes_Btn-active   ← modifier
```

Form layer (only loaded when a sidecar mounts `<FormRenderer>`):

```
.data-grid__form
.data-grid__form_Head
.data-grid__form_Head-duplicate               ← banner modifier (amber)
.data-grid__form_Head-deleting                ← banner modifier (red)
.data-grid__form_Head_Title
.data-grid__form_Actionbar
.data-grid__form_Actionbar_Btn
.data-grid__form_Actionbar_Btn-danger         ← modifier
.data-grid__form_Actionbar_Btn-confirm        ← modifier (red fill, white text)
.data-grid__form_Actionbar_Spacer
.data-grid__form_Cols                         ← data-columns="1" or "2"
.data-grid__form_Cols_Col
.data-grid__form_Section
.data-grid__form_Section_Label
.data-grid__form_Field
.data-grid__form_Field_Label
.data-grid__form_Field_Label_Hint
.data-grid__form_Field_Input
.data-grid__form_Field_Input-textarea
.data-grid__form_Field_Static
.data-grid__form_Field_Stub
.data-grid__form_Toggle
.data-grid__form_Hierarchy
.data-grid__form_Hierarchy_Parent
.data-grid__form_Hierarchy_Selected
.data-grid__form_Footer
.data-grid__form_Footer_Btn
.data-grid__form_Footer_Btn-primary           ← modifier
```

Page-owned cell helpers live in the same namespace under `data-grid__cell_…` (e.g. `data-grid__cell_typeBadge`, `data-grid__cell_statusPills_pill`). They're declared next to the work-items / scope sidecar styles in [`app/globals.css`](../app/globals.css) for proximity but stay anchored to the scaffold's root block.

Strip-last-segment rule holds end-to-end: `…__DataBar_Heading_Description` → `…__DataBar_Heading` → `…__DataBar` → `data-grid`.

---

## State model summary

| Concern | Owner | Storage |
|---|---|---|
| Column widths | `useColumnManager` | `useState<number[]>`, DOM-mutated during drag |
| Column sort | `useColumnManager` | `useState<SortState \| null>` |
| Flyout open row + mode | `useRowFlyout` | `useState<FlyoutOpen \| null>` |
| Row detail fetch cache | `p_DataGrid` | `useState<Record<rowId, unknown>>` |
| Page + page size + search | `p_DataGrid` | three `useState` |
| Form draft values | `FormRenderer` | `useState<Record<string, unknown>>` |
| Form armed-confirm action | `FormRenderer` | `useState<string \| null>` |
| Form banner override | `FormRenderer` | `useState<FormBanner>` |

All state is **uncontrolled by default**. Hooks expose optional `value` / `onChange` for controlled mode when persistence is wanted (e.g. saving column widths into a saved-view).

---

## What this design deliberately does NOT do

Named so the gaps are intentional, not omissions:

- **No internal scrollbars** — the grid grows in flow; the page is the scroller.
- **No virtualisation** — paginate via the config; out-of-scope for the scaffold.
- **No persistence layer** — the scaffold is in-memory only. Saved views hook into the controlled-mode props on the hooks; the saved-views substrate lives at [`docs/superpowers/specs/2026-05-28-saved-views-design.md`](superpowers/specs/2026-05-28-saved-views-design.md).
- **No drag-and-drop reorder** — opt-in for a future hook (`useRowReorder`), following the same opt-in rule. Default off, no scaffold change.
- **No tree / expander rows** — opt-in for a future hook (`useChildExpander`). This is **the** regression the design exists to prevent: if value-sprint doesn't supply `childExpander`, it gets no expanders. Adding the field to work-items' config cannot affect value-sprint.
- **No multi-select** — opt-in for a future hook (`useRowSelection`).
- **No global "outside click closes flyout"** — flyouts close only on toggle, footer button, or `ctx.close()`. OTV2's outside-click pattern is available in [`ObjectTreeDetailFlyout.tsx`](../app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout.tsx) for reference if a page later wants it.

---

## Comparison with `<ObjectTreeV2>`

| Concern | OTV2 today | DataGrid |
|---|---|---|
| Configurability source | JSON wizard sidecars (`p_wizard_*.json`) in OTV2's directory | TSX sidecar in **the consuming page's** directory |
| Page-A edit affecting Page B | Possible (configs colocated; behaviour wired into the component) | Impossible (configs colocated with pages; scaffold is page-blind) |
| Adding a new feature | Edit OTV2 + add wizard fields + guard against contamination | Add optional prop to `DataGridConfig`; opt in per sidecar |
| Form body | `ArtefactInlineForm` (bespoke 558-LOC component, hand-coded) | `<FormRenderer spec={…} />` (declarative spec, ~270-LOC renderer reused across all forms) |
| Column resize | Per-grid implementation | Single hook ported from `ResourceTree` |
| Row flyout open/close | Per-grid imperative state | Single hook |
| Tree expand | Built-in | Opt-in hook (not yet built — adds when first needed) |

Production /work-items continues to use OTV2 + ArtefactInlineForm. DataGrid is currently only mounted at `/scope` for PoC. Graduation path is per-page: each page authors its own sidecar config when ready.

---

## When you'd reach for DataGrid

- New page that needs a tabular surface and **doesn't** need tree expanders / multi-level rows.
- An existing OTV2 surface whose behaviour has diverged so far that it'd cleaner to author a fresh sidecar than patch around the shared OTV2 quirks.
- A flyout surface that wants a form: `<FormRenderer>` + a `FormSpec` is one declarative object.

## When you'd stay on OTV2

- Surfaces that need tree expanders (work-items hierarchy, portfolio drill, risk dependencies). The expander hook is on the roadmap but not built yet.
- Surfaces tightly coupled to ArtefactInlineForm's specific hooks (`useArtefactInline`, `useParentCandidates`, custom-field hydration) — until those mechanics are reproduced in DataGrid's adapter surface.

---

## Quick reference

| Need to… | Touch this |
|---|---|
| Add / remove a column | sidecar `columns` array |
| Change fetch endpoint | sidecar `fetchRows` |
| Add a row action (Duplicate / Delete / Archive) | sidecar `rowMenu` array |
| Change flyout content | sidecar `rowFlyout.renderBody` |
| Add a field to the inline form | spec's `layout.columns[i].sections[j].fields` array |
| Change the danger-confirm flow | flag a `FormAction` with `confirm: true` + `danger: true` |
| Make the head-band title live-update | spec field `liveCommit: true` |
| Persist column widths to a saved view | wire controlled-mode `value`/`onChange` on `useColumnManager` |
| Add a feature shared across pages | add OPTIONAL field to `DataGridConfig` → page sidecars opt in |
| Fix a bug in the scaffold | edit `app/components/DataGrid/…` — confirm it doesn't introduce page-coupled behaviour |
