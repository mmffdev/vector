---
name: chart
description: Build a new chart component in app/components/, themed with the active CSS pack, with stub data + a sanitised preview-only random generator, and add it to the dashboard catalog.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /chart — Chart catalog builder

Loaded only when `<chart>` or `/chart` is invoked. Do not preload.

## Invocation

```
<chart> -m              # MAKE — user attaches an image; build chart matching the diagram
<chart> -m "Name"       # MAKE with explicit component name (else inferred from image)
<chart> -p              # PLACE — no image; build chart from the spec described in the conversation
<chart> -p "Name"       # PLACE with explicit component name
<chart> -h              # print usage and exit
```

When `-h` is the only flag, print the help block and stop. Generate nothing.

If neither `-m` nor `-p` is given, ask the user which mode and stop. Do not guess.

---

## What this skill does

1. **Reads** the diagram (Mode `-m`) or the conversation spec (Mode `-p`) to identify chart type, axes, series, and shape.
2. **Picks colors** from the **active theme tokens** in `app/globals.css` — never hardcoded hex. If the chart needs more tones than the theme exposes, derive harmonics from existing tokens (see "Color rules" below).
3. **Writes** a new component at `app/components/<Name>Chart.tsx` that:
   - Exports a default React component (client component).
   - Accepts a typed props shape with sensible defaults so `<NameChart />` renders with stub data.
   - Marks the stub data clearly so a real-data wire-up is a one-line replacement.
   - Accepts a **`randomize`** prop that, when true, generates and re-rolls preview data on click of an inline `↻` button.
4. **Adds chart-specific CSS** to `app/globals.css` under a `/* === <Name> chart === */` band. No inline styles, BEM-lite class names (`name-chart__ring`, etc.) — see [`docs/css-guide.md`](../../../docs/css-guide.md).
5. **Registers** the chart in `app/(user)/dashboard/page.tsx` as a catalog entry (card + legend descriptor).
6. **Reports** the file paths it wrote/edited and how to swap the stub data for real data.

The reference implementation to model is [`app/components/RaydaleChart.tsx`](../../../app/components/RaydaleChart.tsx) — its sanitisation comment block, `randomize` prop, and `↻` button pattern are the canonical shape. Match it.

---

## Modes

### Mode `-m` — Make from image

The user attaches a chart image (sketch, screenshot, design mockup). Read it visually:
- Identify chart family (radial, bar, line, donut, sankey, treemap, gauge, etc.).
- Count axes / series / categories. If the image has labels, use them as defaults; if not, generate descriptive placeholders ("Category A".."Category H").
- Identify any shape constraints visible in the image (e.g. rings closed vs open, fill vs stroke, stacked vs grouped).
- If the image is ambiguous between two chart types, ask one short clarifying question and stop.

### Mode `-p` — Place from conversation/plan

