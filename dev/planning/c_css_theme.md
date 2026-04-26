# CSS Theming System — 4-Color Palette Strategy

## Overview

Replace hardcoded color names (`--hot-pink`, `--accent`, etc.) with a semantic, scalable theming system. All colors are organized by **theme set** (1, 2, 3, 4) and **mode** (light/dark), eliminating brittle literal-color dependencies.

## Architecture

**Variable naming:** `--{mode}-{domain}-{state}-{set}`

Examples:
- `--light-accent-1` — accent color, light theme, set 1
- `--dark-primary-2` — primary color, dark theme, set 2
- `--light-page-bg-standard-3` — page background (standard state), light theme, set 3
- `--dark-table-row-odd-4` — table row background (odd rows), dark theme, set 4

Each set (1, 2, 3, 4) is a complete, coherent color palette for accent, primary, interactive, and typography.

## Domain Categories

### Core Colors (4 per set)
- `--{mode}-accent-{set}` — highlight/action color
- `--{mode}-primary-{set}` — main content color
- `--{mode}-interactive-{set}` — button/link active state
- `--{mode}-p-{set}` — base palette/neutral

### Typography (6 per set, per mode)
- `--{mode}-h1-{set}`, `--{mode}-h2-{set}`, ..., `--{mode}-h6-{set}`

### Borders (border-style + directional variants)
- `--{mode}-border-style-constant-{set}` — solid borders
- `--{mode}-border-style-dashed-{set}` — dashed borders
- `--{mode}-border-style-dotted-{set}` — dotted borders
- Page borders: `--{mode}-page-border-{direction}-{state}-{set}`
  - Directions: `standard`, `alternate`, `negative`, `positive`
  - Also: `top`, `left`, `bottom` variants
  - Accent variants: `--{mode}-accent-border-{direction}-{state}-{set}`

### Links (4 states per set)
- `--{mode}-link-link-{set}` — unvisited link
- `--{mode}-link-visited-{set}` — visited link
- `--{mode}-link-hover-{set}` — hover state
- `--{mode}-link-active-{set}` — active/current state

### Page Backgrounds (4 states per set)
- `--{mode}-page-bg-standard-{set}` — default page background
- `--{mode}-page-bg-alternate-{set}` — alternate (secondary) background
- `--{mode}-page-bg-negative-{set}` — error/warning background
- `--{mode}-page-bg-positive-{set}` — success background

### Surface/Component Backgrounds (4 states per set)
- `--{mode}-surface-bg-standard-{set}` — card/component background
- `--{mode}-surface-bg-alternative-{set}` — alternate surface
- `--{mode}-surface-bg-negative-{set}` — negative state surface
- `--{mode}-surface-bg-positive-{set}` — positive state surface
- `--{mode}-surface-hover-{standard|alternative|negative|positive}-{set}`
- `--{mode}-surface-border-{standard|alternative|negative|positive}-{set}`

### Forms
- `--{mode}-surface-form-{set}` — form container background
- `--{mode}-surface-input-{set}` — input field background
- `--{mode}-surface-model-{set}` — modal/overlay background

### Feedback/Tooltips (4 variants per set)
- `--{mode}-feedback-tooltip-A-{set}` through `--{mode}-feedback-tooltip-D-{set}`

### Tables (extensive)
- `--{mode}-table-{set}` — base table color
- Row variants: `header`, `sub-header`, `odd`, `even`, `footer`
- Column variants: `header`, `sub-header`, `odd`, `even`, `footer`
- Filter: `bg`, `border`, `text`, `clear-hover`, `link`, `visited`, `hover`, `active`
- Pagination: `bg`, `border`, `text`, `clear-hover`, `link`, `visited`, `hover`, `active`
- Drag: `placeholder-bg`, `placeholder-border`, `placeholder-dashed`, `ghost-bg`, `ghost-border`
- Search: `bg`, `border`, `text`, `clear-hover`

### Progress Indicators (3 types per set)
- Bar: `bg`, `fill`, `complete`, `blocked`, `frame-bg`, `frame-border`
- Spinner: `bg`, `border`

### Shadows (4 per set)
- `--{mode}-shadow-sm-{set}` — small shadow
- `--{mode}-shadow-md-{set}` — medium shadow
- `--{mode}-shadow-lg-{set}` — large shadow
- `--{mode}-shadow-focus-{set}` — focus ring shadow

