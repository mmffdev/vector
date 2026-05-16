# Layout 04 — Icon Rail + Flyout

## Concept (one paragraph)

A 3-tier navigation stack arranged left-to-right: **Perspective → Section → Page**. The user picks a *perspective* (a saved navigation profile like "Default", "System Manager", "Analyst") at the top of the rail; the rail shows that perspective's *sections* as icons; clicking a section opens a *flyout* panel listing the *pages* in that section. Main content fills everything to the right. Goal: maximum work area, minimum chrome, but never more than two clicks from any page.

## Anatomy

```
┌──────┬─────────────┬──────────────────────────────────────┐
│  72  │     240     │                                      │
│ rail │   flyout    │             main content             │
│      │             │                                      │
└──────┴─────────────┴──────────────────────────────────────┘
```

### 1. Icon rail — `width: 72px`, `background: var(--surface)`, right border `1px var(--border)`

Top-to-bottom, stacked, gap ~4px, centered horizontally:

| # | Element | Size | Notes |
|---|---|---|---|
| 1 | **Brand mark** | 40×40, `--radius-md` (10px) | Solid `--ink` bg, `--canvas` letter "V". Click → home. |
| 2 | **Perspective avatar** | 40×40, circle | `--surface-sunken` bg, 2px `--ink` border ring. Shows 2-letter initials of the active perspective (e.g. "DF", "SM"). Click → opens a small picker. |
| 3 | **Divider** | 28×1px | `--border` |
| 4–N | **Section icons** | 44×44, `--radius-md` | Icon-only buttons. One library only (Lucide, 20px, 1.75 stroke). |
| foot | **Utility** (settings, notifications, user avatar) | 44×44 + 28px avatar | Pushed to bottom with `margin-top: auto`. |

**Section button states:**
- Default: `color: var(--ink-muted)`, transparent bg
- Hover: `bg: var(--surface-sunken)`, `color: var(--ink)`
- Active: same as hover, **plus** a 3px-wide `--ink` indicator bar at `left: -14px` (sits on the rail's right border), 8px from top/bottom of the button, `border-radius: 2px`

Tooltips: native `title` attribute on every icon button, or a custom tooltip 150ms after hover, positioned to the right of the rail.

### 2. Flyout panel — `width: 240px`, `background: var(--surface)`, right border `1px var(--border)`

Top to bottom:

1. **Section title** (`h3`, sentence case, `--text-md` / 16px / 600 weight, padding `0 22px`, margin-bottom 12px). Echoes the active rail icon's label.
2. **Search field** — full-width `.btn--secondary btn--sm` style, ghost text "Search {section}…", icon left. Margin `0 22px 12px`.
3. **Page list**, grouped by subsection:
   - Group header: eyebrow micro-label (`--text-xs`, uppercase, letter-spacing `0.08em`, `--ink-subtle`), padding `10px 22px 4px`
   - Page row: 32px tall, padding `0 22px`, gap 10px between icon (14px Lucide) and label. States identical to the sidebar pattern in the design system — hover/active swap to `--surface-sunken` bg + `--ink` color, active is `font-weight: 500`.
4. **Perspective segmented control** at the bottom (margin-top: auto, padding `16px 22px 0`). A 3-segment compact switcher (one button per perspective). Lets the user re-pick perspective without leaving the page they're on. Style matches `.seg` from the design system: 3px padding, `--surface-sunken` track, active segment `--ink` bg + `--canvas` text.

### 3. Main content area — fills remaining width

- Top bar (`padding: 18px 32px 0`): breadcrumb on left ( `Vector / {section}` ), spacer, right-side actions (e.g. `[+ New]` secondary button)
- Below: the actual page content (in the prototype, a populated dashboard)

## Behavior

| User action | Effect |
|---|---|
| Click a section icon in the rail | Flyout content swaps to that section's pages. Active indicator moves on the rail. |
| Click a page in the flyout | Page loads in main area. Active state moves to that row. Flyout stays open. |
| Click the rail's perspective avatar (or the bottom segmented control) | Whole stack reloads: the rail's section icons change, the flyout swaps to the first section of the new perspective, breadcrumb updates. |
| Click the brand mark | Navigates to perspective's "home" page (e.g. Dashboard). |
| `⌘ + \` (suggestion) | Collapses the flyout so only the 72px rail remains. Main content expands. |

## Data model implication

A **perspective** is a named bundle of:

```
{
  id, name, initials, icon?,
  sections: [
    { id, name, icon, pages: [{ id, name, icon? }, ...] }
  ]
}
```

The active perspective ID + active section ID + active page ID form the full nav state — three IDs, mappable to `/{perspective}/{section}/{page}` URLs.

## Token discipline (from the Vector design system)

- All colors via tokens (`--surface`, `--surface-sunken`, `--ink`, `--ink-muted`, `--ink-subtle`, `--border`, `--canvas`). Dark mode flips automatically because the tokens have `[data-theme="dark"]` overrides.
- All spacing via `--space-*` tokens (4px scale).
- No shadows, no gradients, no decorative color. Separation = surface tone shift + 1px border.
- Active states are **tone shift only** (`--surface-sunken`), never colored.
- Hover/focus transitions: 150ms ease.
- Icons: Lucide only, 20px at this density (1.75 stroke).

## What to ignore from the screenshot

- The exact section icons are placeholders — your real section list should drive these.
- The dashboard inside the main area is sample content for visual weight — the layout is the deliverable, not the dashboard.
