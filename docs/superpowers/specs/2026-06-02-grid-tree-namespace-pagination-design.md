# Grid__Tree namespace sweep + root pagination

**Date:** 2026-06-02
**Status:** Approved (design) — ready for implementation plan
**Surface:** `app/components/Grid/` (the headless-core + styled-skin tree primitive) and its sole consumer `app/(user)/scope/`.

## Problem

The `/scope` page renders the work-item hierarchy on the new Grid primitive. Two gaps against the intended contract — *"the tree owns its header (columns), data rows, and pagination"*:

1. **No pagination.** Roots load once via a hardcoded `{ limit: 200, offset: 0 }` and all render. The wire already returns `total` on the roots path, but `fetchScopeRoots` discards it. This does not scale and does not match the target structure.
2. **Inconsistent namespace.** The tree's owned members are split-brained in CSS and component naming: some are correctly `grid__Tree_*` (Caret, Cell, Row, ExpandAll, DragGrip), others are loose `grid__*` siblings of the root block (`grid__Head*`, `grid__Body`, `grid__Branch*`, `grid__Forms`). Per the project CSS convention (`root-block__Container_Child_leaf`), everything the `Grid__Tree` block owns should be `grid__Tree_*`.

## Target structure

```
DataContainer                         ← dumb frame (title/sub-section band, unchanged)
└─ Grid__Tree   <div class="grid">    ← the data-view; owns all its bands
   ├─ Grid__Tree_Head   .grid__Tree_Head           ← columns
   ├─ Grid__Tree_Rows   .grid__Tree_Rows           ← Grid__Tree_Branch recursion
   │  ├─ Grid__Tree_Branch  .grid__Tree_Branch
   │  │  ├─ Grid__Tree_Row  .grid__Tree_Row
   │  │  └─ Grid__Tree_Forms .grid__Tree_Forms      ← row flyout (renderRowDetail)
   │  └─ …
   └─ Grid__Tree_Pagination  .grid__Tree_Pagination ← NEW, third sibling
```

The **frame** (`DataContainer`) stays dumb. The **tree** (`Grid__Tree`) owns and renders all three of its bands — header, rows, pagination — as siblings inside its own `<div class="grid">`.

## Decisions (locked)

| Question | Decision |
|---|---|
| Pagination axis | **Roots only.** Children stay fully-loaded-on-expand (existing lazy machine untouched). |
| Page UX | **Append-default (`load more`) + page-jump.** |
| Jump semantics | **Jump replaces the window** (reset expansion + child caches, load that page fresh). Load-more appends + preserves expansion. |
| State home | **Folded into `useTree`** — the hook owns the paged root window. |
| Namespace sweep depth | **All tree-owned members** → `grid__Tree_*`. No loose `grid__*` leaves remain. |
| Pagination wiring | **Inside `Grid__Tree`, fed by `useTree`** (no new consumer props). |
| Page size | **100** (tunable per-consumer via `pageSize` option). |
| Sequencing | **Sweep first** (pure rename commit), **then pagination** (logic commit). |

---

## Part 1 — Namespace sweep (no behaviour change)

Pure rename across three planes. Behaviour identical. Self-contained: only `GridExecution.tsx` consumes the family externally (`GridTree` + `GridForms`); all other references are internal cross-refs within `Grid/` (confirmed by grep — the FlowBoard / ObjectTreeV2 `GridHeader`-ish names are unrelated namesakes).

### Files (`git mv` — preserve history)

| Today | → |
|---|---|
| `Grid__Head.tsx` | `Grid__Tree_Head.tsx` |
| `Grid__Branch.tsx` | `Grid__Tree_Branch.tsx` |
| `Grid__Row.tsx` | `Grid__Tree_Row.tsx` |
| `Grid__Forms.tsx` | `Grid__Tree_Forms.tsx` |

`Grid__Tree.tsx`, `useTree.ts`, `types.ts`, `useColumnManager.ts` keep their names.

### Component identifiers

`GridHead→GridTreeHead`, `GridBranch→GridTreeBranch`, `GridRow→GridTreeRow`, `GridForms→GridTreeForms`. `GridTree` unchanged.

### CSS classes (`app/globals.css` + every `className` string)

| Today | → |
|---|---|
| `grid__Body` | `grid__Tree_Rows` |
| `grid__Head`, `grid__Head_Cell`, `grid__Head_Label`, `grid__Head_Lead`, `grid__Head_Resize`, `grid__Head_SortGlyph` | `grid__Tree_Head*` (same leaves) |
| `grid__Branch`, `grid__Branch_Children`, `grid__Branch_Detail` | `grid__Tree_Branch*` (same leaves) |
| `grid__Forms` | `grid__Tree_Forms` |

