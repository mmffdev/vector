# CSS Guide — Vector PM

Single source of truth for styling. Read this before adding CSS.

## Rules

1. **No inline styles.** No `style={{...}}`, no style attributes. Every rule lives in `app/globals.css`.
2. **No Tailwind, no CSS-in-JS.** Plain CSS + CSS variables.
3. **All values via CSS variables** — `color: var(--ink-1)`, never `color: #1f1f1f`.
4. **One block class + modifiers per element** — `<button class="btn btn--primary btn--sm">`, not a utility-class soup.

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

```
.btn                 /* base: padding, font, border */
.btn--primary        /* accent background */
.btn--secondary      /* transparent + line border */
.btn--ghost          /* no border, hover-only */
.btn--danger         /* red for destructive */
.btn--sm / .btn--lg  /* size modifiers */
```

### Tables

```
.table
.table__head
.table__body
.table__row
.table__cell
.table__cell--numeric  /* right-aligned */
.table__cell--muted    /* de-emphasized */
.table-wrap            /* scroll container */
```

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
