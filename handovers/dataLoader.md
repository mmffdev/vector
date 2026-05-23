# Agent Handover — Data Loader (Loader component + ObjectTreeV2 wiring)

**Date:** 2026-05-23
**Branch:** `main`
**Last commit (pre-session):** `e5c0b690` — `docs(handover): agent_visual_app — Visualiser V1/V2 handover doc`
**Surface:** `<Loader>` primitive in `app/components/`, wired into `ResourceTree.tsx` loading placeholder.
**Status:** V1 ships two types — `helix` and `threedotsradial`. Wired live in ResourceTree (which ObjectTreeV2 composes). Uncommitted on disk. Type registry is open — extending it is one literal + one switch case + one CSS block.

> **Read-before-acting:** this handover describes uncommitted, in-flight work. `git status` shows the three touched files modified/untracked. Verify locally before pushing; don't squash these into an unrelated commit (HARD RULE — inspect index before commit).

---

## What this surface is for

A single project-level **animated loader primitive** with a `type` discriminator. Today: pseudo-3D rotating motifs (DNA helix; orbiting dots with arc trails). Tomorrow: per-domain variants tuned to the data being fetched (tree-loaders, graph-loaders, table-loaders) — the same component, new `type` values.

**Design intent:** the loader is a moment of UX, not a placeholder. Each type is its own little piece of motion design — pseudo-3D via scale/rotation, never via colour glow or gradients (rejected this session as "boring"). Aligns with the project's design-ethos bar (`docs/c_design_ethos.md`).

Live use: ObjectTreeV2 → ResourceTree → loading placeholder. Replaces the prior `<p>Loading…</p>` text node while `useObjectTreeWindow` fetches.

---

## File map — where things live

### Component
- [app/components/Loader.tsx](../app/components/Loader.tsx) — `<Loader type={...}>` primitive. Exports `Loader` (named + default) and `LoaderType` union. One internal sub-component per type (`HelixLoader`, `ThreeDotsRadialLoader`). Exhaustive `switch` with `never` check — adding a new literal to `LoaderType` forces a compile error until you add the case.

### Styles
- [app/globals.css](../app/globals.css) lines ~7722–~7900 — the `Loader component` block, inserted between the Skeleton system and Skeleton compositions. Two type subblocks (`.loader__helix*`, `.loader__threedotsradial*`) plus shared `.loader` wrapper.
- CSS naming follows the project rule: `root-block__Container_Child_leaf`. Root block is `.loader`; per-type containers are `.loader__helix` / `.loader__threedotsradial`; leaves use `_` separators.

### Wiring
- [app/components/ResourceTree.tsx](../app/components/ResourceTree.tsx) line 41 (import) + line 1798 (render). Replaces the legacy `<p className="placeholder__body">Loading…</p>` with `<Loader type="threedotsradial" label="Loading…" />`.

---

## Type registry — what ships and how each works

### `helix` (built first)
12 horizontal rungs stacked vertically, each rung is `nodeL — barL (solid) — barR (dashed) — nodeR`. Each rung independently animates `scaleX` from `+1 → 0 → -1 → 0 → +1` on a 2.4s cycle, staggered by `-i/12 × period` so a rotation wave travels down the stack. `scaleX < 0` flips the rung — so the solid half visually swaps to the other side of the axis, reading as a strand rotating to its back face.

**Geometry:** `--loader__helix-size` (default 96px) drives width; height is `1.4 × size`. Lines/nodes use a single `--loader__helix-line` token (defaults to `--ink-muted`).

**Design history:** earlier iteration used cyan/red anaglyph fringes on the nodes for a stereoscopic depth cue. User rejected ("remove the colours"). Current version is pure monochrome, depth comes from `scaleX` compression + opacity dip at edge-on. Don't reintroduce colour without an explicit ask.

### `threedotsradial` (built second)
Three dots on a 38px-radius orbit (inside a 100×100 SVG viewBox; CSS scales to `--loader__threedotsradial-size`, default **30px**). Implemented as three SVG `<circle>` elements stroked with `stroke-dasharray="ARC GAP"` — each renders as one ~65° arc on the shared orbit path, the arcs rotated 120° apart via inline `transform`. The `<g>` wrapper rotates the whole orbit on a 1.2s linear cycle. **The arc *is* the trail** — the rounded `stroke-linecap` gives the leading dot its dot-like head.

**Design history:** earlier iteration added a focus-pulse (per-dot scale + opacity wave, blurred ghost trails). User rejected ("boring, remove the glow, make trails"). Current version is just three rotating arcs with the leading round cap — no filters, no pulses, no glow. Don't reintroduce blur/pulse without an explicit ask.

**Default size override:** the type-level `case` in [Loader.tsx](../app/components/Loader.tsx) substitutes `size = 30` when the caller leaves the default (`size === 96`). Other types keep 96 as their default.

---

## What is DONE

