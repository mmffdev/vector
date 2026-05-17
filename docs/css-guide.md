# CSS Guide — Vector PM

Single source of truth for styling. **Load this file before writing any HTML or JSX element.**

> **Dev Setup pages take a different catalog.** Anything rendered under `/dev` (panels in [`dev/pages/DevPage.tsx`](../dev/pages/DevPage.tsx)) MUST use the `.dui-*` primitives in [`dev/styles/dev-ui.css`](../dev/styles/dev-ui.css). See [`docs/c_c_dev_ui_primitives.md`](c_c_dev_ui_primitives.md) for the HARD RULE and the 14 primitive families. The rules below apply to user-facing app pages.

## Pre-flight (run this before every element you write)

1. **Is there a catalog class for this element?** → use it. Tables use `.table` + `.table__row` + `.table__cell`. Buttons use `.btn` + variant. Inputs use `.form__input`. Headings and body text inherit from `globals.css` via the theme. Do not invent a bespoke class if one already exists.
2. **Inheritance chain — do not skip levels:** theme CSS (`globals.css` `:root` variables) → `globals.css` component classes → your JSX `className`. Never bypass this with inline styles or hardcoded values.
3. **No `style={{...}}` — ever.** The only permitted exception: a runtime-computed value that is genuinely impossible to express as a static class (e.g. `paddingLeft: depth * 20`). In that case expose it as a CSS custom property and reference it from a `globals.css` rule.
4. **No hardcoded colours, sizes, or fonts.** Use `var(--ink)`, `var(--surface)`, `var(--font-mono)`, etc. See the Tokens section.
5. **Need something new?** Follow the "When you need a new component" checklist at the bottom — catalog check → add to `globals.css` → update this guide → then use in JSX.

## Naming convention — BEM-lite

```
.block                   /* component root */
.block__element          /* child inside the component */
.block--modifier         /* variant of the whole component */
.block__element--state   /* variant of a child */
```

### Prefixes

| Prefix | Meaning | Example |
|---|---|---|
| (none) | Component | `.card`, `.table`, `.modal` |
| `u-` | Utility, single-purpose | `.u-mono`, `.u-truncate` |
| `is-` / `has-` | State, JS-toggled | `.is-open`, `.is-loading`, `.has-error` |
| `js-` | JS-only hook, no styling | `.js-dropdown-trigger` |

### Examples

```html
<!-- Good -->
<button class="btn btn--primary btn--sm">Save</button>
<div class="modal modal--wide">
  <header class="modal__header">…</header>
  <div class="modal__body">…</div>
</div>
<a class="sidebar__item is-active" href="/backlog">Backlog</a>

<!-- Bad -->
<button class="primary-btn small">Save</button>              <!-- wrong separator -->
<button style={{ padding: 8 }}>Save</button>                 <!-- inline -->
<div class="p-4 bg-white border rounded">                    <!-- Tailwind-ish -->
<div class="admin-users-table-row">                          <!-- page-scoped, not reusable -->
```

## Component catalog

These are the canonical components. If you need something similar, extend with a modifier rather than inventing a new block.

### Layout (existing)
- `.app-shell`, `.app-content-container`, `.app-viewport-container`
- `.page-header`, `.page-header__subtitle`, `.page-body`

### Navigation (existing)
- `.app-sidebar-container`, `.sidebar-item`, `.sidebar-section`, `.sidebar-dev-group`
- `.topbar`, `.topbar__brand`, `.topbar__actions`
- `.footer`, `.footer__link`
- `.anav`, `.anav__list`, `.anav-layout`, `.anav-content` (layout scaffolding only — no visual rules)

**HARD RULE — vertical nav primitives:** Every vertical navigation surface (sidebar, in-page ToC rails, menus, any vertical list of links) MUST use `.sidebar-section` for group headers and `.sidebar-item` for row links. No bespoke nav selector may carry visual styling — only layout properties (position, overflow, grid columns).

