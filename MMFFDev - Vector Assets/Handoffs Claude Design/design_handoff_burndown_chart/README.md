# Handoff: Sprint Burndown chart — “Filled trend, re-baselined, with forecast cone”

## Overview
This is a single **sprint burndown chart** for the Vector platform’s Reporting area. It plots
**story points remaining** over a two-week sprint (10 working days) and answers one question at a
glance: *are we going to finish the committed work by the last day?*

It is the “Filled trend” treatment (gradient area under the actual line) combined with two extra
behaviours the team asked for:

- the **forecast cone** — a shaded band between an optimistic and a pessimistic projection from
  “today” to the end of the sprint;
- the **scope re-baseline** treatment — when artefacts are added/removed mid-sprint, the ideal
  guideline re-baselines, the change is pinned on the chart (e.g. “+12”), the region after the
  change is shaded, and the *original* guideline is left faint behind the adjusted one.

> Lineage, for reference against the prototype gallery: base = **Burndown 02 (Filled trend)**,
> cone = **Burndown 04 (Forecast cone)**, scope treatment = **Burndown 06 (Scope re-baseline)**.

---

## About the design files
The files in `reference/` are a **design reference created in HTML** — a working prototype that
shows the intended look and behaviour. They are **not production code to drop in**. Your task is to
**recreate this chart in the target codebase’s existing environment** (the Vector app is Next.js 15 +
React 18 with hand-written CSS — no Tailwind, no component library), using its established patterns.
If you are starting fresh with no environment, pick the most appropriate stack and implement it there.

The prototype renders with **hand-built SVG** (no chart library) so the math and the exact visual
treatment are fully transparent and portable. You may keep that approach, or map it onto whatever
charting primitive the codebase already uses (e.g. visx, D3, or raw SVG) — but the **series math in
`reference/data.js` is the source of truth** and should be ported verbatim.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, dash patterns, and interaction are all
specified below and in the reference files. Recreate it pixel-faithfully using the Vector design
system tokens. Where this README gives a hex value, it is the resolved value of a Vector token —
prefer the **token** in code (see *Design tokens*).

---

## The one screen / view

### Name
Sprint burndown card.

### Purpose
A reader (PM, scrum master, team) scans the card to see remaining work vs. the ideal pace, whether a
mid-sprint scope change happened, and whether current velocity will clear the backlog by the sprint
end. Hovering reads off exact values for any day.

### Layout
A standard **Vector card**: white `--surface` on warm `--canvas`, 1px `--border` hairline,
`--radius-lg` (12px) corners, `--space-6` (24px) padding, **no shadow**. Vertical stack:

1. **Card head** — eyebrow micro-label, title, one-line description.
2. **KPI strip** — a horizontal row of labelled metrics, with a status pill pushed to the right.
3. **Chart** — full card width, responsive; the prototype draws into a `560 × 300` SVG `viewBox`
   scaled to 100% width.
4. **Legend** — a top-bordered row of dot + label pairs for each visible series.

Recommended container width ≈ 560–640px; the chart scales fluidly below that.

### Chart geometry (exact, from the prototype)
- SVG `viewBox="0 0 560 300"`, `width:100%`, `height:300`.
- Plot insets: **left 38, right 16, top 16, bottom 26** (px in viewBox units).
- **X axis** — sprint days 0…10. Day 0 is labelled `S` (sprint start); days 1–10 are numeric.
  X position: `plotL + (day / 10) * plotW`.
- **Y axis** — 0…100 story points, ticks at **0, 20, 40, 60, 80, 100**. Y position:
  `plotT + (1 - val/100) * plotH`.
- **Gridlines** — horizontal, `--border` stroke; the `0` baseline is solid full-opacity, the rest
  are dashed `3 3` at ~55% opacity. Y tick labels are `--text-xs`, `--ink-subtle`, right-aligned 8px
  left of the axis. X labels are centred, `--ink-subtle`, 8px above the bottom edge.