- `<Loader>` component scaffolded with discriminator `type: LoaderType`, exhaustive switch, `never`-check.
- `LoaderType = "helix" | "threedotsradial"` — two working variants.
- Helix variant — 12 rungs, scaleX rotation, solid/dashed half-bars across the rotational axis. Monochrome.
- Threedotsradial variant — three SVG arc-dots orbiting at 120° apart, real arc trails via `stroke-dasharray`. 30×30 default. No glow, no filters.
- Wired into [ResourceTree.tsx:1798](../app/components/ResourceTree.tsx#L1798) — ObjectTreeV2 loading state now shows `threedotsradial`.
- CSS naming compliant with project convention (`root-block__Container_Child_leaf`). Theme-aware via `--ink` / `--ink-muted` tokens.
- Typecheck clean (`npx tsc --noEmit` — no Loader/ResourceTree errors).

---

## Where to pick up next

**P1 — Commit.** Three files dirty: `app/components/Loader.tsx` (new), `app/components/ResourceTree.tsx` (import + one-line swap), `app/globals.css` (Loader block ~180 lines, inserted between Skeleton system and Skeleton compositions). **Inspect index before commit** (HARD RULE) — the working tree also has older unrelated dirty files from before this session; do NOT bundle them. Suggested message: `feat(components): <Loader> primitive — helix + threedotsradial variants + ObjectTreeV2 wiring`.

**P2 — Decide the default `type` in ResourceTree.** Currently hard-coded to `threedotsradial`. If different domains want different loaders, lift `type` to a `ResourceTree` prop (default `"threedotsradial"`) and let p_ObjectTree pass it through from the per-config registry.

**P3 — More types.** Likely candidates: `treepulse` (vertical lines pulsing top-down — for tree-shaped data), `graphspin` (nodes with edge-redraw — for relationship explorer), `tablesweep` (horizontal sweep — for table-shaped data). Add the literal to `LoaderType`, add the `case` in `Loader.tsx`, add a `.loader__<type>` block in globals.css. Compiler will catch missing cases.

**P4 — Storybook / catalog entry.** No live preview surface for the Loader exists yet. Either a `/dev/components` entry (via the `<update> -c Loader` skill) or a small `/dev/loader-preview` page that renders every type at every size. Helps with type-selection decisions in P2/P3.

**P5 — Audit other loading placeholders.** Several components likely still render `Loading…` text. Sweep with `grep -rn "Loading…" app/`. Replace consistently — but only where the visual weight is appropriate (button spinners want a different primitive, probably).

---

## Known caveats

- **Don't reintroduce colour to the helix.** User asked for monochrome explicitly: *"remove the colours"*. Original iteration had cyan/red anaglyph fringes; they're gone for a reason. If a future ask wants colour, ask first.
- **Don't reintroduce glow/blur to threedotsradial.** User asked for trails, not glow: *"thats boring, remove the glow, make trails"*. Earlier iteration had blurred ghost trails + scale-pulse; replaced with SVG arc trails. No filters in the current version.
- **Don't change V1 helix proportions casually.** Height is intentionally `1.4 × width` so the helix reads tall (more rungs visible). Squashing it to square breaks the "vertical strand" silhouette.
- **`loader.ts` name collision in ObjectTreeV2.** `app/components/ObjectTreeV2/loader.ts` is the wizard-JSON resolver, NOT this UI component. Don't confuse them — they live in different dirs and serve different purposes.
- **The arc length in threedotsradial is geometry-derived.** `ARC_LEN = circumference × 0.18` (≈65°). Don't hand-edit the dasharray string — keep it computed from `ORBIT_R` so the trail length stays consistent if the radius changes.
- **`scale` keyword on the helix is in the type union sense.** `LoaderType` is the discriminator — adding a new size variant ≠ adding a new type. Types are visual designs; size is a prop.
- **`size === 96` is a sentinel for "caller didn't pass size".** Used in the `threedotsradial` case to remap the default to 30. If a caller genuinely wants 96px threedotsradial, they have to pass `size={97}` or refactor the default detection. Cheap hack — fine for now, fix if a third type wants a different default.

---

## How to verify

1. Run dev server (`<npm>` skill — Next.js on 3000).
2. Navigate to any page that mounts ObjectTreeV2 (e.g. `/work-items` or any artefact tree). Throttle network in DevTools to "Slow 3G" to see the loader long enough to inspect.
3. The placeholder should render a 30×30 ring of three arc-headed dots rotating clockwise, no glow, no colour.
4. To preview helix instead, edit [ResourceTree.tsx:1798](../app/components/ResourceTree.tsx#L1798) to `<Loader type="helix" label="Loading…" />` — should render a ~96×135 monochrome rotating helix with solid/dashed half-bars.
5. Check `prefers-reduced-motion: reduce` (DevTools → Rendering tab) — both variants should freeze (covered by the global `@media (prefers-reduced-motion: reduce)` rule, not the loader CSS itself).

---

## Commits in scope

(none yet — uncommitted at session end)

---

## Open design questions

- Should `Loader` accept a `tone` prop (`"default" | "subtle" | "accent"`) for callers that want the loader in a brand colour? Defer until a real caller needs it.
- Should ResourceTree expose `loaderType` as a prop so different tree configs can pick their own animation? See P2 above.
- Is `threedotsradial` the right default for ObjectTreeV2, or does the helix feel more on-brand for the artefact-tree surface? Subjective — pick after seeing both in context.

---

**Last updated:** 2026-05-23
**Authored:** 2026-05-23 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