**Identical sizing across all vertical navs** — every vertical nav surface inherits the same dimensions. `.sidebar-item` and `.sidebar-section` consume four CSS custom properties whose defaults are set on `.app-sidebar-container`. Any wrapping element MAY override them, but the default rule is: **don't**. The ToC rail (`.anav`) deliberately sets no overrides, so it looks identical to the app sidebar.

| Property | Default | Purpose |
| --- | --- | --- |
| `--nav-item-height` | `36px` | Row height of `.sidebar-item` |
| `--nav-item-padding-x` | `24px` | Horizontal padding of `.sidebar-item` |
| `--nav-section-padding` | `14px 24px 6px` | Padding of `.sidebar-section` header |
| `--nav-section-margin-top` | `14px` | Top margin of `.sidebar-section` |

A single edit to `.app-sidebar-container`'s defaults propagates to every vertical nav surface in the app.

Never use `--surface-raised` — it has no `:root` definition and resolves to transparent. Hover state always uses `--surface-sunken`.

### Buttons

**HARD RULE:** Every `<button>` in the app MUST carry `.btn` plus exactly one variant. A naked `<button>` with no class is a defect — full stop.

| Intent | Classes |
|---|---|
| Default action | `.btn` |
| Primary CTA (one per region) | `.btn btn--primary` |
| Cancel / secondary | `.btn btn--secondary` |
| Quiet / icon-only | `.btn btn--ghost` |
| Icon-only (square) | `.btn btn--icon` (add `.btn--ghost` for transparent) |
| Row expander / tree toggle | `.btn btn--icon btn--row-expander` |
| Destructive | `.btn btn--danger` |
| Smaller | add `.btn--sm` (32 × 32 / 32px high) |
| Larger | add `.btn--lg` |
| Block (full width) | add `.btn--block` |

**Icon-only size ladder** (compose with `.btn--icon`, never re-declare width/height): `.btn--sm` (32) → `.btn--xs` (28) → `.btn--tiny` (24) → `.btn--micro` (20). The default `.btn--icon` is 36×36.

**HARD RULE — no duplicated declarations.** A bespoke selector (e.g. `.chart-widget__close`, `.topo-flyout__close`) MUST NOT redeclare any property already set on `.btn` / `.btn--icon` / `.btn--sm` / `.btn--ghost` etc. The bespoke selector is allowed to override **only**:

- `position`, `top`, `right`, `bottom`, `left`, `z-index` (placement)
- `margin` (positioning relative to siblings)
- The icon's accent or hover colour, *only if it genuinely differs from the variant's default*

If you find yourself writing `display`, `align-items`, `width`, `height`, `padding`, `border`, `background`, `color`, `border-radius`, `font-*`, `cursor`, `transition` on a bespoke button selector — STOP. The variant exists for that. Use it.

**Why this matters:** changing the site-wide button shape (e.g. radius, height, hover behaviour) must be a single edit to `.btn` + variants. Every duplicated declaration is a place a future theme change has to be re-applied.

**Custom interactive elements** (toggle tiles, segmented controls, day-pickers) that are structurally not navigation buttons still MUST compose from the token set below — never invent new token names or use `--brand` for interactive states.

```
Active state  → background: var(--accent);  color: var(--accent-ink);  border-color: var(--accent);
Inactive      → background: var(--surface); color: var(--ink);         border: 1px solid var(--border-strong);
Hover         → background: var(--surface-sunken); color: var(--ink);
Transitions   → transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
Shape         → border-radius: 0;  height: 40px; (matches .btn geometry)
```

### Tables

**HARD RULE — canonical structure. Every table in the app MUST follow this exact shape. No variations.**

The canonical wrapper is `.tree_accordion-dense__scroll`, which owns its own border, surface, and `overflow:auto` so a sticky header can stick. Use it for every table (`.table-wrap` is **deprecated** — see "Migration" below).

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