### Components (each visual element, exact)

**1. Actual remaining line + gradient fill** (the hero series)
- Smoothed (Catmull-Rom → cubic Bézier) line through the remaining-points values for **Day 0…7**.
- Stroke `--danger` red `#E5392B`, width **2.6px**, round joins/caps.
- Open circle **markers** at each day: r=3, white fill, 2px red stroke.
- Area beneath the line filled with a **vertical linear gradient** of the same red:
  `0% → rgba(229,57,43,0.26)` fading to `100% → rgba(229,57,43,0.02)`. Area closes down to the y=0
  baseline.

**2. Ideal / optimum guideline (re-baselined)**
- Dashed `6 5`, **1.75px**, colour `--ink` `#1A1A1A` at ~70% opacity. Straight segments (not smoothed).
- **Two segments with a deliberate break at the scope day (Day 5):**
  - Segment A, Day 0→5, on the *original* slope (80 ÷ 10 = 8 pts/day): 80, 72, 64, 56, 48, 40.
  - Break (no line drawn across the step).
  - Segment B, Day 5→10, from the re-based value down to 0: start = 40 + 12 = **52**, slope = 52 ÷ 5
    = 10.4/day → 52, 41.6, 31.2, 20.8, 10.4, 0.

**3. Faint original guideline** (only shown when a scope change is active)
- The pre-change straight 80→0 line, drawn underneath the re-based one so the reader can see how the
  goalpost moved. Colour `--ink-subtle`, **1.25px**, dashed `2 4`, **opacity 0.4**, not smoothed.

**4. Scope-change region + pin**
- A subtle **shaded rectangle** over the plot from the scope day (Day 5) to the right edge:
  fill `rgba(26,26,26,0.025)` (light) — just enough to read as “after the change”.
- A **vertical dashed line** at Day 5 (`3 3`, scope-blue `#2F5F8A`, ~0.6 opacity) from top to baseline.
- A **pin**: filled blue `#2F5F8A` circle (r=8) near the top of that line, white bold `9px` label
  reading the delta, e.g. **“+12”**.

**5. Forecast cone (optimistic ↔ pessimistic)**
- Both projections start at **today’s remaining value (Day 7 = 44)** and fan to the sprint end:
  - **Optimistic** clears the work evenly to **0 at Day 10** (dotted `1 5`, **1.75px**, `--success`
    green `#2F7D54`).
  - **Pessimistic** continues at recent velocity and ends **above zero** (dotted `1 5`, **1.75px**,
    `--warning` amber `#B7791F`).
- The area **between** the two projections is a flat **shaded band**: fill `rgba(26,26,26,0.05)`
  (light theme). Only render the band when *both* optimistic and pessimistic series are visible.

**6. “Today” marker**
- Vertical dashed line `2 3` at Day 7, `--ink-muted`, ~55% opacity, top→baseline.
- Centred label **“TODAY”** (`--text-xs`, `--ink-muted`) just above the plot top edge.

### KPI strip (exact copy + values for the reference dataset)
ALL-CAPS eyebrow label above a semibold value, tabular numerals. Left-to-right:

| Label (eyebrow) | Value |
|---|---|
| `COMMITTED` | `92` |
| `REMAINING` | `44` |
| `VELOCITY` | `7.7/d` |
| `DAYS LEFT` | `3` |

Then a status **pill** pushed to the far right. The team is **behind** in this dataset, so it reads
`~21 pts short` using the warning pill (`--warning` text on `--warning-bg`). If the pessimistic
projection reaches ≤ 0 the pill instead reads `On track` (`--success` on `--success-bg`).

### Legend
Top-bordered (`--border`) row, `--text-xs`, `--ink-muted`. One `9px` dot + label per visible series:
`Actual remaining` (red), `Ideal (re-based)` (ink), `Optimistic` (green), `Pessimistic` (amber).
(`Scope` is available as a fifth series but is off in this configuration.)

