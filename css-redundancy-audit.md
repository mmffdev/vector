# CSS Redundancy Audit — Vector

**Date:** 2026-05-22
**Scope:** All project CSS (excluding `node_modules`, `.next`, `reference`, worktrees, `public/themes/*`, `Vector Design System/*`)
**Method:** 4 parallel Explore agents — duplicates, dead code, structural bloat, file mapping
**Status:** SURVEY ONLY — nothing modified

---

## Headline numbers

| File | Lines |
|---|---|
| `app/globals.css` | **16,967** |
| `dev/styles/dev-ui.css` | 3,027 |
| `dev/styles/dev.css` | 1,402 |
| `app/redesign/shell.css` | 850 |
| `app/global_css_vector.css` | 219 |
| `app/styles/primitives.css` | 187 |
| `app/styles/typecase.css` | 82 |
| **Project total** | **~23,200** |

| Metric | Value |
|---|---|
| Total class selectors | 2,304 |
| Used in TSX/JSX | 1,656 (71.9%) |
| **DEAD selectors (zero static refs)** | **846 (36.7%)** |
| Selectors defined 2+ times | 64 |
| Selectors defined 3+ times | 7 |
| Selectors defined 4+ times | 2 |
| `!important` usages | 34 |
| `@keyframes` blocks | 21 |
| `@media` blocks (globals.css) | 19 |
| `:root` blocks (across files) | 4+ |

**Best-case theoretical reduction:** ~36% of selectors are dead + ~200 lines of structural cleanup = realistically you could ship `globals.css` at 9,000–11,000 lines instead of 16,967 without losing anything live.

---

## Finding 1 — DEAD CODE is the biggest win (846 selectors, 36.7%)

Static analysis grepped every CSS class against every TSX/TS/JSX/HTML/JS file. **846 classes have zero references anywhere.**

### Highest-value dead families (entire visual subsystems unused)
- `.adjacency-matrix-chart__*` family — chart variants, level-1/2/3, hover, tooltips (~150 lines, globals.css ~8754–8905)
- `.concentric-arc-chart__*` family — tone variants 1–4, core, nc-chart variants
- `.artefact-node-diagram__*` family — branch, chip, row modifiers
- `.artefact-inline-form__*` family — Blocked, Container_Head variants
- `.aftd__node-label--top/bottom/left/right` — directional label variants
- `.app-footer*`, `.app-header-wrapper*`, `.app-main-column`, `.app-root`, `.app-shell`, `.app-sidebar-*` — looks like an old shell layout that's been replaced
- `.auth-card__*` variants — error-slot, mfa-prompt, notice, remember-row
- `.backlog-row__priority`, `.backlog-row__status`
- `.badge*` family — badge, badge-fixed, badge-high, badge-pass, bell-badge (likely superseded by `.pill` per design system)
- `.cf-tree__*`, `.cf-type-heading__prefix`
- `.chart-card--half/petal`, `.chart-hover-label`, `.chart-tooltip`, `.chart-widget__toolbar-*`
- `.blocking-gate` and children
- `.btn--lg`
- `.card__body`, `.card__header`
- `.accordion__chevron`, `.accordion__chevron--closed` (note: also duplicated cross-file — see Finding 2)

### Dynamic-prefix warning (DO NOT delete these without manual check)
Static analysis cannot see classes composed via template literals like `` `pill-${variant}` ``. These prefix families are RISKY to bulk-delete:
- `theme-*`, `pill-*`, `icon-*`
- `type--*` (14+ template-literal usages)
- `select-*` (10+), `label--*` (10+), `item-*` (8+)
- `size-*` (7+), `flow--*` (7+)
- `input-*`, `tab-*`, `row-*` (4–5+ each)
- `chevron-*`, `tick-*`, `ring--*`, `dot-*`, `node-*`

**Full dead-selector list:** Agent wrote it to `/tmp/truly_dead.txt` during the scan; let me know if you want me to copy that into the repo or regenerate it.

---

## Finding 2 — Duplicate selectors (64 instances, 7 defined 3+ times)

