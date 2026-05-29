# ObjectTreeV2 — Inline Flyouts (Create + Row-Detail)

**Date:** 2026-05-29
**Scope:** `app/components/ObjectTreeV2/p_ObjectTree.tsx`, `app/components/ResourceTree.tsx`, `app/globals.css`
**Touches both routes:** WorkItem mounts (work-items, value-sprint, value-sprint-review, portfolio-items, risks) and adapter mounts (custom-fields and any future catalogue).

## Problem

Both ObjectTreeV2 flyouts (the row-detail / edit flyout, and the create flyout) currently render OUTSIDE the table grid. The row-detail flyout for the WorkItem route renders as a sibling AFTER `<Panel>` ([p_ObjectTree.tsx:2273](../../app/components/ObjectTreeV2/p_ObjectTree.tsx#L2273), [p_ObjectTree.tsx:2280](../../app/components/ObjectTreeV2/p_ObjectTree.tsx#L2280)). The create flyout renders INSIDE the panel but ABOVE the grid ([p_ObjectTree.tsx:2131](../../app/components/ObjectTreeV2/p_ObjectTree.tsx#L2131)). Combined with the `<ResourceTree>`'s inner scroll container, the flyouts either compete with the page scroll or sit visually disconnected from the row they describe.

The adapter route (CustomFields) already does the right thing for row-detail: it renders inline as a `<tr class="tree_accordion-dense__row-detail">` directly under the clicked row, via ResourceTree's `renderRowDetail` slot ([ResourceTree.tsx:1683-1701](../../app/components/ResourceTree.tsx#L1683-L1701)), with `disableInnerScroll: true` so the panel grows rather than scrolling. We are asymmetric — WorkItem grids don't get that treatment.

## Goal

Both flyouts render INSIDE the `<ResourceTree>` table, as `<tr>` rows with a single `colSpan` cell:

- **Create flyout** → first `<tbody>` row, above the first data row, below `<thead>`.
- **Row-detail / edit flyout** → directly under the selected row.

Opening either flyout pushes the rest of the grid + pagination down. No inner scrollbar. Flyout title bars have no top border-radius. No visual gap between the row above and the flyout's title bar; no gap between the flyout's bottom edge and the next row (or the pagination row when the flyout sits under the last data row).

## Non-goals

- The `ObjectTreeDetailFlyout` component itself is not refactored. Its public surface (`openId`, `Body`, `onClose`, `onSaved`, `bodyProps`) stays the same. We change WHERE its output is rendered, not its body.
- The adapter's `renderRowFlyout` / `renderCreateFlyout` callback signatures are unchanged.
- The create-action wiring through the ActionBar is unchanged.
- Animation curves and timings stay as-is (`220ms cubic-bezier(0.22, 1, 0.36, 1)`).
- Pagination position/layout is unchanged.

## Design

### Wire contract

```
<table>
  <thead>...</thead>
  <tbody>
    ┌── renderCreateRow? → <tr.row-create> [colSpan]   ── create flyout (when open)
    │
    ├── data row 1
    ├── renderRowDetail(row1)? → <tr.row-detail> [colSpan]   ── flyout for row 1 (when open)
    ├── data row 2
    ├── renderRowDetail(row2)? → <tr.row-detail> [colSpan]   ── flyout for row 2 (when open)
    │   ...
    └── pagination (unchanged)
  </tbody>
</table>
```

Only one row-detail can be open at a time (existing single-open behaviour preserved). Create can co-exist with a row-detail open (existing behaviour preserved).

Both flyout `<tr>`s use `colSpan={columns.length + leadOffset}`. The row-detail mechanism already does this; the create row mirrors it.

### Change 1 — Move WorkItem detail flyout to inline `<tr>`

**File:** [p_ObjectTree.tsx](../../app/components/ObjectTreeV2/p_ObjectTree.tsx)

Currently `renderAdapterRowDetail` (line 2104) only fires when an adapter is mounted. Generalise it: when no adapter is mounted (the WorkItem route), the same callback returns the `inlineFormNode` IFF `openInlineFormId === row.id`.

Effectively the callback becomes a single source of truth:

```
renderRowDetailForRow = (row) => {
  if (adapter?.renderRowFlyout) {
    if (flyoutRowId !== row.id) return null;
    return adapter.renderRowFlyout(row as T, { onClose, onSaved });
  }
  // WorkItem route
  if (openInlineFormId !== row.id) return null;
  return inlineFormNode;  // already wraps ArtefactInlineForm via ObjectTreeDetailFlyout
}
```

Wire to `<ResourceTree>` as `renderRowDetail` for both routes. Pair with `disableInnerScroll: true` for both routes (the WorkItem route currently does not set it).

Remove the two `{inlineFormNode}` sibling-renders at lines 2273 and 2280.

### Change 2 — Move create flyout to inline `<tr>` as first table row

**File:** [ResourceTree.tsx](../../app/components/ResourceTree.tsx)

Add new optional prop:

```ts
renderCreateRow?: () => React.ReactNode | null;
```

When set and returning non-null, ResourceTree injects a `<tr class="tree_accordion-dense__row-create">` as the FIRST tbody row, before `renderRows(...)`. Single `<td>` with `colSpan={columns.length + leadOffset}`, `onClick={(e) => e.stopPropagation()}` (mirrors row-detail cell).

**File:** [p_ObjectTree.tsx](../../app/components/ObjectTreeV2/p_ObjectTree.tsx)

When the host opens a create flow:

```
renderCreateRow = () => {
  if (adapter?.renderCreateFlyout && createFlyoutOpen) {
    return adapter.renderCreateFlyout({ onClose, onCreated });
  }
  if (!adapter && createFlyoutOpen) {
    return createFlyoutNode;  // existing WorkItem create flyout JSX
  }
  return null;
}
```

Remove `{adapterCreateFlyoutNode}` and `{createFlyoutNode}` from the `inner` JSX block (lines 2131-2132).

### Change 3 — CSS tightening

**File:** [app/globals.css](../../app/globals.css)

#### 3a. Title bar — kill top radius, full-bleed

The two title-bar classes:

- `.tree_accordion-dense__createflyout-head` (line 13541) — already uses negative margin trick for full-bleed; just ensure no `border-radius` on top corners.
- `.artefact-inline-form__Container_Head` ([ArtefactInlineForm.tsx:186](../../app/components/ArtefactInlineForm/ArtefactInlineForm.tsx#L186)) and its three colour-state modifiers (`--duplicate`, `--deleting`, base) — same rule.

```css
.tree_accordion-dense__createflyout-head,
.artefact-inline-form__Container_Head {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
```

#### 3b. Row-create / row-detail `<tr>` — flush to neighbours

Existing rule (line 14368-14374):

```css
.tree_accordion-dense__row-detail { background: var(--surface); }
.tree_accordion-dense__cell--row-detail {
  padding: 0 !important;
  border-bottom: 0 !important;
}
```

Extend with `border-top: 0 !important` and `padding-top: 0 !important` so the title bar's top edge sits flush against the row above. Add the equivalent rule for `.tree_accordion-dense__row-create` and `.tree_accordion-dense__cell--row-create`.

#### 3c. Animation preservation

The existing height transition (`grid-template-rows: 0fr → 1fr`) on `.tree_accordion-dense__createflyout` still applies because the same `<div>` is now nested inside a `<td>` instead of a panel sibling. The `<td>` will grow with its child. No `table-layout` rule changes are needed because the flyout `<tr>` has a single `colSpan` cell.

### Affected mounts (zero functional regression expected)

WorkItem route — `inlineFormNode` content is unchanged; only the parent DOM slot changes:
- `/work-items` ([app/(user)/work-items/page.tsx](../../app/(user)/work-items/page.tsx))
- `/risks` ([app/(user)/risks/page.tsx](../../app/(user)/risks/page.tsx))
- `/value-sprint` ([app/(user)/value-sprint/page.tsx](../../app/(user)/value-sprint/page.tsx))
- `/value-sprint-review` ([app/(user)/value-sprint-review/page.tsx](../../app/(user)/value-sprint-review/page.tsx))
- `/portfolio-items` ([app/(user)/portfolio-items/page.tsx](../../app/(user)/portfolio-items/page.tsx))

Adapter route — row-detail behaviour is unchanged; only the create flyout's slot changes:
- `/custom-fields/[id]` (via `customFieldsAdapter.tsx`)

## Risks & open questions (to verify during implementation)

1. **Sticky `<thead>`** — if `<thead>` is `position: sticky`, the create flyout sits flush under the sticky header on scroll. Likely desired UX. Confirm by reading the table CSS.
2. **Pagination row location** — pagination may be rendered inside the same `<tbody>` as a final `<tr>` (in which case the existing row-detail `border-bottom: 0` correctly handles flush-below). If pagination is rendered OUTSIDE the table, "no gap below the flyout when it's the last item selected" needs an additional flush-to-pagination rule on the panel container. Verify before touching CSS.
3. **Outside-click dismissal** — `ObjectTreeDetailFlyout` uses a root ref + outside-click logic. The wrapping element changes from a sibling `<div>` to a `<td>`. Confirm the outside-click detector still classifies row clicks vs flyout clicks correctly. The `e.stopPropagation()` on the row-detail/row-create cell preserves the existing semantics.
4. **`adapterCreateFlyoutNode` vs `createFlyoutNode` coexistence** — currently both render in `inner` (lines 2131-2132); in practice only one is wired per mount. The new `renderCreateRow` picks one based on adapter presence. The "both can be open" assumption is dead code today; we collapse to one explicit branch.
5. **WorkItem detail flyout colour states** (dark / amber-duplicate / red-delete-confirm) — driven by ArtefactInlineForm internal state. Moving the render slot doesn't affect this. Confirm the new `<td>` container doesn't add a background that fights the title bar (existing row-detail rule uses `var(--surface)` — same surface as the panel, neutral against title-bar surfaces).

## Testing

- Manual: open the create flyout on `/work-items` and `/custom-fields/[id]`. Open the row-detail flyout on each of the five WorkItem mounts. Confirm:
  - Title bar sits flush against the row above (or `<thead>` for create).
  - No gap above or below the flyout.
  - No top border-radius on title bar.
  - Opening pushes the rest of the grid + pagination down (panel grows; no inner scrollbar).
  - Duplicate (amber) and Delete-confirm (red) states render without visual artefacts.
  - Animation feels identical to current.
- Regression: existing adapter row-detail behaviour on `/custom-fields/[id]` should be visually identical.
- No new types of test files needed; this is a layout change.

## Out of scope

- Refactoring `ObjectTreeDetailFlyout` to be table-aware.
- Changing the inline form's body content, fields, or validation.
- Sticky-flyout behaviour on scroll (the flyout scrolls with the table; that's the desired UX).
- Mobile / narrow-viewport adjustments (none needed — the table already handles overflow on small screens via the column system).
