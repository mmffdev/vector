# Sprint Boundary — Velocity Line + Planned Velocity Field

**Date:** 2026-06-07
**Status:** Draft — awaiting user review
**Builds on:** the imperative sweep boundary (commit 88bf007b)
**Surface:** `app/components/Grid/` (sweep + divider) + `app/(user)/value-sprint/page.tsx` + `useNextSprint.ts`

---

## 1. Purpose

Turn the plain boundary line into a Jira-style **velocity commitment line** with
live readouts and a colour that reflects sprint load against a saved cap:

1. The line shows two pills: **"Artefacts N"** (count of rows above the line) on
   the left, **"Points N"** (sum of their story points) on the right — both
   recomputed live as you drag.
2. The line/pills **colour-blend green→amber→red** continuously based on
   `points / Planned Velocity`: green well under, amber approaching, red at/over.
3. A **"Planned Velocity"** number field in the action bar, **right-aligned**,
   that persists to `timeboxes_sprints_planned_velocity` (the field already
   exists; backend PATCH already supported). It is the cap that drives the colour.
4. The action bar's filter buttons (Type / Status / Priority / Sprint / Release /
   Owner) are **removed** from this view. The existing **"Start Planning"** button
   moves to the **right**, sitting to the right of the Planned Velocity field;
   both padded to the right edge.

## 2. Decisions (user-confirmed 2026-06-07)

| Decision | Choice |
|---|---|
| Colour bands | Conceptually green `<80%` / amber `80–99%` / red `≥100%` of Planned Velocity, but rendered as a **continuous gradient blend** (color-mix on the ratio), not hard snaps. |
| Points pill | Live **sum of `story_points`** of the artefacts above the line; Artefacts pill = their **count**. Both update during the drag (pure DOM). |
| Velocity field placement | In the **action bar**, right-aligned. Start Planning moves from left to **right of** the velocity field; both right-padded. The Type/Status/Priority/Sprint/Release/Owner buttons are removed. |
| Backend | **No migration / no backend change** — `timeboxes_sprints_planned_velocity` (numeric) exists and `PATCH /sprints/{id}` already accepts it (handler.go:366, service.go:422). Frontend reads it + PATCHes it. |
| Save timing | The velocity input PATCHes on blur / Enter. |
| Colour tokens (user-supplied) | `--grid-tree-artefact-divider-green: #66cc33`, `-amber: #ff6600`, `-red: #ff0037`, each with ink `#f7f7f7`. Define in `:root`. |

## 3. Architecture

### 3.1 Live points sum during the sweep (`useSweepSelect`)
Rows already carry `data-sweep-section` + `data-sweep-uuid`. Add
`data-sweep-points` (the row's story points, `0` when null). On pointerdown the
snapshot also reads points. On each move, after computing `boundary`:
- `pointsAbove = sum of snap[0..boundary).points`
- `countAbove = boundary`
Write both to ref'd DOM nodes on the line (the two pills' text), and set the
line's colour custom property from the ratio (see §3.3) — all pure DOM, no
React render. The hook gains optional callback args / refs for the two pill
text nodes + the line element (so it can set its `--ratio`/colour). Keep the
existing `onCommit` contract.