### Severe — same selector defined 3+ times
| Selector | Where |
|---|---|
| `@media (prefers-reduced-motion: reduce)` | globals.css × 8, primitives.css, dev.css (**10 total**) |
| `to` (keyframe step) | globals.css × 4 — different transforms each time |
| `from` (keyframe step) | globals.css × 3 |
| `@media (max-width: 900px)` | globals.css × 4 |
| `> .tree_accordion-dense__cell` | globals.css × 4 (lines 13517, 13623, 13627, 13632) |
| `> .drag-handle-cell` | globals.css × 4 (lines 13529, 13541, 13553, 13557) |
| `:root` | globals.css × 2, global_css_vector.css, primitives.css |
| `body` | globals.css, global_css_vector.css, typecase.css |
| `html` | globals.css, typecase.css |
| `.dashboard-grid` | globals.css × 3 (lines 3648, 3655, 3661) |

### Cross-file pollution — same class in both `globals.css` AND `dev.css`
These should live in ONE place. The dev pages should not be redefining app-level primitives:
- `.accordion`, `.accordion__item`, `.accordion__chevron`, `.accordion__toggle`, `.accordion__toggle-name`, `.accordion__chevron--closed`
- `.form__switch`
- `.num`
- `.table-wrap`
- `.table__cell--muted`

### Exact duplicates inside globals.css (copy-paste smell)
- `.page-summary__*` family — full set of 4 variants duplicated at lines 12779–12856
- `.tree_accordion-dense__createflyout*` — duplicated
- `.notification-toast`, `.notification-toast:hover` — defined twice
- `.theme-panels` — twice
- `.login-page` — twice (2899, 3236)
- `.mfa-section__label` — twice
- `.form__textarea` — twice
- `.skeleton-fade__content` — twice
- `.loader__helix_Rung_BarR`, `.loader__threedotsradial_Slot_Ghost` — animation defs repeated

**Most of these look like patch-on-patch — someone added a new block instead of editing the existing one.**

---

## Finding 3 — Structural bloat patterns

### Magic-number drift (the biggest structural win)
Top 10 hex values hardcoded where CSS vars already exist:
| Hex | Count | Should be |
|---|---|---|
| `#ffffff` | 31 | `var(--canvas-light)` / `var(--ink-contrast)` |
| `#e5e1da` | 27 | `var(--border-light)` |
| `#1a1a1a` | 24 | `var(--ink-dark)` |
| `#b91c1c` | 18 | `var(--status-danger)` |
| `#FF6600` | 10 | `var(--brand-accent)` (Vector orange) |
| `#d14343`, `#dc2626`, `#ef4444` | 6–8 each | danger family — collapse to var |
| `#94a3b8`, `#e5e7eb` | 7–8 | `var(--border)` / `var(--surface)` |
| `#5c5c5c`, `#999999` | 7–8 | mid-grey — inconsistent, pick one |

**~165 hardcoded instances total** where a var exists. Cleaning this is mechanical and makes theme switching actually work.

### Button variant explosion
`.btn--primary`, `.btn--secondary`, `.btn--ghost`, `.btn--danger`, `.btn--row-expander` (lines 1295–1354) — 5 variants × 2 states (rest + hover) = 10 rules duplicating 80% of structure, differing only by 1–2 colour vars. Should be **1 base class + 5 single-line colour modifiers**. ~60 lines → ~15.

### Duplicate `:root` + scoped redeclarations
- 2 separate `:root` blocks in globals.css (lines 8 and 53)
- `--accent` redeclared inside `.users-edit-panel__state` at lines 10963, 10966, 11530, 11534

### `!important` pile-up
34 total — at the threshold. Hotspots: `.users-edit-panel__remove-btn.btn--danger` (specificity war), and dev.css `.list-item` overrides. Both fixable by raising base specificity instead.

### Unnecessary vendor prefixes
- `-webkit-font-smoothing` + `-moz-osx-font-smoothing` (lines 26–27)
- `-webkit-user-select` (lines 8396, 9168)
- (`-webkit-line-clamp` + `::-webkit-details-marker` ARE still needed — leave them)

### Clean (no issues found)
- No empty `{ }` rule blocks
- No large commented-out dead-code blocks
- No extreme specificity nesting (`:has()` usage is modern and appropriate)

---

## Finding 4 — File structure (what's actually IN globals.css)

`app/globals.css` has **91 sections** with comment headers. Top 10 by size:

