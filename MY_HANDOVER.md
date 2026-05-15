# Handover — Table catalog restyle + permissions tree-lines

**Branch:** `001_redesign` · **Commits this session:** `51a0ae3` (pending push) · already-local: `5bab6ec` and 4 ancestors.

## What I changed

### 1. `<Table>` column header (catalog)
[`app/globals.css`](app/globals.css) §`tree_accordion-dense__head` / `__th`. Adopted the ObjectTree treatment so every catalog table now reads the same:

| Property | Value |
|---|---|
| Header bar `background` | `var(--surface-sunken)` |
| `<th>` `font-size` / `font-weight` / `letter-spacing` | `13px` / `500` / `0.12em` |
| `text-transform` / `color` | `uppercase` / `var(--ink)` (black) |
| `padding` | `14px 16px` |

Sticky-on-`<th>` + opaque background preserved.

### 2. Panel ↔ Table flush rendering
Any `<Panel>` containing a `<Table>` loses horizontal + bottom padding so the table sits edge-to-edge against the panel border. The scroll container's redundant 1px border was dropped (was stacking against the panel border) and its bottom corners were radiused to match `border-radius: 10px` on `.panel`. Implemented via `.panel:has(.tree_accordion-dense__table)` — pure CSS, zero call-site changes.

### 3. Group / bucket rows
New body-row modifier `.tree_accordion-dense__row--group`:

- Same `var(--surface-sunken)` band as the column header, normal-case, body font-size, `color: var(--ink)`.
- `padding: 10px 16px`, `border-bottom: none` so the bucket header flows directly into its first child.
- Rows under a `__row--group` lose their inter-row bottom border (the SVG tree-lines are the connector); the last row before the next group retains its border so buckets are visually separated. Two adjacent groups get a top border on the second group so empty buckets still divide.

### 4. Permissions matrix — SVG tree-lines
[`app/(user)/user-management/permissions/page.tsx`](app/(user)/user-management/permissions/page.tsx):

- `FlatRow.isLastInBucket` is now computed during flatten so the elbow vs T-junction renders correctly.
- The page-name cell wraps the label in a new `.permissions__page-cell` element and renders `<PrimaryCellTreeLines depth={1} isLast={r.isLastInBucket} hasVisibleChildren={false} continuations={[false]} />` from `<ResourceTree>` — exact same SVG geometry as `<ObjectTree>`.
- `.permissions__page-cell` in `globals.css` is `display: block; position: relative; padding-left: 26px; line-height: 28px; height: 28px;` with the SVG absolutely positioned `top: 0 / bottom: 0 / width: 20px`. Row pinned to 28px so adjacent rows' tree-line strokes butt edge-to-edge — no gap between branches.
- Bucket grouping flagged on the table via `rowClassName={r => r.kind === "header" ? "tree_accordion-dense__row--group" : undefined}`.

### 5. `<Table>` sort (opt-in)
[`app/components/Table.tsx`](app/components/Table.tsx):

- New types: `SortValue`, `SortDir`, `SortState`.
- `Column<R>` gained `sortable?: boolean` and `sortAccessor?: (row) => SortValue`.
- `TableProps<R>` gained `initialSort?: SortState`.
- Component owns sort state; click cycles `asc → desc → off`. Comparator: nullish last, locale-aware natural compare for strings, native compare for numbers/booleans/dates.
- Renders the existing catalog primitives `__th-sortable` + `__sort-btn` + `__sort-btn--active` — no CSS additions.
- `aria-sort` set on the active `<th>`.
- Defaults to off; every existing call site renders identically.

### 6. Doc + memory
- [`docs/c_c_table_component.md`](docs/c_c_table_component.md) — `initialSort` added to props table; header-styling guidance superseded by the catalog rules themselves.
- [`.claude/memory/MEMORY.md`](.claude/memory/MEMORY.md), [`reference_design_system.md`](.claude/memory/reference_design_system.md), new feedback memory `feedback_no_hardcoded_order_from_db_data.md`.
- `Vector_Scope.md` and `BACKLOG.md` ticked.

### 7. Tooling / gitignore
- Satoshi font added under [`app/fonts/satoshi/`](app/fonts/satoshi/).
- `.gitignore` excludes `MMFFDev - Vector Assets/db-backups/` — real DB dumps were sitting untracked; deliberately kept out of the repo.

## How to verify

1. Open `/user-management/permissions` as gadmin.
2. The column header bar should be sunken with black uppercase 13px tracked labels.
3. The table should sit flush with the panel — no horizontal or bottom padding visible.
4. Each bucket row should render as a sunken band in normal-case black 13px.
5. Below each bucket, pages should show SVG branch lines: `├` for every page except the last, `└` for the last page of each bucket. Adjacent pages' branch lines should connect edge-to-edge with **no vertical gap**.
6. Click a column header that opts into sort: glyph cycles `↕ → ↑ → ↓ → ↕`, rows reorder, `aria-sort` updates.

## What's still in flight

44 items in [Vector_Scope.md](Vector_Scope.md). The PLA-0049 page-access work (Phases 0, 0.5, 1, 1.5, 2) is the most recent active scope and remains untouched by this session.

## What did NOT get pushed

`MMFFDev - Vector Assets/db-backups/` — three files totalling 3.1 MB (`.dump`, `.sql`, `rowcounts.txt`). Now gitignored. Move them out of the repo or delete them when convenient.
