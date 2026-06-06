# New-artefact rank placement control

**Date:** 2026-06-06
**Status:** Approved (design) — pending implementation plan
**Author:** Claude (Opus 4.8) + Rick

## Problem

Vector hard-codes a newly-created artefact to the **bottom** of the priority
rank: `CreateWorkItem` computes `artefacts_position = MAX(position) + 100`
(`backend/internal/artefactitems/sql.go:675` `sqlSelectNextArtefactPosition`,
called at `service.go:1178-1182`). This matches Rally's documented UI behaviour
— *"Any item entered … adds your new item to the bottom of the Backlog page as
the lowest rank"* (Broadcom TechDocs, verified 2026-06-06).

Rally gives the user **no choice** about this. That is the opportunity: let the
user decide where new work lands in the rank. A small differentiator Rally does
not offer.

Empirical note (2026-06-06): testing against the live Rally WSAPI showed
API-`create` assigns a *top* rank (`O~~~…` LexoRank, below the `P!!!…` bucket),
which is an artefact of the **API** path and does **not** match Rally's **UI**
behaviour. The UI — and the documentation — place new items at the bottom. Our
default therefore stays "bottom"; this feature adds the *option* to go top.

## Goal

- **Create flyout:** a sticky **Top / Bottom** toggle controlling where the new
  artefact lands in the rank. Defaults to **Bottom** (Rally-familiar, safe
  capture) on first use, then remembers the user's last choice.
- **Duplicate:** **Top / Bottom / Under original** — the third option inserts
  the clone immediately after its source in the rank. It exists **only** for
  duplicate, because a from-scratch create has no source artefact to sit under.
- **No regressions:** every existing create caller (omitting the new field)
  keeps the current bottom-insert behaviour.

## Approach

Single computation site. Both create and duplicate already flow through
`CreateWorkItem` (duplicate = create + follow-up PATCH, see
`GridWorkItems.duplicateArtefact`). So the position choice is made in exactly
one place, gated by one new optional input field.

### Position formulas

The displayed Prio is a derived dense `ROW_NUMBER() OVER (ORDER BY
artefacts_position ASC, artefacts_number ASC)` (`sql.go:174-181`), scoped
per-artefact-type + workspace. The underlying `artefacts_position` integers are
`+100`-spaced, leaving room to bisect.

| Placement | `artefacts_position` formula | Scope (WHERE) |
|---|---|---|
| `bottom` (default) | `COALESCE(MAX(position), 0) + 100` | subscription + type, not archived |
| `top` | `COALESCE(MIN(position), 0) − 100` | subscription + type, not archived |
| `after` (dup only) | midpoint of `(source.position, nextSibling.position)`; if the two are adjacent (no integer gap), fall back to `source.position + 1` and flag the type for a future rebalance | subscription + type, source's neighbourhood |

`top` and `bottom` are single-row scalar subqueries mirroring the existing
`sqlSelectNextArtefactPosition`. `after` needs the source's position plus the
smallest position strictly greater than it (the next sibling) within the same
type/subscription scope, then averages the two (integer division is fine — the
gap is ≥100 in the common case).

### Wire contract

`CreateWorkItem` input (`CreateWorkItemInput`) gains:

```go
// RankPlacement controls where the new artefact lands in the dense Prio rank.
// "" or "bottom" (default, back-compat) → MAX(position)+100.
// "top" → MIN(position)-100. "after" → midpoint below AfterArtefactID
// (duplicate only; ignored when AfterArtefactID is empty).
RankPlacement   string  // "" | "top" | "bottom" | "after"
AfterArtefactID *string // required when RankPlacement == "after"
```

Absent / empty `RankPlacement` ⇒ `bottom`, so all current callers are
unchanged. `after` without a valid `AfterArtefactID` falls back to `bottom`
(defensive, never errors the create).

The `/work-items` POST DTO carries `rank_placement` + `after_artefact_id`
(snake_case wire), validated server-side; unknown values fall back to `bottom`.

### Frontend

- **`ArtefactCreateFlyout`**: a Top / Bottom segmented toggle near the submit
  row. State persists via a per-user pref `workitems.create.rank` (same
  mechanism as the grid filter prefs — read on mount, written on change). Passes
  `rank_placement` into the create POST body via `buildCreateRequests`.
- **Duplicate** (`GridWorkItems.duplicateArtefact` / `GridExecution` is NOT
  touched — work-items surface only for now): the duplicate create POST adds
  `rank_placement: "after"` + `after_artefact_id: <source.id>` so the clone
  lands directly beneath its original.

`buildCreateRequests` (the pure helper) is extended to thread `rankPlacement`
(+ `afterArtefactId`) into `postBody` — the natural testable seam.

## What we are explicitly NOT doing

- No rank-rebalance engine. The `after` fallback (`source+1`) covers the rare
  gap-closed case; a real rebalance is tracked as tech debt if it ever bites.
- No change to the dense-rank display projection (`sql.go:174-181`).
- No per-workspace / admin default — user-sticky only (per decision).
- No "Under original" on plain create — it is meaningless without a source.
- Not touching `/scope` or `/artefacts` create paths (work-items only; they
  inherit later if wanted).

## Testing

- **Pure unit:** `buildCreateRequests` emits `rank_placement` (+ `after_artefact_id`)
  correctly for each toggle state; omits them when default.
- **Backend handler:** create with `top` lands position < all existing; `bottom`
  lands > all; `after` lands strictly between source and its next sibling.
  Default (field omitted) = bottom (regression pin).
- **Frontend:** the toggle persists across remounts (pref read/write); duplicate
  issues `rank_placement: "after"` with the source id.
- **Live (padmin):** create a Story with Top → it appears at Prio 1; with Bottom
  → last; duplicate Under original → directly below its source.

## Tech debt

- **TD-RANK-REBALANCE** (S3): if `+100` gaps ever close (heavy mid-rank
  insertion), `after` degrades to `source+1` which can collide. Trigger: first
  observed position collision or a type with >~50 adjacent inserts. Pay-down: a
  per-type position rebalance pass (re-space to `100, 200, 300…`).

## Sequencing (for the plan)

1. Backend: `top`/`bottom`/`after` position SQL + `CreateWorkItem` branch +
   input fields. Unit + handler tests. **Default-bottom regression pinned.**
2. `buildCreateRequests`: thread `rankPlacement` + `afterArtefactId`. Unit test.
3. `ArtefactCreateFlyout`: sticky Top/Bottom toggle + pref persistence.
4. `GridWorkItems.duplicateArtefact`: pass `after` + source id.
5. Verify: tsc, lints, tests, live padmin click-path. Iterate toggle location.