---

## Interactions & behavior

**Hover read-out (the only interaction).**
- A transparent overlay over the plot tracks `pointermove`, snaps to the **nearest whole day**, and:
  - draws a faint vertical guide line at that day (`--ink`, ~25% opacity);
  - places an open dot (r=3.5, white fill, 2px series-coloured stroke) on each **visible** series at
    that day;
  - shows a dark tooltip listing each visible series with its colour dot, name, and value for that
    day. Header reads `Day N` (or `Sprint start` for Day 0), with ` · today` appended on Day 7.
- Tooltip: `--ink` background, white text, 8px radius, `~12px` text, positioned near the cursor and
  clamped inside the card. **No shadow** (Vector rule). On `pointerleave` everything fades out
  (120ms).
- Values past “today” exist only for the forecast/ideal series (actual stops at Day 7); the read-out
  naturally omits series that have no value at the hovered day.

**Filtering (host-level, optional in this single-card handoff).**
- Each series (ideal / actual / optimistic / pessimistic / scope) can be toggled. The cone band only
  draws when both optimistic and pessimistic are on. In the full gallery this is a chip bar above all
  charts; for a single embedded card you may expose it as a small control or omit it.

**Scope-change toggle / live recalculation.**
- This is the core dynamic behaviour. When an artefact is added or removed, the **aggregate of story
  points changes**, and the chart must:
  1. recompute the **scope** (total committed) per day;
  2. re-baseline the **ideal** line from the change day to 0 (the break + new slope described above);
  3. drop/keep the **pin** and shaded region;
  4. recompute **today’s remaining** and therefore the **forecast cone** end-points and the
     `on track / N pts short` pill.
- All of this is a pure function of the inputs — see `reference/data.js → build(scopeOn)`. Porting
  that function gives you correct recalculation for free.

**Motion.** Calm, per the Vector system: 120–150ms opacity fades on hover/tooltip only. No entrance
animation on the chart, no springs, no parallax. Respect `prefers-reduced-motion: reduce`.

**Responsive.** The SVG scales with container width via `viewBox`. Below ~420px, consider hiding the
numeric x labels or thinning to every other day; the prototype keeps all labels.

---

## State management
Minimal. The chart is a pure render of one model object plus a small UI state:

- **Inputs (props):** the sprint facts — `sprintDays`, `today`, `baseCommit`, `scopeDay`,
  `scopeDelta`, and the per-day `accepted` array. (See defaults below.)
- **`scopeOn: boolean`** — whether the mid-sprint scope change is applied. Toggling re-runs `build()`
  and re-renders.
- **`filters`** — which series are visible (`ideal/actual/optimistic/pessimistic/scope`).
- **Hover state** — current hovered day index (transient; not persisted).

`build(scopeOn)` returns everything derived (scope/day, remaining/day, ideal points incl. the break,
forecast cone arrays, day-indexed lookups for the tooltip, and the KPI block). Treat it as the single
selector between raw sprint data and the view. No data fetching is implied here — wire `accepted`,
`scopeDelta`, etc. to your real sprint API.

### Reference dataset (so output is reproducible)
- `sprintDays = 10`, `today = 7`, `baseCommit = 80`, `scopeDay = 5`, `scopeDelta = +12`.
- `accepted` (story points accepted each day, Day 0…7) = `[0, 4, 6, 8, 7, 5, 9, 9]`.
- Derived **remaining** (Day 0…7) = `80, 76, 70, 62, 55, 62, 53, 44`
  (note the *up-tick* at Day 5: +12 scope landed, only +5 burned that day).
- **Scope per day** = `80` (Day 0–4), `92` (Day 5–10).
- **Velocity** = mean of the last 3 accepted days `(5+9+9)/3 = 7.67/day`.
- **Optimistic** Day 7→10 = `44, 29.3, 14.7, 0`.
- **Pessimistic** Day 7→10 = `44, 36.3, 28.7, 21` → `~21 pts short`.