No image. The user has described the chart in chat. Read back from the conversation:
- Pull the chart type, axis count, series count, and any constraints the user named.
- If anything material is missing (chart type, # axes, # series), ask one short clarifying question and stop.
- Otherwise proceed exactly as Mode `-m` from step 2 onward.

---

## Color rules

Hardcoded hex is forbidden. All color comes from the active theme via design tokens declared in `app/globals.css`. The theme switcher (`useThemePack`) swaps the stylesheet at runtime, so anything you hardcode will look wrong on alternate packs.

**Allowed sources:**
- Existing tokens: `--ink`, `--ink-muted`, `--ink-subtle`, `--bg`, `--surface`, `--border`, `--brand`, `--brand-muted`, plus any chart-specific tokens already in the file (search for `--chart-`).
- Harmonic derivations via CSS `color-mix()`:
  - `color-mix(in oklch, var(--ink) 70%, var(--bg))` for muted ink
  - `color-mix(in oklch, var(--brand) 50%, var(--surface))` for soft brand
  - `color-mix(in oklch, var(--brand) 80%, white 20%)` for highlight
- Opacity-stepped fills: `rgb(from var(--ink) r g b / 0.12)` for translucent overlays.

**Tone slots:** if the chart has multiple series, expose them as `tone: 1 | 2 | 3 | 4` props that map to CSS classes (`name-chart__series--tone-1` etc.) defined in `globals.css`. The CSS class — not the component — owns the color. This keeps tone harmonics centralised and theme-swappable.

**Brand color rule:** never use `--brand` for routine series fills. Reserve it for the single highlighted/active element (one slice, one bar, one polygon). Comparison and secondary series use ink tokens.

**Auto-contrast text rule (HARD):** when chart text sits OVER a coloured fill, it must flip its own fill so dark text appears on light tones and light text appears on dark tones. The component owns the flip — when it paints a `<text>` over a segment of tone N, it tags the text with the matching tone modifier (e.g. `petal-chart__value--tone-3`), and CSS maps each modifier to either `var(--ink)` (dark text, light tones) or `var(--ink-contrast)` (light text, dark tones). Theme packs redefine `--ink-contrast` so the flip stays correct on any palette. The header note `AUTO-CONTRAST CHART TEXT` in `app/globals.css` documents the contract.

When you scaffold a new chart, decide per text element:
- **Does the text overlay a coloured tone?** If yes, thread the tone number through to the text node's `className` and add per-tone CSS rules under the chart's base text rule. Light tones (1–2 in our scale) → keep `var(--ink)`; dark tones (3–4) → `fill: var(--ink-contrast)`.
- **Does the text sit outside the chart geometry** (axis labels, leader-line callouts, perimeter labels)? It lives on the page surface — leave a single rule with `fill: var(--ink…)` and skip the flip.
- **Does the chart already have its own per-tone flip mechanism** (e.g. ladder-chart's `__cellnum--on-solid`)? Keep that pattern; do not duplicate it via tone modifiers.

Halo / `paint-order: stroke fill` outlines are NOT permitted as a contrast mechanism — they look cheap and never landed in this codebase.

---

## Connector → node draw-order rule (HARD)

Any chart that draws **connectors** — edges, leader-lines, bezier flows, axis ticks that terminate at a point, callout lines, parent→child links, hairlines — must render those connectors BEFORE the nodes / data points / dots / glyphs that sit at their endpoints. SVG paints in source order, so the connector markup comes first and the node markup comes second. The visible result is what the design calls the **Aperture rule**: every node fully covers the tip of any connector touching it; no stub of line peeks past the node radius, no joint is visible, and the connector reads as if it terminates AT the node boundary even when it geometrically reaches the node centre.

**Implementation:** split the render into two passes inside the SVG.

```tsx
{/* PASS 1 — connectors first */}
{edges.map((e) => (
  <line key={`edge-${e.id}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="..." />
))}

{/* PASS 2 — nodes painted on top, hiding any connector tips */}
{nodes.map((n) => (
  <g key={`node-${n.id}`}>
    <circle cx={n.x} cy={n.y} r={n.r} className="..." />
    {n.label && <text /* ... */>{n.label}</text>}
  </g>
))}
```

Do NOT emit connector + node together inside one `.map()` callback — the next iteration's connector will paint over the previous iteration's node. Always two separate passes, connectors before nodes.

Charts that this rule applies to (non-exhaustive):
- Force-directed graphs / hierarchical trees — edges before nodes.
- Sankey / flow charts — flow ribbons before source/destination chips.
- Donut leader-line callouts — leader line before the callout dot/label backing.
- Journey domes / dot-on-arc patterns — arc/ring before the focal dot.
- Scatter plots with trendlines — trendline before points.
- Any "lollipop" or "dumbbell" chart — stems before heads.

If a connector intentionally needs to read OVER a node (rare — e.g. a crossing edge that should sit above a destination chip), document the inversion with a one-line comment at the override site so the next reader knows it's deliberate.

---

## 3D / WebGL chart exemption

Charts whose geometry genuinely needs a 3D scene (rotatable bar grids, surface plots, voxel matrices) are allowed to break the rules in this skill where the SVG-centric rules don't apply. Specifically:
- **Render via vanilla `three` driven from `useEffect` + a container `ref`.** Do NOT pull in `@react-three/fiber` — fiber@8 reads `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner` at module-init via its bundled `react-reconciler`, and the path is not reachable through Next 15's webpack bundling on React 18.3.1 (page throws `Cannot read properties of undefined (reading 'ReactCurrentOwner')` on chunk load). fiber@9 fixes it but requires a project-wide React 19 migration. Plain three has no reconciler in the loop and sidesteps the entire class of bug. Use `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`.
- **Theme tokens are read at scene-build time via `getComputedStyle(document.documentElement).getPropertyValue("--token")`** because WebGL doesn't get the CSS cascade. Document this in the component header — theme swaps require a remount to pick up new colours.
- **An opt-in `colorMode="rainbow"`** (or equivalent) is allowed to bypass the no-decorative-colour rule when the data is a heatmap and colour conveys magnitude. Keep `mono` (theme-derived) as the default.
- **Inline styles on the host wrapper** are still forbidden — CSS goes in `app/globals.css` under the same `/* === <Name> chart === */` band.
- **Cleanup is mandatory.** The `useEffect` that builds the scene must return a cleanup function that cancels the animation frame, disconnects the `ResizeObserver`, disposes `OrbitControls`, disposes every geometry / material / texture you allocated, calls `renderer.dispose()`, and removes the `<canvas>` from the container. Forgetting any of these leaks GPU memory across remounts.

When you ship a 3D chart, write a header banner in the component file enumerating which rules it deliberately breaks and why. The reference implementation is [`app/components/BarGrid3DChart.tsx`](../../../app/components/BarGrid3DChart.tsx).

---

## Stub data rules

- Stub data lives at the top of the component file as a `const DEFAULT_*` block, clearly labelled and exported when useful.
- The component's prop defaults reference these constants so `<NameChart />` renders out-of-the-box.
- Add a one-line comment immediately above the constants pointing to where the real-data swap-in should happen (e.g. `// Replace `DEFAULT_SERIES` with API data when wiring up.`).
- Stub values must be **representative** of real shape — not all-zeros, not all-equal. The catalog page is for visual review.