### Badges (7 variants per set, each with border variant)
- `--{mode}-badge-A-{set}` through `--{mode}-badge-G-{set}`
- `--{mode}-badge-A-border-{set}` through `--{mode}-badge-G-border-{set}`

### State Indicators (10-level severity scale per set)
- Alert levels: `--{mode}-state-alert-10-{set}` (critical) through `--{mode}-state-alert-01-{set}` (minimal)
- Priority levels: `--{mode}-state-priority-10-{set}` (critical) through `--{mode}-state-priority-01-{set}` (minimal)

## Implementation Strategy

### Phase 1: Core Variables
1. Define all 4 sets in `:root[data-theme="light"]` and `:root[data-theme="dark"]`
2. Use perceptually distinct color palettes for each set:
   - **Set 1:** Orange/Amber (current `--warn: #f59e0b` base)
   - **Set 2:** Green (current `--good: #10b981` base)
   - **Set 3:** Blue (new, e.g., `#3b82f6`)
   - **Set 4:** Purple (new, e.g., `#8b5cf6`)
3. Generate 4-level tints/shades for each base color (for `standard`, `alternative`, `negative`, `positive` variants)

### Phase 2: CSS Class Generators
Create utility classes that reference theme sets:
```css
.theme-set-1 { --active-set: 1; }
.theme-set-2 { --active-set: 2; }
/* etc. */
```

Components then use: `var(--light-accent-[set])` or compute dynamically via CSS variables.

### Phase 3: Page Migration
Audit all hardcoded colors (`--hot-pink`, `--accent`, `--warn`, etc.) and map to semantic variables:
- `--hot-pink` → `--{mode}-interactive-{set}`
- `--accent` → `--{mode}-accent-{set}`
- `--warn` → `--{mode}-state-alert-{set}`
- etc.

### Phase 4: Component Registry
Document which theme set each component/page uses by default. Allow per-page override via `data-theme-set` attribute.

## Color Palette Definitions (Draft)

### Set 1: Orange/Amber
- **Light mode:**
  - Accent: `#f59e0b` (warm orange)
  - Primary: `#78350f` (dark brown)
  - Interactive: `#ea580c` (bright orange)
  - P (palette): `#fef3c7` (light amber)
- **Dark mode:**
  - Accent: `#fbbf24` (bright amber)
  - Primary: `#fca311` (orange)
  - Interactive: `#f59e0b` (standard orange)
  - P: `#451a03` (dark brown)

### Set 2: Green
- **Light mode:**
  - Accent: `#10b981` (emerald)
  - Primary: `#047857` (dark green)
  - Interactive: `#059669` (medium green)
  - P: `#d1fae5` (light mint)
- **Dark mode:**
  - Accent: `#6ee7b7` (light green)
  - Primary: `#10b981` (emerald)
  - Interactive: `#34d399` (bright green)
  - P: `#064e3b` (dark green)

### Set 3: Blue
- **Light mode:**
  - Accent: `#3b82f6` (bright blue)
  - Primary: `#1e40af` (dark blue)
  - Interactive: `#2563eb` (medium blue)
  - P: `#dbeafe` (light blue)
- **Dark mode:**
  - Accent: `#93c5fd` (light blue)
  - Primary: `#3b82f6` (bright blue)
  - Interactive: `#60a5fa` (sky blue)
  - P: `#0c2340` (dark blue)

### Set 4: Purple
- **Light mode:**
  - Accent: `#8b5cf6` (purple)
  - Primary: `#5b21b6` (dark purple)
  - Interactive: `#7c3aed` (violet)
  - P: `#ede9fe` (light lavender)
- **Dark mode:**
  - Accent: `#c4b5fd` (light purple)
  - Primary: `#8b5cf6` (purple)
  - Interactive: `#a78bfa` (light violet)
  - P: `#3f0f63` (dark purple)

## File Structure

- `app/globals.css` — CSS variable definitions (root, light, dark)
- `app/components/ThemeProvider.tsx` — React context for theme set selection
- `docs/c_css_theme.md` — User-facing documentation
- `dev/planning/c_css_theme_usage.md` — Migration checklist and per-page assignments

## Next Steps

1. ✅ Plan (this document)
2. Define all CSS variables in `app/globals.css`
3. Create utility classes for theme set activation
4. Audit current hardcoded colors
5. Migrate components incrementally
6. Document component → theme set assignments
