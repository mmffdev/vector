# Vector Design System

**MMFFDev Vector** — A design system for enterprise SaaS that doesn't feel enterprise.

> Vector is the platform. The design system is its grammar. This document defines the rules so that every product surface — across customers, products, and personal preferences — feels unmistakably *Vector*.

---

## 1. Design principles

These are the decisions we make before we make any other decisions.

**Calm over loud.** White space is not empty space — it's the canvas that lets meaning surface. If a screen feels busy, remove something.

**Flat, not flatfooted.** No drop shadows, no gradients, no chrome. Hierarchy comes from typography, colour weight, and spacing — never from depth tricks.

**Confident neutrals, restrained colour.** The interface lives in warm greys and near-blacks. Colour is reserved for status, action, and identity — used like punctuation, not paint.

**Clarity is hierarchy.** Three branding tiers (platform, tenant, product) must coexist without competing. The user always knows where they are without having to read the page.

**Built to be themed.** Every visual decision is a token. A tenant's brand should be able to flow through the system without breaking it.

---

## 2. Branding hierarchy

Vector operates at three identity tiers, plus a personal preference layer. The system must accommodate all four without visual conflict.

| Tier | Owner | Visibility | Purpose |
|---|---|---|---|
| **Platform** | MMFFDev Vector | Persistent, subtle | Trust mark — "you're on Vector" |
| **Tenant** | The customer organisation | Prominent in chrome | "This is your workspace" |
| **Product** | Individual product line within a tenant | Contextual accent | "You're working in [Product]" |
| **Personal** | The end user | Theme-level only | Light/dark/custom preference |

**Rule of one accent.** Only one tier expresses colour at a time in any given region of the UI. The other tiers express through typography, position, or monochrome marks. This is what stops the three-tier system from becoming a clown car.

### Where each tier lives

- **Platform** — bottom-left of the sidebar (small wordmark), login screens, system emails, error pages.
- **Tenant** — top of the sidebar, primary brand expression. Logo, name, optional accent.
- **Product** — page header eyebrow, breadcrumb root, optional product-specific accent on key surfaces (active tab indicators, primary CTAs *within* that product only).
- **Personal** — applies the theme variant (light/dark/custom) but never overrides tenant or product brand colour.

---

## 3. Colour

### 3.1 Foundation palette

The foundation is warm-neutral, not cool. Pure white feels clinical; we want classy, not clinical.

```
--canvas         #F4F2EE    /* Warm off-white app background */
--surface        #FFFFFF    /* Card, panel, modal surface */
--surface-sunken #EDEAE4    /* Subtle inset areas, table headers */

--ink            #1A1A1A    /* Primary text, primary action fill */
--ink-muted      #5C5C5C    /* Secondary text, icons */
--ink-subtle     #8A8A8A    /* Tertiary text, placeholders */
--ink-faint      #B8B5AF    /* Disabled, dividers when borders are too strong */

--border         #E5E1DA    /* Hairline borders, table rules */
--border-strong  #D4CFC5    /* Input borders, emphasised separation */
```

The canvas-vs-surface contrast is what creates separation between regions — this is how we get away with no shadows.

### 3.2 Status palette

Status colours are muted. They communicate, they don't shout.

```
--success        #2F7D54    /* Pill text/icon */
--success-bg    #E5F0E9    /* Pill background */

--warning        #B7791F    /* Amber, not orange */
--warning-bg    #FBEFD4

--danger         #B23B3B    /* Brick, not fire-engine */
--danger-bg     #F5E1DE

--info           #2F5F8A
--info-bg       #E1ECF5
```

Status colour usage rules:

- Always paired with a label or icon — never colour alone (accessibility).
- Always rendered as a pill with rounded corners, never a bare swatch.
- Never used for branding, decoration, or product/tenant identity.

### 3.3 Brand tokens (themeable)

These are the slots tenants and products fill. The defaults below are the **Vector platform defaults** — used when no tenant brand is set.

```
--brand-tenant            #1A1A1A    /* Defaults to ink — tenant overrides */
--brand-tenant-contrast   #FFFFFF    /* Text colour on tenant fill */

--brand-product           #1A1A1A    /* Defaults to ink — product overrides */
--brand-product-contrast  #FFFFFF
```

**Contract for tenant/product overrides:**

1. Must pass WCAG AA against `--surface` (4.5:1 for body, 3:1 for large text).
2. Must define both fill and contrast token together.
3. May not override status, canvas, or ink tokens.
4. If contrast cannot be guaranteed, the system falls back to ink.

### 3.4 Dark theme (personal preference)

Dark mode inverts foundation tokens but preserves status and brand semantics.