| Class | Where | Purpose |
|---|---|---|
| `.tree_accordion-dense__scroll` | outer `<div>` | surface bg, border, `overflow:auto` (sticky-header friendly), `max-height: min(80vh, 720px)` |
| `.tree_accordion-dense__table` | `<table>` | full-width, `border-collapse: separate`, `table-layout: fixed`, 13px ink |
| `.tree_accordion-dense__head` | `<thead>` | sunken header background |
| `.tree_accordion-dense__th` | `<th>` | uppercase eyebrow, sticky-top, 11px label |
| `.tree_accordion-dense__th--numeric` | modifier on `<th>` | right-aligned |
| `.tree_accordion-dense__th--center` | modifier on `<th>` | centred |
| `.tree_accordion-dense__th--mono` | modifier on `<th>` | monospaced label |
| `.tree_accordion-dense__row` | `<tr>` in `<tbody>` | 28px high, hover, zebra striping (even rows tinted) |
| `.tree_accordion-dense__row--epic` | modifier on `<tr>` | bold (use for group/zone separator rows) |
| `.tree_accordion-dense__row--child` | modifier on `<tr>` | structural marker (no visual change) |
| `.tree_accordion-dense__row--selected` | modifier on `<tr>` | accent-tinted background |
| `.tree_accordion-dense__cell` | `<td>` | 12px padding, ellipsis, vertical-align middle |
| `.tree_accordion-dense__cell--numeric` | modifier on `<td>` | right-aligned |
| `.tree_accordion-dense__cell--center` | modifier on `<td>` | centred |
| `.tree_accordion-dense__cell--mono` | modifier on `<td>` | monospaced, smaller, muted ink |

**Column widths.** Set fixed widths via `<col style={{ width: N }} />` inside `<colgroup>`. This is the **only** sanctioned use of inline `style` in tables — it expresses a structural width that has no semantic class. The last `<col />` (no width) takes the remaining space.

**Multiple stacked tables.** Wrap them in `<div className="u-stack--gap-3">…</div>` to space them — never invent a `__group` modifier on the wrapper.

**Section header rows.** For mid-body group/zone separators (e.g. "Strategy Zone", "Execution Zone"), use a `<tr className="tree_accordion-dense__row tree_accordion-dense__row--epic">` with a `colSpan` cell containing an `<span className="eyebrow">` — not a re-use of `__head`.

**Never put `tree_accordion-dense__head` on a `<tr>` inside `<tbody>`.** Header rows belong in `<thead>`.

#### Migration: `.table` / `.table-wrap` is deprecated

The legacy `.table` / `.table-wrap` / `.table__head` / `.table__row` / `.table__cell` family is **deprecated as of 2026-05-05**. Reasons:

1. `.table-wrap` has `overflow:hidden`, which clips sticky headers — every long table eventually needs a scroll wrapper that allows sticky positioning, so we already have `.tree_accordion-dense__scroll` and don't need two systems.
2. Live callers in the app already use `tree_accordion-dense__*` for the dense grids that actually scale; the rest are smaller tables that should adopt the same family for consistency.

**Do not write new code against `.table*`.** When touching a file that still uses it, migrate that file's table(s) to `tree_accordion-dense__*` as part of the change. The bulk strip of `.table*` rules from `app/globals.css` lands once every TSX caller is migrated — see the technical-debt register entry.

**Mapping (one-to-one):**

| Legacy | Replacement |
|---|---|
| `.table-wrap` | `.tree_accordion-dense__scroll` |
| `.table` | `.tree_accordion-dense__table` |
| `.table__head` | `.tree_accordion-dense__head` |
| `<th className="table__cell">` | `<th className="tree_accordion-dense__th">` |
| `.table__cell--numeric` (on `<th>`) | `.tree_accordion-dense__th--numeric` |
| `.table__row` | `.tree_accordion-dense__row` |
| `.table__cell` (on `<td>`) | `.tree_accordion-dense__cell` |
| `.table__cell--numeric` (on `<td>`) | `.tree_accordion-dense__cell--numeric` |
| `.table__cell--muted` | (no direct replacement — base `__cell` is already muted enough; if you need stronger muting wrap content in `<span className="u-muted">` or extend the catalog) |
| outer wrapper modifier (`.table-wrap foo__group`) | drop — use `<div className="u-stack--gap-3">` to space stacked tables |
| per-table column-width class (`.foo__pos-cell`) | drop — set width via `<col style={{ width: N }} />` |

