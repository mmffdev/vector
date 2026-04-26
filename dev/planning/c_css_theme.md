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

## Example: Set 1 Variables (Light Mode)

All variables for Set 1 in light theme follow the naming pattern. A partial example:

```css
/* Core colors */
--light-accent-1: #f59e0b;
--light-primary-1: #78350f;
--light-interactive-1: #ea580c;
--light-p-1: #fef3c7;

/* Typography */
--light-h1-1: #1f1f1f;
--light-h2-1: #1f1f1f;
/* ... h3–h6 ... */

/* Borders */
--light-border-style-constant-1: 1px solid #d1d5db;
--light-border-style-dashed-1: 1px dashed #d1d5db;
--light-border-style-dotted-1: 1px dotted #d1d5db;

/* Links */
--light-link-link-1: #f59e0b;
--light-link-visited-1: #92400e;
--light-link-hover-1: #ea580c;
--light-link-active-1: #b45309;

/* Page backgrounds */
--light-page-bg-standard-1: #f5f3ee;
--light-page-bg-alternate-1: #f0eee9;
--light-page-bg-negative-1: #fee2e2;
--light-page-bg-positive-1: #dcfce7;

/* ... and so on for other domains ... */
```

Repeat this pattern for **light Sets 2, 3, 4** and **dark Sets 1, 2, 3, 4**.
--light-page-border-positive-1
--light-page-border-top-standard-1
--light-page-border-top-secondary-1
--light-page-border-top-highlight-1
--light-page-border-top-important-1
--light-page-border-left-standard-1
--light-page-border-left-secondary-1
--light-page-border-left-highlight-1
--light-page-border-left-important-1
--light-page-border-bottom-standard-1
--light-page-border-bottom-secondary-1
--light-page-border-bottom-highlight-1
--light-page-border-bottom-important-1
--light-accent-border-left-standard-1
--light-accent-border-left-secondary-1
--light-accent-border-left-highlight-1
--light-accent-border-left-important-1
--light-surface-form-1
--light-surface-input-1
--light-surface-model-1
--light-feedback-tooltip-A-1
--light-feedback-tooltip-B-1
--light-feedback-tooltip-C-1
--light-feedback-tooltip-D-1
--light-surface-bg-standard-1
--light-surface-bg-alternative-1
--light-surface-bg-negative-1
--light-surface-bg-positive-1
--light-surface-hover-standard-1
--light-surface-hover-alternative-1
--light-surface-hover-negative-1
--light-surface-hover-positive-1
--light-surface-border-standard-1
--light-surface-border-alternative-1
--light-surface-border-negative-1
--light-surface-border-positive-1
--light-accent-border-standard-1
--light-accent-border-alternative-1
--light-accent-border-negative-1
--light-accent-border-positive-1
--light-accent-border-top-standard-1
--light-accent-border-top-alternative-1
--light-accent-border-top-negative-1
--light-accent-border-top-positive-1
--light-accent-border-left-standard-1
--light-accent-border-left-alternative-1
--light-accent-border-left-negative-1
--light-accent-border-left-positive-1
--light-accent-border-bottom-standard-1
--light-accent-border-bottom-alternative-1
--light-accent-border-bottom-negative-1
--light-accent-border-bottom-positive-1
--light-table-1
--light-table-row-header-1
--light-table-row-sub-header-1
--light-table-row-odd-1
--light-table-row-even-1
--light-table-row-footer-1
--light-table-col-header-1
--light-table-col-sub-header-1
--light-table-col-odd-1
--light-table-col-even-1
--light-table-col-footer-1
--light-table-filter-bg-1
--light-table-filter-border-1
--light-table-filter-text-1
--light-table-filter-clear-hover-1
--light-table-filter-link-1
--light-table-filter-visited-1
--light-table-filter-hover-1
--light-table-filter-active-1
--light-table-pagination-bg-1
--light-table-pagination-border-1
--light-table-pagination-text-1
--light-table-pagination-clear-hover-1
--light-table-pagination-link-1
--light-table-pagination-visited-1
--light-table-pagination-hover-1
--light-table-pagination-active-1
--light-table-drag-placeholder-bg-1
--light-table-drag-placeholder-border-1
--light-table-drag-placeholder-dashed-1
--light-table-drag-ghost-bg-1
--light-table-drag-ghost-border-1
--light-table-search-bg-1
--light-table-search-border-1
--light-table-search-text-1
--light-table-search-clear-hover-1
--light-progress-bar-bg-1
--light-progress-bar-fill-1
--light-progress-bar-complete-1
--light-progress-bar-blocked-1
--light-progress-bar-frame-bg-1
--light-progress-bar-frame-border-1
--light-progress-spinner-bg-1
--light-progress-spinner-border-1
--light-shadow-sm-1
--light-shadow-md-1
--light-shadow-lg-1
--light-shadow-focus-1
--light-badge-A-1
--light-badge-B-1
--light-badge-C-1
--light-badge-D-1
--light-badge-E-1
--light-badge-F-1
--light-badge-G-1
--light-badge-A-border-1
--light-badge-B-border-1
--light-badge-C-border-1
--light-badge-D-border-1
--light-badge-E-border-1
--light-badge-F-border-1
--light-badge-G-border-1
--light-state-alert-10-1
--light-state-alert-09-1
--light-state-alert-08-1
--light-state-alert-07-1
--light-state-alert-06-1
--light-state-alert-05-1
--light-state-alert-04-1
--light-state-alert-03-1
--light-state-alert-02-1
--light-state-alert-01-1
--light-state-priority-10-1
--light-state-priority-09-1
--light-state-priority-08-1
--light-state-priority-07-1
--light-state-priority-06-1
--light-state-priority-05-1
--light-state-priority-04-1
--light-state-priority-03-1
--light-state-priority-02-1
--light-state-priority-01-1

 Pattern repeats 4 time, such **-1, **-2, **3, **4 Also Dark such as —dark-**




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
