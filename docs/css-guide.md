# CSS Guide — Vector PM

Single source of truth for styling. **Load this file before writing any HTML or JSX element.**

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

```jsx
<div className="table-wrap">
  <table className="table" aria-label="…">
    <colgroup>…</colgroup>          {/* optional but recommended for fixed widths */}
    <thead className="table__head">
      <tr>
        <th className="table__cell">Column</th>
        <th className="table__cell table__cell--numeric">Pts</th>
      </tr>
    </thead>
    <tbody>
      <tr className="table__row">
        <td className="table__cell">Value</td>
        <td className="table__cell table__cell--numeric">5</td>
      </tr>
    </tbody>
  </table>
</div>
```

| Class | Where | Purpose |
|---|---|---|
| `.table-wrap` | outer `<div>` | surface bg, border, overflow:hidden |
| `.table` | `<table>` | full-width, border-collapse |
| `.table__head` | `<thead>` | sunken header background |
| `.table__cell` | `<th>` and `<td>` | padding, height, ink colour, border |
| `.table__row` | `<tr>` in `<tbody>` only | hover state, border-bottom |
| `.table__cell--numeric` | modifier on `<th>`/`<td>` | right-aligned, tabular nums |
| `.table__cell--muted` | modifier on `<td>` | de-emphasised ink colour |

**Never put `table__head` on a `<tr>` inside `<tbody>`.** Header rows belong in `<thead>`. If a table needs mid-body section headings (e.g. zone separators), use a dedicated separator class (e.g. `.layers-editor__row--group-sep`), not a re-use of `.table__head`.

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
