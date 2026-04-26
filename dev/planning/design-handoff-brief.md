# Design Handoff Brief — MMFFDev Vector (Full Facelift)

**Date:** 2026-04-26  
**Prepared for:** Claude Design (claude.ai/design)  
**Project:** MMFFDev Vector — a portfolio management tool for structured work management (like Jira, but hierarchical and model-driven)

---

## 1. What the product is

MMFFDev Vector is a **B2B SaaS PM tool** used by organisations to manage work items across a layered portfolio model. Think of it as a structured hierarchy: Portfolio → Programs → Features → Execution Items (user stories, tasks).

Roles in the system:
- **padmin** (Portfolio Admin) — owns the portfolio model, configures the work structure
- **gadmin** (Group Admin) — manages users, permissions, org settings
- **user** — day-to-day worker, manages work items

The product is **both a configuration tool and a working tool** — admins set the structure, users live inside it.

---

## 2. Pages inventory

### Auth flows
- `/login` — email/password login form
- `/login/reset` — password reset request
- `/login/reset/confirm` — reset token confirmation
- `/change-password` — forced password change on first login

### Main app (all role-gated, authenticated)
| Route | Purpose | Who sees it |
|---|---|---|
| `/dashboard` | Overview/landing page | All roles |
| `/portfolio` | Portfolio overview | padmin + user |
| `/portfolio-model` | Adopt/configure the portfolio model | padmin only |
| `/portfolio-settings` | Settings for the portfolio | padmin |
| `/backlog` | Work item backlog list | All roles |
| `/my-vista` | Personal view of assigned work | user |
| `/planning` | Planning / roadmap view | All roles |
| `/risk` | Risk register | All roles |
| `/favourites` | Pinned/bookmarked items | All roles |
| `/library-releases` | MMFF release notifications | gadmin only |
| `/admin` | User and permission management | gadmin + padmin |
| `/account-settings` | Personal account settings | All roles |
| `/workspace-settings` | Workspace-level config | gadmin |
| `/preferences/navigation` | Sidebar customisation | All roles |
| `/theme` | Theme selector (light/dark/set) | All roles |
| `/p/[id]` | User-created custom pages | All roles |
| `/dev` | Developer tooling (dev mode only) | Dev mode only |
| `/dev/library` | Markdown doc browser (dev mode only) | Dev mode only |

---

## 3. Shell / chrome structure

```
┌─────────────────────────────────────────────┐
│  AppHeader (top bar, ~77px)                  │
│  [Logo] [Page title]        [Avatar] [Bell]  │
├──────────────┬──────────────────────────────┤
│  Sidebar     │  Page content area            │
│  (220px      │  (PageShell wraps content)    │
│  collapsible │                               │
│  → 64px)     │  [PageHeaderBar: title +      │
│              │   subtitle + optional actions]│
│  Groups of   │                               │
│  nav items   │  [Body]                       │
│  with icons  │                               │
│              │                               │
├──────────────┴──────────────────────────────┤
│  AppFooter (minimal)                         │
└─────────────────────────────────────────────┘
```

**Sidebar behaviour:**
- Collapsible (toggle button in sidebar toolbar)
- Groups with headings
- Active item highlighted
- Flyout sub-items on hover when collapsed
- Dev group at the bottom (only visible in dev mode)
- Pin/unpin custom pages into sidebar

**Header:**
- Left: app logo + current page title
- Right: avatar menu (account, logout) + library release badge/bell

---

## 4. Current visual character (what we're replacing)

The current theme is **functional but flat** — minimal styling, cream/warm-grey backgrounds, lime-green accent (`#a3e635`), sharp corners (`--radius-sm: 0`, `--radius-md: 0`). It reads like a developer prototype.

**What the facelift should move away from:**
- Lime-green accent — feels dated, not enterprise
- Sharp zero-radius corners on all elements
- Flat, low-contrast surfaces
- No depth or hierarchy between surfaces
- Minimal type scale variation
- Nav items look like plain links

---

## 5. Current CSS architecture

### Variable system (in `app/globals.css`, ~3,200 lines)

**Current tokens:**
```css
:root {
  --sidebar-width: 220px;
  --radius-sm: 0;
  --radius-md: 0;
}

:root[data-theme="light"] {
  --bg: #f5f3ee;        /* warm cream page background */
  --surface: #f0eee9;   /* card/panel surface */
  --surface-alt: #e8e5de;
  --ink-1: #1f1f1f;     /* primary text */
  --ink-2: #4a4a4a;
  --ink-3: #9ca3af;     /* muted */
  --accent: #a3e635;    /* lime-green — REPLACING THIS */
  --good: #10b981;
  --warn: #f59e0b;
  --error: #ef4444;
}

:root[data-theme="dark"] {
  --bg: #1f1f1f;
  --surface: #2a2a2a;
  --surface-alt: #3a3a3a;
  /* ... same semantic tokens, dark values */
}
```

### Planned theming system (designed, not yet implemented)

We have a **4-set theming architecture** planned with this variable naming convention:

```
--{mode}-{domain}-{state}-{set}
```

- **mode**: `light` or `dark`
- **set**: 1, 2, 3, or 4 (each a complete coherent palette)
- **domain**: `accent`, `primary`, `interactive`, `page-bg`, `surface-bg`, `table`, `badge`, `state-alert`, `state-priority`, `shadow`, etc.

**Draft palette sets:**
| Set | Identity | Light accent | Light primary |
|---|---|---|---|
| 1 | Orange/Amber | `#f59e0b` | `#78350f` |
| 2 | Green | `#10b981` | `#047857` |
| 3 | Blue | `#3b82f6` | `#1e40af` |
| 4 | Purple | `#8b5cf6` | `#5b21b6` |