---

## Random generator rules (PREVIEW ONLY)

Every chart this skill produces ships with a `randomize` prop. The generator MUST sit inside a fenced banner comment matching this template, with sanitisation rules tailored to the chart type:

```ts
// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every series, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • <rule 1 — see table below>
//   • <rule 2>
//   • <rule 3>
// If you add a chart type with different constraints, write a
// separate generator — do not reuse this one.
// =============================================================
```

### Sanitisation matrix — pick the right rules for the chart type

| Chart family | Constraint | What the generator must do |
|---|---|---|
| Radar / raydale / spider | Per-axis bounds, no sum constraint | Clamp each value to `[floor, max]`; round to int; pad/truncate to `axisCount`. Floor ≥ 5% of max so polygons keep shape. |
| Donut / pie / stacked-percent | Slices must sum to 100% | Generate N raw weights, sum them, scale each by `100/sum`, round, then add the rounding remainder to the largest slice. Reject any slice < 1%. |
| Stacked bar / 100% stack | Each stack column sums to 100% | Apply the donut rule per column independently. |
| Grouped bar / line / scatter | Per-point bounds | Clamp each value to `[floor, max]`; round per axis spec (int / 1dp / 2dp). |
| Concentric arcs / progress rings | Each ring is independent 0..max | Clamp each ring to `[floor, max]`; do NOT enforce ordering between rings unless the chart's semantics require it (e.g. cumulative). |
| Sankey / flow | Flow conservation (in == out per node) | Generate flows then balance per node by adjusting one outgoing flow to absorb the residual. Reject zero-sum nodes. |
| Treemap | Sum equals canvas area | Same as donut: scale to total, push remainder to largest. |
| Gauge / single value | One scalar in `[min, max]` | Clamp + round. |
| Probability ladder / per-row stochastic heatmap | Each row sums to 100% AND mass occupies a contiguous bell window | Per row: pick a mode (anchor ± small jitter so the diagonal ladder shape stays readable), generate a Gaussian bell with random sigma, trim cells below 5% of peak so support stays contiguous (no inner gaps, no stray pips), scale to sum=100, push rounding remainder to the mode cell. Highlight cell must land on a non-zero cell — pick a row at random then sample a column from that row's non-zero support. |
| Force-directed graph / hierarchical node-link tree | Connected acyclic tree; each non-root has exactly one parent at the level immediately above | Build top-down: start from the root level's singleton(s), then for each parent generate 1..N children using a per-depth fanout cap (wider near root, narrower at leaves). Sample sibling labels WITHOUT replacement from per-level pools so no two siblings collide. Cap depth at the canonical hierarchy length. Probability of further descent tapers with depth so leaves stay sparse. Generate fresh, stable IDs per call (counter resets) — no orphan branches, no cross-edges, no cycles. Initial node positions are seeded near parent (small radial offset) so the physics layout converges quickly. |
| 3D bar grid / scalar 2D matrix (rows × cols) | Per-cell scalar in `[floor, max]`, no sum constraint; gaps allowed but the scene must read as populated | Per cell: roll a dropout (≈18%) → 0, otherwise `floor + Math.random() * (max - floor)`. Coerce NaN/Infinity to floor; round to int; pad/truncate to row × col counts. **Reject the whole grid and reroll** if fewer than 30% of cells are non-zero — the 3D scene needs enough bars to read as a landscape. Floor ≥ ~5% of max so non-zero bars stay visible. Do NOT enforce relationships across rows or columns; each cell is independent. |