Already correct, untouched: `grid__Tree_Caret`, `grid__Tree_CaretGlyph`, `grid__Tree_CaretSpacer`, `grid__Tree_Cell`, `grid__Tree_DragGrip`, `grid__Tree_ExpandAll`, `grid__Tree_ExpandAllGlyph`, `grid__Tree_Row`.

### Import sites

- `GridExecution.tsx` — external: `GridForms→GridTreeForms` import + JSX.
- Internal cross-refs within `Grid/` (Grid__Tree imports Head/Branch; Branch imports Row).

### Commit discipline

The `git mv` renames pre-stage entries. Per the **INSPECT-INDEX hard rule**, run `git diff --cached --stat` and read it in full before committing; unstage anything beyond the sweep. The sweep is **its own commit**, behaviour-neutral, easy to review/revert.

---

## Part 2 — Root pagination folded into `useTree`

### Signature change

`useTree(roots, opts)` → `useTree(opts)`. The hook stops receiving roots as a prop and **owns the paged root window**.

### New options

```ts
fetchRoots: (page: { limit: number; offset: number })
  => Promise<{ rows: TRow[]; total: number }>;
pageSize?: number; // default 100
```

`fetchScopeRoots` is adjusted to return `{ rows, total }` (surfacing the `total` already on the wire that it currently discards).

### New internal state

`roots: TRow[]` (the accumulated/replaced window), `offset: number`, `total: number`, `rootsLoading: boolean`. The hook self-loads page 0 on mount (replacing `GridExecution`'s `loadRoots` effect).

### New actions (`UseTreeResult`)

- **`loadMore()`** — fetches the next window `{ limit: pageSize, offset: loadedCount }`, **appends** rows to `roots`. Preserves all expansion + child caches.
- **`jumpToPage(n)`** — calls the existing `reset()` (drops expansion + child caches), sets `offset = n × pageSize`, fetches `{ limit: pageSize, offset }`, **replaces** `roots` with that single page.
- **`refresh()`** — re-load from offset 0 with a reset. Replaces `GridExecution.refreshAfterMutation`'s `reset()` + `loadRoots()` pair.

### New derived values (exposed)

`total`, `loadedCount` (= `roots.length`), `pageSize`, `hasMore` (= `loadedCount < total`), `currentPage` (= `offset / pageSize`; meaningful right after a jump), `rootsLoading`.

### Consumer simplification (`GridExecution`)

- Delete the `roots` `useState` and `loadRoots` `useCallback`/effect.
- `useTreeScope` passes `fetchRoots: fetchScopeRoots` and `pageSize: 100` into `useTree`.
- `refreshAfterMutation` → `tree.refresh()`.

---

## Part 3 — `Grid__Tree_Pagination` (new band)

Presentational component, rendered as the **third sibling** inside `<div class="grid">`, after `Grid__Tree_Rows`. Reads off the `tree` result `Grid__Tree` already holds — **no new props from the consumer**.

Layout:
- **Left** — "Showing {loadedCount} of {total}".
- **Centre** — `[Load more]` `<button>`; disabled when `!hasMore`; barber-pole while `rootsLoading`.
- **Right** — page-jump: `‹ Page {currentPage+1} of {ceil(total/pageSize)} ›` with prev/next buttons + a direct page-number input → `jumpToPage(n)`.

**Accessibility (WCAG 2.2 AA, per `docs/c_accessibility.md`):** real `<button>` elements, `aria-label`s on prev/next, the jump input has an associated label, target sizes met, visible focus.

New CSS lives under `grid__Tree_Pagination*` in `app/globals.css`.

---

## Testing

`useTree` tests gain:
- Page-0 self-load on mount.
- `loadMore` appends the next window **and preserves expansion** of already-expanded roots.
- `jumpToPage` resets expansion/child caches **and replaces** the window.
- `hasMore` / `total` / `loadedCount` / `currentPage` derivation across load-more and jump.
- `refresh` re-loads from offset 0 with a clean reset.

The sweep is covered by existing tests passing unchanged post-rename (behaviour-neutral).

## Tech debt

**`TD-GRID-CHILD-PAGINATION` (S2).** Children remain unpaginated — a node with N children loads all N on expand. This is the deferred axis from the "roots only" decision. **Trigger:** a node exceeds ~200 children in real data, or a child fetch is observably slow. **Pay-down:** extend `fetchChildren` to a paged child query (`{ parentId, page }`) + a per-subtree "load more children" row; needs server support for `total` on the children path (today the children path deliberately omits `total`).

## Out of scope (explicit)

- Splitting the `DataContainer` header band into distinct `<title panel>` + `<sub section panel>` — a separate frame-structure change, not part of this work.
- Child-level pagination (see TD above).
- Virtualisation of the rows band.
