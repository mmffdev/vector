# Handover — Sprint Boundary Velocity Line (Artefacts/Points pills + colour + Planned Velocity)

**Written:** 2026-06-07 · **Branch:** `main` (NO feature branch — HARD RULE: never create a branch without asking the user in chat).
**Next action:** build the velocity-line feature per the approved spec. The spec is DONE + committed; you are at the start of implementation.

---

## TL;DR for the next session

You are mid-way through an iterative build of a **Jira-style sprint boundary** on `/value-sprint`. The drag interaction is WORKING (line moves, collects rows, commits on release). The user has now designed a richer version and **approved a spec** for it. Your job: **build that spec.** Then **verify it in the user's live browser** — do NOT claim it works on unit-green alone (this session burned trust by doing that 3×).

**Read first:** `docs/superpowers/specs/2026-06-07-sprint-velocity-line-design.md` (the approved spec — the source of truth for what to build).

---

## What the feature is (the spec, summarised)

Turn the plain boundary line into a velocity commitment line:
1. **Two pills on the line:** "Artefacts N" (count of rows above the line) left, "Points N" (sum of their `story_points`) right. Both update LIVE as you drag (pure DOM, zero React render).
2. **Colour = continuous green→amber→red blend** based on `pointsAbove / PlannedVelocity` (green well under, amber ~80%, red ≥100%). Use `color-mix` on the ratio; `transition` for the fade.
3. **"Planned Velocity" number field** in the action bar, **right-aligned**, PATCHes `timeboxes_sprints_planned_velocity` on blur/Enter. It is the cap driving the colour.
4. **Strip** the 6 filter buttons (Type/Status/Priority/Sprint/Release/Owner) from this view. **Move "Start Planning"** from left to the **right** of the velocity field; both right-padded.
5. Colour tokens (user-supplied — put in `:root`): `--grid-tree-artefact-divider-green:#66cc33`, `-amber:#ff6600`, `-red:#ff0037`, each ink `#f7f7f7`.

## Confirmed facts (already verified — don't re-check, just use)

- **Backend needs NO change.** `timeboxes_sprints_planned_velocity` (numeric) EXISTS. `PATCH /sprints/{id}` already accepts it: `backend/internal/timeboxsprints/handler.go:366`, `types.go:72`, `service.go:422-427`. Frontend just reads + PATCHes.
- Frontend PATCH path: `sprints.update(id, { timeboxes_sprints_planned_velocity })` (apiSite `sprints` surface). Verify exact method name in `app/lib/apiSite/index.ts` (`sprints` has `update`).
- `SprintWireRow` in `app/hooks/useNextSprint.ts` currently has `timeboxes_sprints_velocity?` but NOT `..._planned_velocity` — ADD it (`?: string | null`; numeric arrives as string).
- Rows carry points: `ScopeNode.points` (= `w.story_points`) in `app/(user)/scope/scopeTreeData.ts:39`. Add `data-sweep-points` to each sweep row in the skin so the hook can sum it.
- Colour blend chosen = **continuous gradient** (NOT snap-at-thresholds).

## Open items to settle WITH THE USER before/while building (spec §9)

1. **Sprint nav buttons** (Prev/Next/Current/Switch/Status) — keep them in the action bar or strip too? The screenshots only called out removing the **6 filter buttons**. Ask before stripping the nav.
2. Exact gradient stops (0→0.8→1.0 green/amber/red mix) — pick sensible, show the user live.

## Where the code is (the moving parts)

