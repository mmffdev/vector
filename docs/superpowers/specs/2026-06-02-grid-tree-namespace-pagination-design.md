# Grid__Tree complete system: namespace sweep + title band + frame decoupling + root pagination

**Date:** 2026-06-02
**Status:** Approved (design) — ready for implementation plan
**Surface:** `app/components/Grid/` (the headless-core + styled-skin tree primitive), `app/components/DataContainer/`, and the consumer `app/(user)/scope/`.

## Problem

The `/scope` page renders the work-item hierarchy on the new Grid primitive. The intended contract — *"the frame is a dumb container; the tree owns its own title, header (columns), data rows, forms, and pagination"* — is only partly realised. Four gaps:

1. **No pagination.** Roots load once via a hardcoded `{ limit: 200, offset: 0 }` and all render. The wire already returns `total` on the roots path, but `fetchScopeRoots` discards it.
2. **Inconsistent namespace.** The tree's owned members are split-brained: some are correctly `grid__Tree_*` (Caret, Cell, Row, ExpandAll, DragGrip), others are loose `grid__*` siblings of the root block (`grid__Head*`, `grid__Body`, `grid__Branch*`, `grid__Forms`). Per the CSS convention (`root-block__Container_Child_leaf`), everything the `Grid__Tree` block owns should be `grid__Tree_*`.
3. **No tree title band.** The tree has no title space of its own; today's `subtitle`/`subDescription` (the data-view identity, "Tree" + the server-driven-parentage line) live in the frame's header band, mixed with the page title.
4. **Frame coupled to content via a render-prop.** `DataContainer` uses a `setHeader` render-prop: content pushes header strings *up* into the frame. The frame should be a plain container with its own props; content should not plumb the frame's header.

## Target structure

```
ScopePage (page.tsx) — wires two layers INDEPENDENTLY, side by side:

DataContainer   <div class="data-container">          ← dumb container; OWN title/description props
├─ data-container__TitlePanel   (title + description) ← page identity ("Scope" + hierarchy line)
└─ data-container__Viewport
   └─ GridExecution → Grid__Tree  <div class="grid">  ← data-view; OWN title/subtitle + data props
      ├─ Grid__Tree_Title       .grid__Tree_Title       ← NEW (tree identity: "Tree" + parentage line)
      ├─ Grid__Tree_Head        .grid__Tree_Head        ← columns
      ├─ Grid__Tree_Rows        .grid__Tree_Rows        ← Grid__Tree_Branch recursion
      │  ├─ Grid__Tree_Branch   .grid__Tree_Branch
      │  │  ├─ Grid__Tree_Row   .grid__Tree_Row
      │  │  └─ Grid__Tree_Forms .grid__Tree_Forms        ← row flyout (renderRowDetail)
      │  └─ …
      └─ Grid__Tree_Pagination  .grid__Tree_Pagination   ← NEW (fed by useTree)
```

**Wiring principle:** the frame and the tree are wired **independently** by the page. `DataContainer` receives `title`/`description` as plain props and renders its title panel. `Grid__Tree` receives its own `title`/`subtitle` (+ all data props) directly. **Nothing passes through the frame** — `setHeader` / `onHeader` / the render-prop are deleted. The frame is just a container.

## Decisions (locked)

| Question | Decision |
|---|---|
| Pagination axis | **Roots only.** Children stay fully-loaded-on-expand (existing lazy machine untouched). |
| Page UX | **Append-default (`load more`) + page-jump.** |
| Jump semantics | **Jump replaces the window** (reset expansion + child caches, load that page fresh). Load-more appends + preserves expansion. |
| Pagination state home | **Folded into `useTree`** — the hook owns the paged root window. |
| Namespace sweep depth | **All tree-owned members** → `grid__Tree_*`. No loose `grid__*` leaves remain. |
| Pagination wiring | **Inside `Grid__Tree`, fed by `useTree`** (no new consumer props). |
| Tree title band | **`Grid__Tree_Title`**, first child of `<div class="grid">`, above `Grid__Tree_Head`. Carries the tree's `title` + `subtitle`. |
| Title/header wiring | **Frame and tree take their own props independently.** Frame: `title`+`description`. Tree: `title`+`subtitle`. No `setHeader`/`onHeader` plumbing; no pass-through. |
| Frame children | **Plain children** (`<DataContainer title=… description=…>{children}</DataContainer>`). Render-prop deleted. |
| Page size | **100** (tunable per-consumer via `pageSize` option). |
| Sequencing | **Sweep → frame/title → pagination** (three commits, each one concern). |

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

Already correct, untouched: `grid__Tree_Caret*`, `grid__Tree_Cell`, `grid__Tree_DragGrip`, `grid__Tree_ExpandAll*`, `grid__Tree_Row`.

### Import sites

`GridExecution.tsx` (external: `GridForms→GridTreeForms`) + internal cross-refs within `Grid/`.

### Commit discipline

`git mv` pre-stages entries. Per the **INSPECT-INDEX hard rule**, run `git diff --cached --stat` and read it in full before committing; unstage anything beyond the sweep. The sweep is **its own commit**, behaviour-neutral.

---

## Part 2 — Frame decoupling + `Grid__Tree_Title` band

### DataContainer becomes a plain container

