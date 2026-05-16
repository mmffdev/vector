---
name: CSS canonical — buttons, tables, inline styles, tokens
description: Single source for Vector CSS discipline. Every <button> uses .btn + variant; every table uses tree_accordion-dense__*; no inline style={{}}; interactive state uses --accent / --accent-ink, never --brand.
metadata:
  type: feedback
---

Consolidates the older `feedback_button_classes`, `feedback_table_structure`, `css_buttons`, and `css_tables` memories (2026-05-13). Original files removed — their content is here and stays in sync with [`docs/css-guide.md`](../../docs/css-guide.md), which is the loadable reference.

## 1. Buttons

Every `<button>` in the codebase MUST carry `.btn` plus exactly one variant. Canonical rules live in [app/globals.css](../../app/globals.css) ~1141–1255.

**Variants:** `.btn` (default ink fill), `.btn--primary` (accent fill), `.btn--secondary` (accent outline), `.btn--ghost` (transparent — toolbar use), `.btn--icon` (square 36×36 icon-only — combine with `.btn--ghost`), `.btn--danger` (destructive), `.btn--row-expander` (tree expander), `.btn--sm` (32px), `.btn--lg` (48px), `.btn--block` (full-width).

**HARD RULE — bespoke selectors NEVER restate baseline.** A bespoke selector (e.g. `.chart-widget__close`) may override ONLY `position/top/right/bottom/left/z-index`, `margin`, and an icon's accent/hover colour when it genuinely differs. It MUST NOT redeclare `display`, `align-items`, `width`, `height`, `padding`, `border`, `background`, `color`, `border-radius`, `font-*`, `cursor`, `transition` — the variant provides these.

**How to apply:** pick the closest `.btn` variant first; never invent a new bespoke button class for shape/size. Editing a button without `.btn` is a defect — add `.btn .btn--<variant>` AND strip duplicated declarations from the bespoke selector (often the bespoke selector ends up empty — delete it). Every button is square per user policy (2026-05-04). Naked `<button>` with no class is a defect.

**Why:** changing site-wide button shape must be a single edit to `.btn` + variants. Every duplicated declaration is a place a future theme change has to be re-applied — the problem flagged 2026-05-04 reviewing the topology toolbar.

## 2. Tables — `tree_accordion-dense__*` family

Every table composes from `.tree_accordion-dense__*`. The older `.table` / `.table-wrap` / `.table__head` / `.table__row` / `.table__cell` family is DEPRECATED as of 2026-05-05 and is being stripped from `app/globals.css` as the last 18 TSX call-sites migrate.

**Why:** `.table-wrap` had `overflow:hidden`, clipping sticky headers. `tree_accordion-dense__scroll` uses `overflow:auto` + `max-height: min(80vh, 720px)` so heads stick. Two table systems is one too many.

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

**How to apply:** new tables → `tree_accordion-dense__*` from the start. Touching a file with `.table*` → migrate that file's tables in the same change; don't half-convert. Column widths via `<col style={{ width: N }} />` inside `<colgroup>` (the only sanctioned inline `style` in tables). Per-table column-width modifier classes are forbidden — set width on `<col>` directly. Mid-body section headers: `<tr className="tree_accordion-dense__row tree_accordion-dense__row--epic">` + `colSpan` + `<span className="eyebrow">…</span>`, never `__head` inside `<tbody>`. Stacked tables: wrap in `<div className="u-stack--gap-3">`, never invent a `__group` modifier (the `flow-editor__group` mistake).

**Migration class map:** `table-wrap`→`__scroll`, `table`→`__table`, `table__head`→`__head`, `<th class="table__cell">`→`<th class="__th">`, `table__row`→`__row`, `<td class="table__cell">`→`<td class="__cell">`. `table__cell--muted` has no replacement — base cell already uses muted-enough ink. Cell modifiers: `--numeric`, `--center`, `--mono`. Row modifiers: `--epic`, `--child`, `--selected`. Header modifiers: same.

## 3. Inline styles + interactive tokens

`style={{...}}` is prohibited site-wide. The only permitted exception: a genuinely dynamic value that can't be a CSS variable — use `style={{ "--my-var": value }}` and reference `var(--my-var)` in the stylesheet.

**Custom interactive elements** (toggle tiles, day pickers, segmented controls) that are NOT `.btn` buttons MUST compose from these tokens — never invent new token names, never use `--brand` for interactive state:
- Active: `background: var(--accent)`, `color: var(--accent-ink)`, `border-color: var(--accent)`
- Inactive: `background: var(--surface)`, `color: var(--ink)`, `border: 1px solid var(--border-strong)`
- Hover (inactive): `background: var(--surface-sunken)`, `color: var(--ink)`
- Geometry: `border-radius: 0`, `height: 40px` (matches `.btn`)
- `--brand` is for identity marks ONLY — never for interactive state colours.

**Why:** Two 2026-04-29 incidents — Workdays picker tiles + Workspace Settings segmented control used `--brand`, producing white-on-white invisible text. Plus the broader rule: every element placed on a page uses the catalog, no custom styles unless explicitly requested.

**How to apply:** before writing `style={{...}}`, stop and add the rule to `globals.css` under the appropriate component block. Check the catalog in [`docs/css-guide.md`](../../docs/css-guide.md) first — if an existing block + modifier covers the case, use it.

## 4. Linked memories

- [[feedback_helper_icon]] — helper icons wire through `<Panel>`, never inline.
- [[feedback_sidebar_toolbar]] — 22px left margin for toggle + pencil.
- [[feedback_pages_fullscreen]] — pages default to full screen, no max-width.