### 3.2 The divider line (`Grid__SprintBoundary_Divider`)
Restyle to the `--grid-tree-artefact-divider-line` look:
- Left pill: `Artefacts <count>` (ref'd span the hook updates).
- Right pill: `Points <sum>` (ref'd span the hook updates).
- The connecting line + pills share the velocity colour.
- At rest (not dragging) the pills show the CURRENT in-sprint count + points
  (computed from the sprint rows on render) so the line is informative before
  you touch it; during a drag the hook overwrites them live.

### 3.3 Colour from ratio (continuous blend)
`ratio = pointsAbove / plannedVelocity` (guard divide-by-zero → if no velocity
set, default to green/neutral). Map to a blended colour via CSS:
- The line sets `style="--ratio: <0..1+>"` (or the hook sets a colour custom
  prop directly). The blend: green→amber as ratio goes 0→0.8, amber→red as
  0.8→1.0, solid red ≥1.0. Implemented with `color-mix` steps keyed off the
  numeric ratio (the hook computes the mixed colour string and sets it as
  `--divider-colour`, OR sets `--ratio` and CSS does two color-mix stops).
  Prefer the hook computing the colour (simpler, deterministic, testable).
- `transition: background-color 180ms` on the pills/line for the fade.

### 3.4 Planned Velocity field (action bar)
- `SprintWireRow` (useNextSprint.ts) gains
  `timeboxes_sprints_planned_velocity?: string | null` (numeric comes as string).
- The action-bar `leading` in page.tsx is rebuilt: REMOVE the filter chips +
  the Type/Status/Priority/Sprint/Release/Owner buttons from THIS view (they are
  in `actionBar.filterChips` / wherever they render). KEEP the sprint nav
  (Prev/Next/Current/Switch/Status) if still wanted — CONFIRM in planning; the
  screenshots only call out removing the 6 filter buttons.
- Add a right-aligned group: `<label>Planned Velocity</label><input
  type="number">` bound to the sprint's planned_velocity, PATCHing
  `sprints.update(sprintId, { timeboxes_sprints_planned_velocity })` on blur/
  Enter. On success the new cap drives the line colour (re-render updates the
  at-rest colour; the live drag reads the latest value).
- The Start Planning button moves to the right of the velocity field. Both sit
  in a right-aligned container (the action bar's right slot, or a flex
  `margin-left:auto` group).

## 4. Data flow

```
sprint loaded → planned_velocity read into page state (cap)
rows render with data-sweep-points
at rest: line pills show current in-sprint count + points, colour = ratio(cap)
drag:
  pointermove → boundary → countAbove, pointsAbove (sum data-sweep-points)
             → pill spans.textContent = count / points   (DOM)
             → line colour = blend(pointsAbove / cap)     (DOM)
  (zero React renders)
release → commit crossed rows (unchanged)
edit velocity field → PATCH sprints.update → cap updates → colour re-evaluated
```

## 5. Components / responsibilities
- `useSweepSelect` — adds points-sum + count + colour during the sweep, via
  ref'd DOM targets. Still headless, still zero-render mid-drag.
- `Grid__SprintBoundary_Divider` — the pill line (Artefacts / Points), colour-
  driven, ref'd spans.
- `Grid__SprintBoundary` — passes the pill refs + the line element + the
  plannedVelocity (for at-rest colour) into the hook/divider; computes the
  at-rest count/points from sprintNodes.
- `value-sprint/page.tsx` — the Planned Velocity input + PATCH, the action-bar
  rebuild (strip filter buttons, right-align velocity + Start Planning), passes
  plannedVelocity into the boundary component.
- `useNextSprint.ts` — `SprintWireRow` gains planned_velocity.

## 6. Error handling
- Velocity PATCH failure → toast the API error; the input reverts to the last
  saved value. No silent loss.
- No velocity set (null) → ratio undefined → line is neutral/green; no divide-by-
  zero. The "Points N" still shows; colour just doesn't escalate.
- Non-numeric / negative input → clamp to ≥0 or reject with a toast (planning:
  pick the simplest correct guard).

## 7. Testing
- `useSweepSelect`: points sum is correct for a given boundary; colour ratio
  computed correctly at <80 / 80-99 / ≥100; zero-render contract still holds.
- Divider: pills render Artefacts/Points; ref'd spans update.
- Page: velocity input PATCHes on blur with the typed value; the 6 filter
  buttons are gone; Start Planning is right of the velocity field.
- Colour: ratio→colour mapping unit-tested (pure function).

## 8. Constraints
- No shared-Grid-primitive edits. Compose.
- No backend change (field + PATCH already exist) — verify, don't add.
- Work on main, no branch (HARD RULE). Inspect index before each commit; keep
  the user's unrelated working-tree changes (.btn--feature, ActionStrip, lint
  scripts) OUT of commits.

## 9. Open items to confirm in planning
1. Keep the sprint nav (Prev/Next/Current/Switch/Status) in the action bar, or
   strip those too? (Screenshots only call out the 6 filter buttons.)
2. Exact gradient stops for the blend (the 0→0.8→1.0 green/amber/red mix).
3. Whether "Artefacts" counts ALL rows above the line or only story-tier (the
   clamp is already story/defect/risk, so all visible rows count).