- **Remove** the `setHeader` render-prop machinery: the `DataContainerHeader` state, `setHeader` callback, and the function-as-children signature.
- **Add** plain props: `title?: string`, `description?: string`, plus normal `children: React.ReactNode`.
- Renders `data-container__TitlePanel` (title + description) above `data-container__Viewport`. Drops the old four-field `data-container__Header` block (subtitle/subDescription move to the tree).
- `page.tsx`: `<DataContainer title="Scope" description="…"><GridExecution/></DataContainer>`.

### Grid__Tree gains its own title props + band

- **New props on `GridTreeProps`:** `title?: string`, `subtitle?: string`.
- **New band `Grid__Tree_Title`** rendered as the **first** child inside `<div class="grid">`, above `Grid__Tree_Head`. Renders `title` (e.g. "Tree") + `subtitle` (e.g. "Server-driven parentage via the audited POST read-gateway…").
- New CSS under `grid__Tree_Title*` in `app/globals.css`. Section titles via `<Panel>`-equivalent / no raw `<h2>` per `lint:h2-panel-only` — confirm the band uses the sanctioned title element, not a bare `<h2>`.
- `GridExecution` passes `title`/`subtitle` straight into `<Grid__Tree>`; its old `onHeader` prop and the `useEffect` that called it are **deleted**.

---

## Part 3 — Root pagination folded into `useTree`

### Signature change

`useTree(roots, opts)` → `useTree(opts)`. The hook stops receiving roots as a prop and **owns the paged root window**.

### New options

```ts
fetchRoots: (page: { limit: number; offset: number })
  => Promise<{ rows: TRow[]; total: number }>;
pageSize?: number; // default 100
```

`fetchScopeRoots` is adjusted to return `{ rows, total }` (surfacing the `total` already on the wire it currently discards).

### New internal state

`roots: TRow[]` (accumulated/replaced window), `offset`, `total`, `rootsLoading`. The hook self-loads page 0 on mount (replacing `GridExecution`'s `loadRoots` effect).

### New actions (`UseTreeResult`)

- **`loadMore()`** — fetches `{ limit: pageSize, offset: loadedCount }`, **appends** rows to `roots`. Preserves all expansion + child caches.
- **`jumpToPage(n)`** — calls existing `reset()` (drops expansion + child caches), sets `offset = n × pageSize`, fetches that page, **replaces** `roots`.
- **`refresh()`** — re-load from offset 0 with a reset. Replaces `GridExecution.refreshAfterMutation`'s `reset()` + `loadRoots()` pair.

### New derived values (exposed)

`total`, `loadedCount` (= `roots.length`), `pageSize`, `hasMore` (= `loadedCount < total`), `currentPage` (= `offset / pageSize`; meaningful right after a jump), `rootsLoading`.

### Grid__Tree_Pagination band

Presentational component, **third sibling** inside `<div class="grid">`, after `Grid__Tree_Rows`. Reads off the `tree` result `Grid__Tree` already holds — **no new consumer props**.

- **Left** — "Showing {loadedCount} of {total}".
- **Centre** — `[Load more]` `<button>`; disabled when `!hasMore`; barber-pole while `rootsLoading`.
- **Right** — page-jump: `‹ Page {currentPage+1} of {ceil(total/pageSize)} ›` with prev/next + page-number input → `jumpToPage(n)`.

**Accessibility (WCAG 2.2 AA, `docs/c_accessibility.md`):** real `<button>`s, `aria-label`s on prev/next, labelled jump input, target sizes met, visible focus.

### Consumer simplification (`GridExecution`)

- Delete the `roots` `useState`, `loadRoots`, and the `onHeader` effect.
- `useTreeScope` passes `fetchRoots: fetchScopeRoots`, `pageSize: 100`.
- `refreshAfterMutation` → `tree.refresh()`.

---

## Testing

`useTree` tests gain: page-0 self-load; `loadMore` appends **and preserves expansion**; `jumpToPage` resets **and replaces**; `hasMore`/`total`/`loadedCount`/`currentPage` derivation; `refresh` clean re-load.

`DataContainer` test: renders title panel from props, children in viewport, no render-prop.

The sweep + title band are covered by existing `/scope` tests passing post-change (sweep is behaviour-neutral; title band is additive).

## Tech debt

**`TD-GRID-CHILD-PAGINATION` (S2).** Children remain unpaginated — a node with N children loads all N on expand. Deferred axis from the "roots only" decision. **Trigger:** a node exceeds ~200 children in real data, or a child fetch is observably slow. **Pay-down:** paged child query (`{ parentId, page }`) + per-subtree "load more children" row; needs server `total` on the children path (today deliberately omitted).

## Out of scope (explicit)

- Child-level pagination (see TD).
- Virtualisation of the rows band.
- Any change to the `workItems.query` backend contract beyond reading the `total` it already returns.

## Sequencing (three commits)

1. **Sweep** — pure rename (files, components, CSS). Behaviour-neutral.
2. **Frame + title** — DataContainer → plain container; `Grid__Tree_Title` band; rewire `page.tsx` + `GridExecution` props; delete `setHeader`/`onHeader`.
3. **Pagination** — `useTree` paging; `Grid__Tree_Pagination`; consumer simplification.