- **`app/components/Grid/useSweepSelect.ts`** — the imperative sweep engine. Snapshots rows on pointerdown, toggles classes per move (NO setState → zero render), commits on release. ADD: read `data-sweep-points`, compute `pointsAbove`/`countAbove` per move, write to ref'd pill spans + set line colour from ratio. **CRITICAL CONSTRAINT: never move/insertBefore a DOM element during the drag — it drops pointer capture and freezes the sweep (this bit us twice). Only toggle classes / set textContent / set style custom-props on existing elements.**
- **`app/components/Grid/Grid__SprintBoundary_Divider.tsx`** — the line element. Restyle to the pill look (Artefacts left / Points right), ref'd spans the hook updates, colour-driven.
- **`app/components/Grid/Grid__SprintBoundary.tsx`** — the skin. Passes pill refs + plannedVelocity into the hook/divider; computes at-rest count/points from `sprintNodes`. Renders rows with `data-sweep-points`.
- **`app/(user)/value-sprint/page.tsx`** — the POC mount. The action-bar `leading` is the `boundaryNav` block (~line 918+). ADD the Planned Velocity input + PATCH; STRIP the 6 filter buttons (they're in `actionBar.filterChips` / `WorkItemsFilterChips`); MOVE Start Planning right. Pass plannedVelocity into `<GridSprintBoundary>`.
- **`app/hooks/useNextSprint.ts`** — add `planned_velocity` to `SprintWireRow`.
- **`app/globals.css`** — divider line/pill styles + the 3 colour tokens in `:root`.

## How the current boundary works (so you don't break it)

- Two `useTree` instances on the page (sprint clamp `sprintId=<id>`, backlog clamp `__none__`), both clamped to story/defect/risk type ids. Fed into `<GridSprintBoundary>`.
- `useSweepSelect` on pointerdown snapshots `[data-sweep-row]` elements + midpoints + initial split (sprint row count). On move: `boundary` = count of rows whose midpoint ≤ pointerY; toggles `.grid__SprintBoundary_Row-inSprint` on rows above + `.grid__SprintBoundary_Row-line` (bottom border = the visible line) on the last in-sprint row. On release: diffs final boundary vs initial split → `{toSprint|toBacklog}` delta → `commit()`.
- The page's `commit`/`pocCommit` PATCHes `sprint_id` per uuid (Promise.allSettled), refreshes both trees + page refetch. `pocRefetch` (a 2nd `useRefetchOnPush` on the same topic) reconciles the POC trees with realtime/legacy edits.
- **Perf contract:** zero React renders between pointerdown and pointerup — there's a TEST pinning this in `useSweepSelect.test.ts` ("does NOT re-render React..."). Keep it green; it's the guard against the slowness the user hit.

## Hard rules / gotchas learned this session (DO NOT repeat)

1. **VERIFY IN THE USER'S LIVE BROWSER before claiming done.** Unit-green is necessary, not sufficient. This session claimed "fixed" 3× on green tests while the live browser was still broken. The user's Playwright account (`team_lead@mmffdev.com` / `password123!`) does NOT resolve the populated sprint — the populated data ("Sprint 1 — Red", node `cdaf77ab`, 10 rows) is in a workspace that account can't see. So you likely CAN'T repro in your own browser session — instrument the live code + have the USER drag and report, or hand them a precise test checklist. Be honest about this gap.
2. **NEVER move a DOM element during a pointer drag.** `insertBefore`/`appendChild`/React-reorder of the captured (or any) element drops the browser's pointer capture → the drag freezes after one move. Symptom: dragger turns black (dragging=true) but stuck. Fix pattern: do everything with class toggles / textContent / style props on elements that stay put.
3. **Pointer capture on `e.currentTarget`, not `e.target`** — `e.target` can be a child span that re-renders and drops capture.
4. **INSPECT THE INDEX before every commit.** The working tree has the USER's unrelated in-flight changes — keep them OUT of your commits: `.btn--feature` + `.value-sprint__ActionStrip` deletion in `app/globals.css`, lint-script deletions (`dev/scripts/lint_page_description.py`, `dev/registries/page_description_exempt.json`), a `scopeTreeData.ts` DI refactor, a `package.json`/`docs/c_c_lint_rules.md` change, and a Poker/PageHeading page refactor. Use `git diff --cached --stat` + hunk-level staging (`git apply --cached` with a filtered patch) when a file like globals.css mixes your change with theirs. Stage ONLY your feature files/hunks.
5. **No branch without asking.** Commit on `main`.

## Build approach

The spec is small enough for a few focused TDD commits (no need for a heavy multi-agent workflow):
1. `useSweepSelect`: points-sum + count + ratio→colour during sweep (+ the perf test stays green). Pure-function ratio→colour is unit-testable.
2. Divider: the Artefacts/Points pill line, ref'd spans, colour-driven.
3. Page: Planned Velocity input + PATCH, strip filter buttons, move Start Planning right, pass velocity in. `SprintWireRow` += planned_velocity.
4. CSS: tokens + pill/line styles + fade transition.
Then VERIFY LIVE with the user.

## Test/build commands

- Grid tests: `npx vitest run app/components/Grid/`
- Typecheck: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i sprintboundary || echo clean`
- Frontend `:5101` (auth-gated, 307 redirect is normal), backend `:5100` (dev, pinned).
- DB (verify only, don't assume): `PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.local|cut -d= -f2-) /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts`

## State at handover

- Spec committed: `c940dc17`. Boundary line working: `88bf007b` (capture-freeze fix), `04048c99` (moving-line look), `4e2d62fe`/`edaf225c`/`dfcda21d` (the sweep rebuild).
- Tests: 45 Grid tests pass at HEAD.
- TodoWrite mid-feature: spec done → next is "Build it" → then "Verify live in browser".
- NOTHING pushed (no remote push this session; user pushes when they ask).