**Universal rules for every generator:**
- Coerce `NaN` and `Infinity` to a safe value (usually `floor`).
- Never let any series collapse to all-zero (the chart geometry must still read as a shape).
- Round so values display cleanly when a tooltip is wired in later.
- Keep array lengths equal to the configured axis/category count — pad or truncate.
- The generator is called **only** when `randomize === true`; defaults render unchanged otherwise.

If the chart type isn't in the table, infer the closest match and add a new row to this matrix in the same PR. Document the reasoning in the banner comment.

---

## File-shape requirements

The component file must follow this skeleton (RaydaleChart is the canonical example):

```tsx
"use client";

import { useState, useEffect } from "react";

// <Name> chart — <one-sentence description of what it shows>.
// Stub data ships by default; pass `series` / `data` to wire real values.
// Colors come from the active theme via design tokens, so the chart
// restyles automatically when the user switches theme packs.
//
// Usage: <NameChart />                  // stub data, normal use
//        <NameChart series={[...]} />   // real data
//        <NameChart randomize />        // PREVIEW ONLY — see banner below

export type NameSeries = { /* typed shape */ };

const DEFAULT_AXES: string[] = [ /* ... */ ];
const DEFAULT_SERIES: NameSeries[] = [ /* representative stub */ ];

// (geometry helpers — polar(), clamp(), etc.)

// =============================================================
// PREVIEW-ONLY banner — see Random generator rules above.
// =============================================================
function randomSeries(/* ... */) { /* sanitised generator */ }

export default function NameChart({
  axes = DEFAULT_AXES,
  series = DEFAULT_SERIES,
  max = 100,
  randomize = false,
}: {
  axes?: string[];
  series?: NameSeries[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeSeries, setActiveSeries] = useState(series);
  useEffect(() => {
    if (randomize) setActiveSeries(randomSeries(/* ... */));
  }, [randomize, series]);

  const svg = ( <svg /* ... */> /* chart */ </svg> );

  if (!randomize) return svg;

  return (
    <div className="name-chart-host">
      <button
        type="button"
        className="name-chart__reroll"
        onClick={() => setActiveSeries(randomSeries(/* ... */))}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
```

CSS classes: `name-chart`, `name-chart__<part>`, `name-chart__<part>--<modifier>`. All rules in `app/globals.css`. No inline `style={...}` except for genuinely dynamic values (computed transforms, animation durations) — those still go through CSS custom properties (`--name-chart-...`) where possible.

---

## Dashboard registration

Add to `app/(user)/dashboard/page.tsx`:

1. Import line near the existing chart imports.
2. A card entry following the established pattern. **Default to `chart-card--half` (half-page width)** unless the user has explicitly asked for another size in the same invocation:

```tsx
<div className="card chart-card chart-card--half">
  <NameChart randomize />
  <div className="chart-card__legend">
    <span className="chart-legend">
      Sample <name> — <one-line descriptor of what it shows>. Click ↻ to re-roll preview data.
    </span>
  </div>
</div>
```

**Size selection (HARD):**
- **Default = `chart-card--half`.** Every new chart goes in at half-page width unless the user explicitly asks for another size in the same invocation. Do not infer "this looks like a wide chart" — half is the default; the user upgrades it if they want it wider.
- **`chart-card--petal`** — only when the user explicitly says "square", "petal", "radial card", or attaches an obviously square mock.
- **`chart-card`** alone (full-width) — only when the user explicitly says "full width", "wide", "full row", or the chart's geometry physically can't fit at half (e.g. a 17-axis raydale, a sankey with 8+ sources).
- Place inside the most relevant `dashboard-charts-row` group, or open a new `<h3 className="eyebrow">…</h3>` + row if the chart is a new family.
- Always pass `randomize` in the dashboard so the catalog page is interactive. Real consumers must NOT pass it.