| Lines | Span | Section |
|---|---|---|
| 12861–15359 | **2,499** | GridTree — generic dense-spreadsheet tree catalog |
| 10757–12860 | 2,104 | Workspace Settings → Users tab (accordion-style table) |
| 9366–10756 | 1,391 | Work Items — tree grid + detail panel |
| 15360–16130 | 771 | Transition Rules — Orbit View |
| 4579–5185 | 607 | Navigation preferences |
| 1249–1723 | 475 | Buttons |
| 2895–3338 | 444 | Login page |
| 176–581 | 406 | Sidebar |
| 2545–2894 | 350 | Auth pages |
| 906–1248 | 343 | Page body shell |

### Sections that should NOT live in globals.css (extract to component CSS)
Feature-specific sections that are pure component scope:
1. **SliderToggle (PillToggle)** — 216 lines (9150–9365)
2. **ChartWidget** — 189 lines (3801–3989)
3. **QR code + trigger popover** — 162 lines (16131–16292)
4. **AdjacencyMatrix chart** — 152 lines (8754–8905) ← **probably dead per Finding 1**
5. **Portfolio graph chart** — 151 lines (8314–8464)

### The chart cluster
ALL chart variants (Raydale, Donut, Heatmap, SankeyFlow, Ladder, Journey dome, PercentileDot, AdjacencyMatrix, ConcentricArc, etc.) live between **lines 3700–8929 — ~5,200 lines total**. Many are dead (Finding 1). The live ones should move to co-located component CSS.

### dev-ui.css structure
- 1–2052: Dev Setup shell + workspace switcher
- 2053–3027: Visualiser shell + V2 dashboard controls
- No `@media` queries (no responsive design — dev pages are desktop-only)

---

## Recommended attack order (highest ROI → lowest)

| # | Action | Est. lines saved | Risk |
|---|---|---|---|
| 1 | Delete confirmed-dead chart families (`adjacency-matrix-chart__*`, `concentric-arc-chart__*`, `artefact-node-diagram__*`) | ~500–800 | LOW — verify charts not used in dev/storybook first |
| 2 | Delete dead `app-*` shell selectors (`app-footer`, `app-header-wrapper`, `app-main-column`, `app-root`, `app-shell`, `app-sidebar-*`) | ~200–300 | LOW — these look like an old layout |
| 3 | Delete dead `auth-card__*`, `backlog-row__*`, `cf-tree__*`, `blocking-gate*`, `badge*` (NOT `.pill`) | ~200 | LOW |
| 4 | Dedupe cross-file accordion + table primitives (move from `dev.css` → import globals) | ~80 | LOW |
| 5 | Dedupe within-file copy-pastes (`.page-summary__*`, `.notification-toast`, `.login-page`, `.theme-panels`, `.form__textarea`, etc.) | ~150 | LOW |
| 6 | Collapse button variants to base + 5 colour modifiers | ~45 | LOW |
| 7 | Migrate top-5 magic hex values to existing CSS vars | ~165 instances (lines not saved, but theme-correct) | MEDIUM — touches many files |
| 8 | Extract chart components to co-located CSS modules | net 0 lines, but globals.css shrinks ~3,000–4,000 | MEDIUM — needs build config check |
| 9 | Audit dynamic-prefix families manually (`theme-*`, `pill-*`, `type--*`, etc.) — confirm which are truly used | unknown — could be another 200–500 dead | MEDIUM — slow, requires reading TSX |
| 10 | Consolidate duplicate `:root` blocks + `--accent` redeclarations | ~30 | LOW |

**Realistic target:** `app/globals.css` from **16,967 → ~10,000 lines** (40% reduction) without losing live functionality, plus dev.css cross-file pollution cleared.

---

## What this audit did NOT do
- Did not actually run any of the dead classes against a running build (no Stylelint coverage report)
- Did not check `dangerouslySetInnerHTML` / server-rendered HTML / email templates for class usage
- Did not inspect `Vector Design System/` or `public/themes/*` — out of scope
- Did not check Storybook / Playwright snapshots for visual regressions
- Did not deduplicate the `@font-face` block (5 duplicates at `global_css_vector.css:10,15,20,25,30` — these are usually intentional, one per weight)

Before deleting anything, recommend: run the app, exercise the main user-facing pages and Dev pages, AND grep the candidate selectors one more time against any `.html` / `.md` / server-template files I might have missed.