### Forms

```
.form
.form__row
.form__label
.form__input        /* text, email, password, number */
.form__select
.form__textarea
.form__error
.form__hint
```

### Modal

```
.modal-backdrop
.modal
.modal__header
.modal__title
.modal__close
.modal__body
.modal__actions     /* footer button row */
```

### Tabs

```
.tabs
.tabs__tab
.tabs__tab--active
.tabs__panel
```

### Misc

- `.card`, `.card__header`, `.card__body`
- `.empty-state` (existing)
- `.role-badge` (existing)
- `.tag`, `.tag--muted`, `.tag--warn`
- `.code-block` (monospace pre-style)

## Typography rules

| Rule | Value |
|---|---|
| **Minimum font size** | `13px` — no element on any user-facing page may use a smaller size unless explicitly overridden by the user |
| Body / default | Inherits from theme (`--font-sans`, approx 14–15px) |
| Eyebrow labels | `11px`, `font-weight: 600`, uppercase — the only sanctioned exception below 13px |

When writing a new component, default to `13px` if no larger size fits the context. Never use `0.7rem`, `0.75rem`, or similar values that may compute below 13px without checking.

## Visual polish — interaction details

Cross-cutting rules every catalog component observes. These are about how the UI *feels*, separate from structural rules above.

### Concentric radius

For nested rounded surfaces (panel inside card, button inside toolbar), the parent radius MUST equal the child radius plus the padding between them:

```text
outer radius = inner radius + padding
```

If the padding is large enough that the math produces an awkward outer curve, treat the layers as separate surfaces (zero radius on one of them) rather than forcing the formula. The point is optical coherence, not formula worship.

Vector currently uses `--radius-sm` / `--radius-md` set to `0` (flat look). When/if rounded surfaces return, this rule applies to every nested pair.

### Text wrapping

| Surface | Rule |
|---|---|
| Page headings (`<PageDescription>` titles, `<h2>` inside `<Panel>`) | `text-wrap: balance` — distributes lines evenly so a heading never ends with a single orphan word |
| Short body (panel descriptions, list items, captions, hints, table cells) | `text-wrap: pretty` — avoids orphans on the last line |
| Long prose, code blocks, preformatted content | Neither — default wrapping |

### Tabular numerals

**HARD RULE:** Any UI surface that displays *changing* numbers (counters, timers, prices, percentages, dashboard counts, work-item IDs in `.tree_accordion-dense__cell--mono`) MUST use `font-variant-numeric: tabular-nums`. Without it, digits have variable widths and the column jitters as the value updates.

```css
.tree_accordion-dense__cell--mono,
.metric__value,
.timer__display {
  font-variant-numeric: tabular-nums;
}
```

### Image outlines

Any `<img>` rendered on `var(--surface)` MUST carry a subtle inset outline so its edges don't blur into the surface in either theme:

```css
img {
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
}

:root[data-theme="dark"] img {
  outline-color: rgba(255, 255, 255, 0.1);
}
```

Use neutral alpha only. **Never** tint image outlines with `--accent` or `--brand`.

### Transitions

**HARD RULE — no `transition: all`.** Always list the changed properties explicitly:

```css
/* Bad */
.btn { transition: all 0.15s ease; }

/* Good */
.btn {
  transition-property: background-color, color, border-color, transform;
  transition-duration: 0.15s;
  transition-timing-function: ease;
}
```

Same applies to `will-change`: **never `will-change: all`.** Set it only on the specific compositor-friendly properties that genuinely need pre-promotion (`transform`, `opacity`, `filter`).

