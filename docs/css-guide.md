# CSS Guide — Vector PM

Single source of truth for styling. Read this before adding CSS.

## Rules

**HARD RULE — ALL ELEMENTS:** Every element placed on a page MUST be styled via `app/globals.css` classes and CSS variables. This is non-negotiable. Specifically:

1. **No inline styles — ever.** `style={{...}}` and style attributes are prohibited. If you catch yourself writing one, stop: add a class to `globals.css` instead. The only permitted exception is a genuinely dynamic value that cannot be expressed as a CSS variable — in that case, expose it as a CSS custom property (`style={{ "--my-var": value }}`) and reference it from a rule in `globals.css`.
2. **No Tailwind, no CSS-in-JS.** Plain CSS + CSS variables only.
3. **All values via CSS variables** — `color: var(--ink-1)`, never `color: #1f1f1f`.
4. **One block class + modifiers per element** — `<button class="btn btn--primary btn--sm">`, not utility-class soup.
5. **Use the catalog first.** Before writing any new class, check the component catalog below. If an existing block + modifier covers the case, use it. Only create a new class if nothing fits — then follow the "When you need a new component" checklist.

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
| Destructive | `.btn btn--danger` |
| Smaller | add `.btn--sm` |
| Larger | add `.btn--lg` |

**Custom interactive elements** (toggle tiles, segmented controls, day-pickers) that are structurally not navigation buttons still MUST compose from the token set below — never invent new token names or use `--brand` for interactive states.

```
Active state  → background: var(--accent);  color: var(--accent-ink);  border-color: var(--accent);
Inactive      → background: var(--surface); color: var(--ink);         border: 1px solid var(--border-strong);
Hover         → background: var(--surface-sunken); color: var(--ink);
Transitions   → transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
Shape         → border-radius: 0;  height: 40px; (matches .btn geometry)
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