```
--canvas         #1A1816
--surface        #232120
--surface-sunken #1F1D1B

--ink            #F4F2EE
--ink-muted      #B0ADA6
--ink-subtle     #8A8780
--ink-faint      #4A4744

--border         #2E2B28
--border-strong  #3D3A36
```

---

## 4. Typography

### 4.1 Type families

```
--font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-display: 'Inter', system-ui, sans-serif;    /* same family, used for hierarchy */
--font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
--font-numeric: 'Inter', system-ui, sans-serif;    /* with tabular-nums */
```

Inter is the workhorse. We use a single sans family across the system — variation comes from weight and size, not from juggling fonts. **For all numeric data (metrics, tables, charts), apply `font-variant-numeric: tabular-nums`** so figures align in columns.

### 4.2 Type scale

```
--text-xs    11px / 16px    /* Micro-labels, all-caps eyebrow text */
--text-sm    13px / 20px    /* Secondary UI, table cells, helper text */
--text-base  14px / 22px    /* Body, default UI text */
--text-md    16px / 24px    /* Emphasised body */
--text-lg    20px / 28px    /* Card titles, section headings */
--text-xl    28px / 36px    /* Page titles, key metrics */
--text-2xl   36px / 44px    /* Display metrics, dashboard hero numbers */
```

### 4.3 Weights

```
--weight-regular  400
--weight-medium   500
--weight-semibold 600
--weight-bold     700
```

We rarely go above semibold. Bold is reserved for display numbers and emphatic states.

### 4.4 Treatments

- **Eyebrow / micro-labels** — `--text-xs`, `--weight-medium`, `letter-spacing: 0.08em`, `text-transform: uppercase`, `color: --ink-subtle`. Used for "TOTAL REVENUE", "RECENT TRANSACTIONS", section dividers in long pages.
- **Page title** — `--text-xl`, `--weight-semibold`, `--ink`.
- **Card title** — `--text-lg`, `--weight-semibold`, `--ink`.
- **Body** — `--text-base`, `--weight-regular`, `--ink`.
- **Metadata / helper** — `--text-sm`, `--weight-regular`, `--ink-muted`.
- **Display metric** — `--text-2xl`, `--weight-semibold`, `--ink`, tabular-nums.

---

## 5. Spacing & layout

### 5.1 Spacing scale (4px base)

```
--space-0   0
--space-1   4px
--space-2   8px
--space-3   12px
--space-4   16px
--space-5   20px
--space-6   24px
--space-8   32px
--space-10  40px
--space-12  48px
--space-16  64px
```

### 5.2 Density

Vector uses a **comfortable** default density — not cramped, not lounge. Card internal padding is `--space-6` (24px). Table row height is 48px. Form input height is 40px.

A future `--density-compact` token may reduce these by ~20%, but it's not in v1.

### 5.3 Grid

- App shell uses a fixed left sidebar (240px collapsed: 64px) and a fluid main canvas.
- Main canvas has a max content width of 1440px and side gutters of `--space-6` minimum.
- Card grids use 12 columns with a `--space-6` gutter.

---

## 6. Radii & borders

```
--radius-sm   6px    /* Pills, small inputs */
--radius-md   8px    /* Buttons, inputs */
--radius-lg   12px   /* Cards, modals, panels */
--radius-xl   16px   /* Hero surfaces, large containers */
--radius-full 9999px /* Status pills, avatars */

--border-width   1px
```

No shadows. Ever. If you find yourself needing a shadow to create separation, the answer is more whitespace, a stronger border colour, or a different surface tone.

---

## 7. Iconography

- **Library:** Lucide (or matched-stroke equivalent).
- **Stroke weight:** 1.5px at 16px and 20px sizes; 2px at 24px+.
- **Sizes:** 14, 16, 20, 24px. Default is 16px in dense UI, 20px in primary nav.
- **Colour:** inherits `currentColor`. Never coloured for decoration; only when paired with a status semantic.

---

## 8. Components

This section defines the canonical components. Each will get its own detailed spec, but the shape is set here.

### 8.1 Buttons

| Variant | Use | Visual |
|---|---|---|
| **Primary** | The single most important action on a screen | `--ink` fill, white text, `--radius-md` |
| **Secondary** | Common actions | `--surface` fill, `--border-strong` border, `--ink` text |
| **Ghost** | Tertiary, in-row, toolbar | Transparent, `--ink-muted` text, hover surfaces to `--surface-sunken` |
| **Danger** | Destructive | `--danger` fill, white text — confirmation required |