### Motion defaults

- **Enter animations:** combine `opacity` + small `translateY` (≤ 8px). Reserve keyframes for one-shot staged sequences; use CSS transitions for everything else (transitions can retarget when the user changes intent mid-motion).
- **Exit animations:** shorter and quieter than enter — typically 120ms vs 200ms.
- **Press feedback:** `transform: scale(0.97)` on `:active` for tactile buttons.
- **`prefers-reduced-motion`:** every non-essential animation MUST collapse to a non-moving transition (opacity only, or zero duration) under this media query.

```css
@media (prefers-reduced-motion: reduce) {
  .btn,
  .modal,
  .anav__item {
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
}
```

### Hit areas

**HARD RULE:** Every interactive element MUST have a hit area of **≥ 24×24 CSS pixels** (WCAG 2.2 SC 2.5.8). Vector's `.btn` size ladder passes natively except `.btn--micro` (20×20), which is allowed only in dense rows where vertical spacing satisfies the SC 2.5.8 exception.

When a visible icon is smaller than the required hit area, expand via a pseudo-element rather than outer padding (which disrupts adjacent layout):

```css
.btn--micro {
  position: relative;
}
.btn--micro::before {
  content: "";
  position: absolute;
  inset: -4px;          /* total ≥ 28×28 */
}
```

See [docs/c_accessibility.md](c_accessibility.md) for the full a11y rules; this section covers the CSS expression.

### Review output

When reviewing a polish pass, report changes as a before/after table:

| Principle | Before | After |
|---|---|---|
| Concentric radius | Parent + child both `--radius-md` | Parent `+8px`, child `--radius-md` |
| Tabular numerals | Counter shifts as digits change | Added `font-variant-numeric: tabular-nums` |
| Transition scope | `transition: all` on `.btn` | Explicit `transition-property` list |
| Hit area | 20×20 icon button with no expansion | Added `::before { inset: -4px }` for ≥28×28 |

Include file paths and line ranges where the change applies. Omit principles you checked but did not change — silence means "passed".

## Tokens (CSS variables)

All defined in `:root[data-theme="light"]` and `:root[data-theme="dark"]` in `globals.css`.

| Token | Purpose |
|---|---|
| `--bg` | Page background |
| `--surface` | Cards, tables, modals |
| `--surface-alt` | Subtle contrast (table headers, hover) |
| `--ink-1` → `--ink-4` | Text, darkest → lightest |
| `--line-1`, `--line-2` | Borders |
| `--accent` | Brand green |
| `--accent-soft` | Tinted accent background |
| `--accent-border` | Accent border on hover/active |
| `--accent-ink` | Accent text |
| `--good`, `--warn`, `--error` | Semantic status colors |
| `--radius-sm`, `--radius-md` | Corner radius (currently 0 — flat look) |
| `--font-sans`, `--font-mono` | Font families |
| `--sidebar-width`, `--topbar-height` | Layout dimensions |

If you need a new token, add it to both theme blocks — never hardcode.

## State classes

Toggle these via React based on state. Keep CSS selectors stable.

```css
.modal.is-open { /* ... */ }
.btn.is-loading { opacity: 0.6; pointer-events: none; }
.form__input.has-error { border-color: var(--error); }
```

## Responsive

Mobile breakpoint is `900px` (see existing `.app-content-container` rule). Use the same breakpoint for new responsive rules to keep behaviour consistent.

```css
@media (max-width: 900px) { /* ... */ }
```

## When you need a new component

1. Check this catalog first — can an existing block + modifier do the job?
2. If not, add the new block to `globals.css` under the right section (Layout / Navigation / Components).
3. Update this guide's catalog with the new class names.
4. Only then use it in JSX.

## Migration tracker

Inline-style migration complete (2026-04-21). All former offenders now use BEM-lite classes from `app/globals.css`. If `grep -R "style={{" app/` turns up new hits, add the block here and follow the "When you need a new component" checklist above.