---

## Steps (per invocation)

1. **Validate flags.** If neither `-m` nor `-p`, ask which mode and stop. If `-h`, print help and stop.
2. **Read the spec.**
   - Mode `-m`: read the attached image. Identify family, axes, series, constraints.
   - Mode `-p`: re-read the conversation. Pull the same fields. Ask exactly one clarifying question if any required field is missing.
3. **Pick a name.** Use the explicit `"Name"` arg if given, else infer from the chart type (`SankeyFlowChart`, `RadialBarChart`, `StackedColumnChart`). PascalCase, ends in `Chart`.
4. **Inspect tokens.** Grep `app/globals.css` for `--ink`, `--brand`, `--chart-`, plus the chart classes already present. Re-use what exists; only add new tokens if the chart genuinely needs a new role.
5. **Write the component** at `app/components/<Name>Chart.tsx` following the file-shape skeleton, with the right random-generator banner from the sanitisation matrix.
6. **Append CSS** to `app/globals.css` under `/* === <Name> chart === */`. Include the host wrapper, the `__reroll` button, and any tone classes.
7. **Register on dashboard.** Add import + card block in `app/(user)/dashboard/page.tsx`.
8. **Sanity-check colors.** Confirm no hex literal sits in the new component or its CSS — only tokens, `color-mix(...)`, or `rgb(from var(--token) r g b / α)`.
9. **Verify random data is sanitised.** Read back the generator and walk through it once: does it satisfy every constraint in the matrix row you picked?
10. **Report.** Print:
    - Files written / edited (with line numbers for the dashboard insertion).
    - The chart-type sanitisation row chosen and why.
    - The one-line replacement instruction for swapping stub → real data.
    - Any deferred work (e.g. real backend route to fetch data).

---

## Hard rules

- **No hardcoded hex** in components or CSS — only theme tokens and harmonic derivations. Brand color reserved for highlights.
- **Auto-contrast text flip.** Text overlaying a tone gets a `--tone-N` modifier and CSS maps tones to `--ink` (light fills) or `--ink-contrast` (dark fills). Text outside the chart needs no flip. No halos, no blend-modes.
- **Connector → node draw-order (Aperture rule).** Any chart with connectors (edges, leader-lines, beziers, callout lines) renders connectors BEFORE nodes/dots/data points so the node fully hides the connector tip. Two render passes inside the SVG — connectors first, nodes second. Never emit connector + node together inside one `.map()`.
- **`randomize` is preview-only.** The banner comment is mandatory and must list the sanitisation rules actually applied.
- **Stub data must be representative**, not zeros or uniform values.
- **One-shot generators only.** Do not write a "universal" random data function shared across chart types — each chart's constraints are different; a shared generator hides bugs.
- **Dashboard registration is part of the deliverable.** A chart that isn't in the catalog isn't done.
- **Half-page default size.** Register every new chart with `chart-card chart-card--half` unless the user explicitly asks for `--petal` (square) or full-width in the same invocation. Do not infer the size from chart shape; the user upgrades it if they want it wider.
- **Match RaydaleChart's shape.** When in doubt, mirror its structure rather than inventing a new one.
- **No inline styles** — all rules go in `app/globals.css`. Use CSS custom properties for dynamic values.

---

## Help (`-h`) output

```
<chart> — build a themed chart component and add it to the dashboard catalog.

  -m              Make from an attached image (paste the diagram in chat).
  -m "Name"       Make with an explicit PascalCase component name.
  -p              Place a chart based on the spec described in the conversation.
  -p "Name"       Place with an explicit PascalCase component name.
  -h              Show this help and exit.

Builds:
  app/components/<Name>Chart.tsx   typed React component, stub data, randomize prop
  app/globals.css                  appended /* === <Name> chart === */ block
  app/(user)/dashboard/page.tsx    catalog card + legend entry

Random data is preview-only and is sanitised per the chart-type matrix in
.claude/skills/chart/SKILL.md. Real consumers omit the `randomize` prop.
```
