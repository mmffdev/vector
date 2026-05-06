---
name: Tables use tree_accordion-dense__scroll structure (NOT .table / .table-wrap)
description: As of 2026-05-05, every table uses .tree_accordion-dense__scroll + __table + __head/__th + __row + __cell; the .table* family is deprecated and being stripped
type: feedback
originSessionId: 67d23c1d-67ab-4f68-9e41-b57f3d3c96a9
---
Every table in the user-facing app composes from the **`.tree_accordion-dense__*` catalog**, not the older `.table` / `.table-wrap` / `.table__head` / `.table__row` / `.table__cell` family. The legacy family is deprecated as of 2026-05-05 and will be stripped from `app/globals.css` once all 18 TSX call-sites are migrated.

**Why:** `.table-wrap` has `overflow:hidden`, which clips sticky headers. The `tree_accordion-dense__scroll` wrapper deliberately uses `overflow:auto` + a `max-height: min(80vh, 720px)` so the head can stick. We don't need two table systems — the dense-grid one already handles the call-sites that actually scale (work-items tree, layers preview, flow editor), and the rest of the app's smaller tables should adopt the same family for catalog hygiene.

**Canonical structure:**
```jsx
<div className="tree_accordion-dense__scroll">
  <table className="tree_accordion-dense__table" aria-label="…">
    <colgroup>
      <col style={{ width: 56 }} />
      <col style={{ width: 200 }} />
      <col />
    </colgroup>
    <thead className="tree_accordion-dense__head">
      <tr>
        <th className="tree_accordion-dense__th tree_accordion-dense__th--numeric">#</th>
        <th className="tree_accordion-dense__th">Name</th>
        <th className="tree_accordion-dense__th">Description</th>
      </tr>
    </thead>
    <tbody>
      <tr className="tree_accordion-dense__row">
        <td className="tree_accordion-dense__cell tree_accordion-dense__cell--numeric tree_accordion-dense__cell--mono">1</td>
        <td className="tree_accordion-dense__cell">Backlog</td>
        <td className="tree_accordion-dense__cell">Default first state.</td>
      </tr>
    </tbody>
  </table>
</div>
```

**How to apply:**
- New table → use `tree_accordion-dense__*` from the start. Never write `.table-wrap` / `.table` / `.table__head` / `.table__row` / `.table__cell` in new code.
- Touching a file that still uses `.table*` → migrate that file's table(s) to `tree_accordion-dense__*` as part of the change (don't leave the file half-converted).
- Column widths: use `<col style={{ width: N }} />` inside `<colgroup>`. This is the only sanctioned inline `style` in tables.
- Stacked tables: wrap in `<div className="u-stack--gap-3">…</div>` — never invent a `__group` modifier on the table wrapper itself (that was the `flow-editor__group` mistake).
- Per-table column-width modifier classes (e.g. `.foo__pos-cell { width: 56px }`) are also forbidden — set the width on the `<col>` element directly.
- Section headers mid-body: use `<tr className="tree_accordion-dense__row tree_accordion-dense__row--epic">` + `colSpan` + `<span className="eyebrow">…</span>`, never `__head` inside `<tbody>`.
- Class mapping for migration: `table-wrap`→`tree_accordion-dense__scroll`, `table`→`tree_accordion-dense__table`, `table__head`→`tree_accordion-dense__head`, `<th class="table__cell">`→`<th class="tree_accordion-dense__th">`, `table__row`→`tree_accordion-dense__row`, `<td class="table__cell">`→`<td class="tree_accordion-dense__cell">`, numeric/mono modifiers map directly. `table__cell--muted` has no direct replacement — base cell already uses muted-enough ink.
- Cell modifiers available: `--numeric`, `--center`, `--mono`. Row modifiers: `--epic`, `--child`, `--selected`. Header modifiers: `--numeric`, `--center`, `--mono`.
- Reference: full rule + mapping table in [docs/css-guide.md](../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/docs/css-guide.md) under "Tables" / "Migration: `.table` / `.table-wrap` is deprecated".
- Before stripping `.table*` rules from `app/globals.css`, all TSX/TS call-sites must be migrated — the strip is a single follow-up commit, not part of every page-touching change.

**Migration tracking:** technical-debt register holds the bulk-migration entry; per-file work happens organically as each surface is touched.