- Heights: 32 (sm), 40 (md, default), 48 (lg).
- Padding: 12 / 16 / 20 horizontal.
- Icon-only buttons are square at the same heights.
- Only **one** primary button per screen region.

### 8.2 Cards

The workhorse container.

- Surface: `--surface`.
- Border: `1px solid --border`.
- Radius: `--radius-lg`.
- Padding: `--space-6`.
- No shadow. Separation comes from canvas contrast.
- Card header pattern: eyebrow micro-label + optional inline action / overflow menu, then content.

### 8.3 Inputs

- Height: 40px.
- Border: `1px solid --border-strong`.
- Radius: `--radius-md`.
- Background: `--surface`.
- Focus: 2px outline in `--ink` at 2px offset (or brand-tenant if defined and contrast permits).
- Placeholder: `--ink-subtle`.
- No inset shadows.

### 8.4 Tables

- Header row: `--surface-sunken` background, `--text-xs` uppercase eyebrow labels in `--ink-muted`, sortable indicators inline.
- Body rows: `--surface` with `1px solid --border` bottom rule. No vertical rules.
- Row height: 48px default.
- Hover: row background to `--surface-sunken`.
- Checkboxes left, actions right (overflow menu).

### 8.5 Status pills

- Radius: `--radius-full`.
- Padding: 2px 8px.
- Font: `--text-xs`, `--weight-medium`.
- Always icon + label. Background `*-bg`, text `*` (the foreground status colour).

### 8.6 Sidebar navigation

- Width: 240px expanded, 64px collapsed.
- Background: `--surface`.
- Right border: `1px solid --border`.
- **Tenant block at top:** logo + tenant name, separated by `1px solid --border` underneath.
- **Section labels:** `--text-xs` uppercase eyebrow in `--ink-subtle`, `--space-3` top margin.
- **Item:** 36px tall, icon + label, `--ink-muted` text, `--ink` on active.
- **Active state:** `--surface-sunken` background, `--ink` text. *No* coloured indicator bar — the tone shift is enough.
- **Personal block at bottom:** avatar + name + role.

### 8.7 Charts

- Bars and lines default to `--ink`. Comparison series use `--ink-muted`.
- Gridlines: `--border` at 50% opacity, dashed.
- Axis labels: `--text-xs`, `--ink-subtle`.
- Tooltip: white card, `--radius-md`, `1px solid --border`, no shadow.
- **Brand colour is not used in charts.** This keeps charts comparable across tenants and prevents accessibility surprises when a tenant brand is low-contrast.

---

## 9. Theming model

```
Layer 1: Foundation tokens   →  Same for everyone
Layer 2: Personal theme      →  Light / Dark / High-contrast
Layer 3: Tenant brand        →  --brand-tenant + contrast
Layer 4: Product brand       →  --brand-product + contrast (scoped)
```

Each layer can only override what the layer below it explicitly exposes. A product cannot override foundation. A tenant cannot override personal contrast preferences.

**Implementation:** CSS custom properties scoped at `:root`, `[data-theme]`, `[data-tenant]`, `[data-product]`. Resolution is deterministic and cascades by specificity.

---

## 10. Accessibility floor

Non-negotiable.

- WCAG 2.2 AA minimum across all default themes.
- All interactive elements have a visible focus state with at least 3:1 contrast against their background.
- Status is never communicated by colour alone.
- Minimum touch target: 40×40px.
- Motion respects `prefers-reduced-motion`.
- Tenant brand overrides are validated against contrast at the point of configuration, not at render.

---

## 11. What this system is *not*

To stay on-brand, we explicitly avoid:

- Drop shadows, glows, neumorphism.
- Gradient fills on UI chrome (illustrations are fine in moderation).
- Decorative colour. Colour earns its place by carrying meaning.
- More than one accent colour active in the same region.
- Iconography from mixed libraries.
- Bold/heavy weights as a default — they're a tool, not a tone.

---

## 12. Open questions

These are the calls we still need to make:

1. **Platform brand colour.** We're defaulting to ink (`#1A1A1A`) for v1, which keeps the platform identity quiet and lets tenants take the foreground. Do we want a Vector signature accent (used only on platform surfaces — login, system emails) to give MMFFDev some ownable colour equity?
2. **Display font.** Inter throughout is the safe choice. A subtly distinctive display face (e.g. a geometric sans for page titles only) could give Vector more personality without breaking the calm.
3. **Density variants.** Compact mode for power users — v1 or v2?
4. **Tenant brand on charts.** Currently disallowed. Revisit if customer feedback says they want it (with a strict contrast gate).
5. **Illustration style.** Empty states, onboarding, marketing — flat geometric? Editorial line art? Worth defining before product teams pick their own.