We're open to the designer **changing these palettes entirely** for the facelift — the architecture (4 sets × light/dark) is fixed, but the actual colours are up for redesign.

### CSS methodology
- **BEM-lite** — block names like `sidebar-item`, `page-shell`, `model-preview`, `layers-editor`
- All rules in `app/globals.css` — no CSS modules, no Tailwind
- Component-specific blocks are appended to the bottom of globals.css
- No inline styles
- Utility classes allowed: `.u-mono`, `.u-truncate` etc.

---

## 6. Typography

Currently using system font stack. No custom typeface set. This is an **opportunity** — recommend a typeface pairing for the facelift (body + mono would cover 100% of use cases).

Type scale currently:
- Headings: `h1`–`h4` styled via `.page-shell__title`, `.page-shell__subtitle`, section titles
- Body: unstyled paragraphs, ~14–16px
- Monospace: `.u-mono` for IDs, keys, codes (currently falls back to system mono)

---

## 7. Key UI components to design

These are the components that appear most frequently:

### Navigation sidebar
- Collapsed (64px icon-only) + expanded (220px)
- Active state, hover state, flyout sub-menu
- Group headings
- Dev section (visual distinction from main nav)

### Page shell / content area
- Header bar with page title + subtitle + optional action buttons
- Content container (max-width, padding)

### Tables
- Used extensively: work items, layers, users, permissions, releases
- Sortable headers, row hover, drag-and-drop rows (layers table)
- Inline-editing cells (text input, textarea) — see layers table
- Confirm/cancel sticky bar at bottom of edited table
- 422 field-level error highlights on cells

### Cards
- Portfolio model cards (model picker wizard) — currently grid of cards with name/description/version/scope badges
- Adoption overlay (full-screen step-progress overlay during 7-step saga)

### Tags / badges
- `.tag` — default muted
- `.tag--good` — green success
- `.tag--muted` — grey
- `.tag--warn` — amber
- Used for: version numbers, scope labels, visibility, enabled/disabled states

### Forms
- Login form, password change, admin create-user
- Currently: clean vertical stack, no framing/card wrapper
- Labels above inputs

### Buttons
- `.btn--primary` — main action
- `.btn--secondary` — secondary action
- `.btn--danger` — destructive
- Currently: flat, no radius

### Placeholders / empty states
- `.placeholder` with `.placeholder__title` and `.placeholder__body`
- Used when loading or when content is unavailable

### Progress / overlays
- Adoption overlay: 7-step progress bar, step list with icons (pending/ok/running/fail), result summary
- SSE-driven live updates

### Library release badge
- Bell icon in header with unread count
- Blocking gate for gadmin: full-page modal blocking app access until releases acknowledged

---

## 8. What we want from the facelift

**Tone:** Professional, modern, enterprise-grade — but not sterile. It serves creative/delivery teams. Something between Linear and Notion.

**Key asks:**
1. **New accent colour** — not lime green. Something that reads authority and clarity. Consider indigo/slate-blue or a warm brand colour.
2. **Rounded corners** — move away from zero-radius. `4px` or `6px` on inputs, `6px`–`8px` on cards, `12px` on modals/overlays.
3. **Surface depth** — clearer hierarchy: page background < panel surface < card surface < elevated modal. Small box-shadows for elevation.
4. **Better nav** — the sidebar items currently look like plain rows. Give them a more polished active state (pill or left-accent-bar), better hover feedback.
5. **Type scale** — recommend a typeface pairing. Title + body weight differentiation currently minimal.
6. **Dark mode** — we fully support dark mode, needs first-class treatment. Not just an inverted light theme.
7. **Responsive** — all surfaces should work from tablet width (768px) up to widescreen (1600px+). Sidebar collapses at narrow. No horizontal scroll on the main content.

**What NOT to change:**
- The overall layout structure (header + sidebar + content) — this is wired
- The BEM CSS class naming — these names are in JSX; renaming = rework
- The variable names we already use (`--bg`, `--surface`, `--ink-1`, `--accent`, etc.) — the facelift just changes their VALUES, or maps old names to new variables

---

## 9. Deliverables requested from Claude Design

1. **Colour palette** — primary accent, primary text, surfaces (3 levels), borders, semantic states (good/warn/error), both light and dark mode
2. **Typography recommendation** — font pairing (or system stack refinement), scale (h1–h4 + body + mono)
3. **Component visual specs** — at minimum: sidebar (expanded + collapsed), table (with editing state), button set, tag/badge set, modal/overlay
4. **CSS variable values** — the new values for the existing token names (`--bg`, `--surface`, `--accent`, etc.) so the engineering implementation is a drop-in replacement
5. **Optional:** Mockup of the login page and one data-heavy page (e.g., the layers table / portfolio model page) to show the new direction end-to-end

---

## 10. Screenshots / reference

*[Attach screenshots of current state: login page, dashboard, portfolio model page with layers table, sidebar collapsed/expanded]*

The current product is running locally on `http://localhost:5101` — screenshots available on request.

---

## 11. Engineering implementation path (for context)

Once design delivers tokens + specs, the engineering approach is:

1. Update `:root[data-theme="light"]` and `:root[data-theme="dark"]` variable values in `app/globals.css`
2. Update `--radius-sm` and `--radius-md` in `:root`
3. Audit and update any hardcoded hex values in component-specific CSS blocks
4. Implement the full 4-set variable system (`--light-accent-1` etc.) if the design calls for multi-palette support
5. The JSX component code does not need to change — only CSS values

This is a **token-swap + CSS update** operation, not a component rewrite, as long as the class names stay the same.
