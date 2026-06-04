# Structure — Component Building Blocks

A living index of the composable UI building blocks in this codebase. One row per component, one line on its purpose. Use this to remember what we have before reaching for a search or building something new.

Grouped by primitive family. Each family = a `<Skin>` + `useHook()` pair (headless core + canonical skin) plus the bands that compose it.

---

## Grid

The canonical tree-skin family. Headless behaviour ([useTree](../app/components/Grid/useTree.ts)) + canonical look ([Grid__Tree](../app/components/Grid/Grid__Tree.tsx)). Bands compose top-to-bottom inside `<div class="grid">`: StatsPanel → ActionBar → Head → Rows → Pagination. Connectors are CSS-driven from DOM nesting (no JS geometry).

| Component | Purpose |
|---|---|
| [`<Grid__Tree>`](../app/components/Grid/Grid__Tree.tsx) | Canonical skin — owns the look, composes bands, wires `useColumnManager` + `useTree`. The single source of tree appearance. |
| [`<Grid__Tree_StatsPanel>`](../app/components/Grid/Grid__Tree_StatsPanel.tsx) | Optional summary band above ActionBar — caller-supplied stat cells, resource-agnostic. |
| [`<Grid__Tree_ActionBar>`](../app/components/Grid/Grid__Tree_ActionBar.tsx) | Action band — create-new (radial via `NavigationPie`), search input, host-supplied filter slot. |
| [`<Grid__Tree_Head>`](../app/components/Grid/Grid__Tree_Head.tsx) | Column header band — sort, resize gutters, expand-all/collapse-all control in lead column. |
| [`<Grid__Tree_Row>`](../app/components/Grid/Grid__Tree_Row.tsx) | One data row — CSS-grid row, caret in primary cell, accent border via `--row-accent`, barber-pole modifier when form-open. |
| [`<Grid__Tree_Lines>`](../app/components/Grid/Grid__Tree_Lines.tsx) | Inline SVG connector + indent inside the primary cell — Rally-style hooks anchored to the badge column at each depth. |
| [`<Grid__Tree_Cog>`](../app/components/Grid/Grid__Tree_Cog.tsx) | Per-row cog (row-actions) — self-contained Escape + outside-click dismiss, raises `onOpenChange`. |
| [`<Grid__Tree_Forms>`](../app/components/Grid/Grid__Tree_Forms.tsx) | Flyout-below payload — hosts `ArtefactInlineForm` in a row's detail slot; opened via `openDetailId` on the skin. |
| [`<Grid__Tree_Pagination>`](../app/components/Grid/Grid__Tree_Pagination.tsx) | Root pagination band — load-more (append) + page-jump (replace). Fed by `useTree` result; no consumer props. |
| [`useTree()`](../app/components/Grid/useTree.ts) | Headless core — expand / lazy-fetch / cache / expand-all cascade. Returns nested node tree, zero geometry. |
| [`useColumnManager()`](../app/components/Grid/useColumnManager.ts) | Column widths + sort + drag-resize. Lifted verbatim from DataGrid; zero tree coupling. |
| [`types.ts`](../app/components/Grid/types.ts) | Shared types for `useTree` + `<Grid__Tree>` — `GridColumn`, `TreeNode`, `GridMenuItem`, `GridLoadingStyle`. |