---

## Design tokens
Use Vector tokens (defined in `colors_and_type.css`); resolved hex shown for convenience.

**Colour**
| Role | Token | Hex |
|---|---|---|
| Canvas (app bg) | `--canvas` | `#F4F2EE` |
| Surface (card) | `--surface` | `#FFFFFF` |
| Sunken | `--surface-sunken` | `#EDEAE4` |
| Ink (ideal line, tooltip bg, text) | `--ink` | `#1A1A1A` |
| Ink muted (today line, legend) | `--ink-muted` | `#5C5C5C` |
| Ink subtle (axis labels, faint guide) | `--ink-subtle` | `#8A8A8A` |
| Hairline border | `--border` | `#E5E1DA` |
| Stronger border | `--border-strong` | `#D4CFC5` |
| **Actual series (accent)** | `--danger` | `#E5392B` |
| Optimistic | `--success` | `#2F7D54` |
| Pessimistic | `--warning` | `#B7791F` |
| Scope / pin | (info-class blue) | `#2F5F8A` |

> Note on the Vector charts rule: the system guide says product charts are normally **monochrome**
> with no brand colour. This chart is a deliberate, scoped exception — the team explicitly wants the
> red **Actual** hero series plus green/amber forecasts for legibility. A fully monochrome variant
> exists in the gallery (“Blueprint mono”) if you need to fall back to the default rule for a tenant
> with a low-contrast brand.

**Series strokes / dashes**
| Series | Width | Dash | Smoothed |
|---|---|---|---|
| Actual | 2.6 | solid | yes |
| Ideal (re-based) | 1.75 | `6 5` | no |
| Original guideline (faint) | 1.25 | `2 4` @0.4 | no |
| Optimistic | 1.75 | `1 5` | no |
| Pessimistic | 1.75 | `1 5` | no |
| Today line | 1 | `2 3` @0.55 | — |
| Scope line at Day 5 | 1 | `3 3` @0.6 | — |
| Gridlines (non-zero) | 1 | `3 3` @0.55 | — |

**Fills**
- Actual area gradient: `rgba(229,57,43,0.26)` → `rgba(229,57,43,0.02)` (top→bottom).
- Forecast cone band: `rgba(26,26,26,0.05)`.
- Post-scope shaded region: `rgba(26,26,26,0.025)`.

**Type** — Inter throughout; `font-variant-numeric: tabular-nums` on all values/axes.
Eyebrow labels ALL-CAPS, letter-spacing 0.08em. Mono (`--font-mono`, JetBrains Mono) only if you
surface raw IDs. **Radii:** card `--radius-lg` 12px, tooltip 8px, pills `--radius-full`.
**Spacing:** 4px base scale; card padding `--space-6` (24px). **No shadows anywhere.**

---

## Assets
None required. No images, no icon font. The chart is pure SVG; the “+12” pin is drawn, not an asset.
If you add iconography elsewhere on the card, use **Lucide** (1.5px stroke), per the Vector system.
Fonts: **Inter** (Google Fonts) and **JetBrains Mono** (mono, optional).

## Files
In `reference/`:
- `Burndown Reference.html` — the single merged chart documented here. Open this first.
- `data.js` — **the source of truth for all chart math.** `SprintData.build(scopeOn)` returns the
  full derived model (scope, remaining, ideal-with-break, forecast cone, lookups, KPIs). Port this.
- `chartkit.js` — the SVG renderer. The exact config used for this chart is
  `{ type:'burndown', area:true, areaGradient:true, smooth:true, cone:true, scopeMarker:true, markers:true }`
  with filters `{ ideal, actual, optimistic, pessimistic } = true, scope = false`.
- `styles.css` — card, KPI strip, legend, tooltip, and chip styling (Vector-faithful).

For broader context (all 20 treatments, not needed to build this one) see the gallery at
`charts/Sprint Burndown & Burnup.html` in the parent project.
