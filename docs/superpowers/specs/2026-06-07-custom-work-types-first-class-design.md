# Make Custom Work Types First-Class — Design (Part 2 of add-artefact-type)

**Date:** 2026-06-07
**Follows:** `docs/superpowers/specs/2026-06-07-add-artefact-type-design.md` (Part 1 — creation)
**Surface:** flow seeding on create + ~8 type-list display surfaces
**DB:** `vector_artefacts` (vaPool) — `artefacts_types`, `flows`, `flows_states`, `flows_transitions`, `flows_defaults`, `flows_states_defaults`, `flows_transitions_defaults`
**Status:** Design — approved for plan

---

## 1. Problem & intent

Part 1 shipped artefact-type *creation*. A user created a custom work type "Spike" (behaves-like
Story). It exists correctly in the artefact-types admin table — but is excluded everywhere
downstream because the system assumes the 5 canonical `wrk_*` slots. Two distinct failure classes:

- **Class A — display filters (~8 surfaces).** The type exists and works, but type-list UIs filter
  it out via `t.slot ? SLOTS.has(t.slot) : false`. A custom type has `slot=null` → dropped from
  create pills, chip filters, scope/sprint pickers, wizard configs.
- **Class B — missing flow (1 root cause, the real bug).** `CreateWorkType` inserts the type row but
  **never seeds a flow**. The Transition Rules page inner-joins `flows`, so a flowless type is
  invisible — and worse, **items of that type have no workflow and cannot move through states.**
  Verified live (2026-06-07): canonical types have flows (Story 5 states, Defect/Risk/Task/Epic
  likewise); **Spike has 0 flows / 0 states.**

The fix completes what "create a type" means end-to-end: a type that **functions and appears**
everywhere a canonical one does.

## 2. Decisions (approved 2026-06-07)

1. **Flow source = the behaves-like type.** Spike was created "behaves like Story" → seed Spike's
   flow by cloning Story's live default flow + states + transitions. The behaves-like choice now
   drives both nesting rules (Part 1) and the workflow (this part) — one coherent meaning.
2. **One transaction, fallback to standard spine.** The clone runs inside `CreateWorkType`'s existing
   transaction (all-or-nothing). If the behaves-like type has no live flow, fall back to seeding the
   generic standard spine so a type is **never** created flowless.
3. **Slot allow-list stops being a gate.** Type-list surfaces show every live work type in scope;
   `wrk_*` slots only carry meaning where they genuinely mean something (the story-tier clamp).
4. **Sprint-review tier is derived, not hardcoded.** Story-tier membership comes from a type's
   `execution_parent_slots` signature, not the fixed `[wrk_story,wrk_defect,wrk_risk]` list — pays
   down `TD-SPRINTREVIEW-STORY-TIER-STATIC`.
5. **Sprint-planning is deferred.** `app/(user)/value-sprint/page.tsx` is **not touched** this pass;
   the plan must STOP and ask before any change to it. Custom types won't appear in sprint-planning
   yet — accepted.

## 3. Flows schema (verified live)

Post-RF1.4.4 prefixed columns:

- **`flows`** — `flows_id`, `flows_id_artefact_type` (FK → `artefacts_types_id`, ON DELETE RESTRICT),
  `flows_name`, `flows_description`, `flows_is_default`, `flows_id_library_layer`,
  `flows_archived_at`. Partial unique index `flows_one_default_per_type` on
  `(flows_id_artefact_type) WHERE flows_is_default AND archived_at IS NULL`.
- **`flows_states`** — `flows_states_id`, `flows_states_id_flow` (FK → `flows_id`, ON DELETE CASCADE),
  `flows_states_name`, `flows_states_kind`, `flows_states_colour`, `flows_states_sort_order`,
  `flows_states_is_initial`, `flows_states_is_pullable`, `flows_states_archived_at`. Partial unique
  index `flow_states_one_initial_per_flow` on `(flows_states_id_flow) WHERE is_initial AND NOT
  archived`.
  **`flows_states_kind` live CHECK (verified 2026-06-07, widened past the original `004_flows.sql`):**
  `backlog | todo | in_progress | done | accepted | cancelled` (6 values). The canonical Story flow
  uses all of: Backlog(`backlog`) → To Do(`todo`) → Doing(`in_progress`) → Completed(`done`) →
  Accepted(`accepted`). The clone copies `kind` verbatim (always valid since the source row already
  satisfies the CHECK); the fallback standard spine must emit these 5 kinds (NOT the stale 4-value
  enum from the old migration file).
- **`flows_transitions`** — links two states within a flow (from-state, to-state).
- **`flows_defaults` / `flows_states_defaults` / `flows_transitions_defaults`** — template/snapshot
  tables keyed by `artefact_type_id`, used by the "reset to default" path. `flow_defaults_one_per_type`
  unique on `(artefact_type_id)`.

The list query `sqlListFlowsByScope` (`backend/internal/flows/sql.go:24`) **inner-joins** `flows` +
`flows_states`, so a type with no flow row is invisible to Transition Rules + flow-states editor.

## 4. Class B — flow seeding on create

### 4a. New reusable method (the one new building block)

`backend/internal/flows/` gains a method (no equivalent exists today — verified):

```go
// CloneDefaultFlowForType clones the source type's live default flow (states +
// transitions) onto newTypeID, inside the caller's transaction. If the source
// type has no live default flow, it seeds the generic standard spine instead so
// the new type is never flowless. Also writes the flows_defaults snapshot rows
// for the new type so "reset to default" works later.
func (s *Service) CloneDefaultFlowForType(
    ctx context.Context, tx pgx.Tx,
    sourceTypeID, newTypeID uuid.UUID, newTypeName string,
) error
```

It takes `tx` so it joins `CreateWorkType`'s transaction — no second round-trip, atomic with the
type insert.

Internals:
1. `SELECT` the source type's default flow id (`flows_is_default`, not archived). 
2. **If found:** insert a new `flows` row for `newTypeID` (`flows_is_default=TRUE`, name
   `"<newTypeName> default flow"`); copy each `flows_states` row (name/kind/colour/sort_order/
   is_initial/is_pullable) capturing an old-state-id → new-state-id map; copy each
   `flows_transitions` row remapping from/to ids via that map.
3. **If not found (fallback):** seed the generic **standard spine** — states Backlog → To Do → Doing
   → Completed → Accepted with adjacent-bidirectional transitions. (Source the spine from the
   existing `devtools/spine.go` `spineStandard` definition, or lift it into a shared package so
   `flows` can own it — see §4c.)
4. Upsert `flows_defaults` + `flows_states_defaults` (+ transitions defaults) for `newTypeID`
   mirroring the seeded flow, so the reset path has a template.

### 4b. CreateWorkType calls it

`backend/internal/artefacttypes/service.go` `CreateWorkType`:
- Wrap the existing type INSERT in a transaction (currently a single `QueryRow`).
- After the type row is inserted, call
  `flowsSvc.CloneDefaultFlowForType(ctx, tx, in.BehavesLikeTypeID, newType.ID, newType.Name)`.
- This requires `artefacttypes.Service` to hold a reference to `flows.Service` (or a narrow
  interface). Wire it in the composition root (`main.go`) — `artefacttypes.NewService` gains a flows
  dependency, OR a small interface `FlowSeeder` to avoid a hard package coupling. **Prefer the
  interface** (artefacttypes already has a Perms dependency from Part 1; add `FlowSeeder` the same
  way) to keep the dependency direction clean and testable.
- Any error → return it → the deferred `tx.Rollback` undoes the type insert too. Flow-clone failure
  is a 500 (our bug), not a 422 (input is fine).

### 4c. Spine ownership

The canonical spine lives in `backend/internal/devtools/spine.go` (`spineStandard`, `spineTask`,
keyed by type *name* via `canonicalSpineByTypeName`). `devtools` is a dev-only package;
`flows`/`artefacttypes` are production. To use the standard spine from the production clone path
without importing `devtools`, lift the spine definitions into a shared production location (e.g.
`backend/internal/flows/spine.go` or `backend/internal/shared/`). The clone path uses **only** the
standard spine for fallback; it does NOT need the name-keyed map (the behaves-like clone covers the
real cases).

### 4d. Backfill existing flowless types

Spike already exists with 0 flows. The migration/one-shot must seed flows for any existing
`source='tenant'` work type that has no live default flow — clone from a sensible source or the
standard spine. This is a dev-data fix-up (a backfill script or a devtools action), not a schema
migration. Spike specifically: clone from Story (its behaves-like base, recoverable, or default to
standard spine if the base link isn't stored).

> NOTE: Part 1 did not persist the `behaves_like_type_id` on the created type — it only copied the
> slots at create time. So for *existing* flowless types we can't recover the base; backfill uses the
> standard spine. Going forward, new creates clone correctly because the base id is available in the
> create call. (If we want post-hoc base recovery, that's a separate enhancement — out of scope.)

## 5. Class A — display-filter sweep

Principle: the slot allow-list is not a gate. Surfaces in scope this pass:

### 5a. Show-all surfaces (drop the slot gate)

Each currently filters `t.slot ? SLOTS.has(t.slot) : false`; change so every live work type in scope
appears (canonical + custom). Files:
- `app/(user)/work-items/GridWorkItems.tsx` — `createTypes` filter (~line 203) + the chip/facet
  filter options.
- `app/(user)/scope/GridExecution.tsx` — `WORK_ITEM_CREATEABLE_SLOTS` filter (~line 204).
- `app/components/ArtefactInlineForm/useParentCandidates.ts` — the `.filter(t => t.slot)` (verify
  Part 1 already handles slot-OR-prefix; this is about not dropping slot=null types from lists).
- `app/components/DependencyMap/DependencyMapOverlay.tsx` — already includes custom types (exclusion
  is `wrk_task`-only); **verify only**, likely no change.

### 5b. Wizard JSON union

`p_wizard_workitems.json` (`createableTypeSlots`) and `p_wizard_risks.json` are static sidecar
configs that cannot know about runtime custom types. The **consuming component** must treat the JSON
list as a *seed*, not an exhaustive allow-list: union the JSON slots with the live custom
(`slot=null`, `scope='work'`) types from the catalogue. The JSON stays as-is (it still declares the
canonical set + ordering); the component stops treating "not in JSON" as "exclude."

### 5c. Tier-aware sprint-review clamp

`app/(user)/value-sprint-review/GridSprintReview.tsx` — replace `STORY_TIER_SLOTS` hardcode with a
derived tier check:
- A type is **story-tier** if its `execution_parent_slots` signature matches the story tier — i.e.
  its allowed parents are the strategy floor / Epic (Feature, Epic), NOT Story/Defect (which would
  make it task-tier).
- Canonical Story/Defect/Risk qualify; **Spike (behaves-like-Story, inherited Story's
  `execution_parent_slots`) rides along**; a custom Epic-like or Task-like type is correctly
  excluded.
- Extract a shared helper `isStoryTier(type)` (and/or `workTypeTier(type)`) in the catalogue layer
  so the rule lives once.

### 5d. Shared tier helper

A small util (e.g. `app/lib/workTypeTier.ts` or alongside the catalogue context) derives a work
type's tier from `execution_parent_slots`:
- story-tier: parents include a strategy-floor/Epic slot (Feature/`wrk_epic`).
- task-tier: parents are Story/Defect (`wrk_story`/`wrk_defect`).
Used by sprint-review now; available to other tier-sensitive surfaces later.

## 6. Out of scope / deferred

- **`app/(user)/value-sprint/page.tsx` (sprint-planning) — DEFERRED.** Not touched this pass. The
  implementation plan MUST stop and ask before any change to this file. Custom types will not appear
  in sprint-planning until a follow-up. (User directive 2026-06-07.)
- Post-hoc recovery of a flowless type's original behaves-like base (Part 1 didn't persist it).
- Strategy-type flow seeding via insert-layer (separate concern; insert-layer creates strategy types
  which get flows via the adoption path, not this work).
- Backend reparent-type enforcement (`TD-REPARENT-BACKEND-PARENT-TYPE`) — unrelated.

## 7. Validation & safety

- Flow clone is atomic with type create (single tx, rollback on any error).
- A work type can never exist flowless after this work (clone-or-fallback guarantees it).
- Server is the gate: `CreateWorkType` is already `portfolio.model.edit`-gated (Part 1).
- Sprint-review tier logic must be covered so a custom Epic-like type does NOT leak into the sprint
  backlog (the sharp edge of "include all").

## 8. Testing

Backend (Go):
- `CloneDefaultFlowForType`: clones source flow's states + transitions 1-for-1 (count + names +
  initial-state + transition remap correct); fallback seeds standard spine when source has no flow;
  runs in a passed tx and rolls back cleanly on injected error.
- `CreateWorkType`: after create, the new type has exactly one default flow with the cloned states
  (behaves-like Story → Story's states); a create with a base type that has no flow still yields a
  standard-spine flow; flow-clone failure rolls back the type insert (no orphan type).
- Backfill: Spike (and any flowless tenant work type) ends with a live default flow + states; the
  Transition Rules query returns it.

Frontend (Vitest/RTL):
- `isStoryTier`/`workTypeTier`: Story/Defect/Risk → story-tier; Epic/Task → not; a custom type with
  Story's `execution_parent_slots` → story-tier; with Epic's → not.
- GridWorkItems create pills include a custom slot=null work type.
- Sprint-review clamp includes a behaves-like-Story custom type and excludes a behaves-like-Epic one.
- Wizard-consuming component unions JSON slots with live custom types.

## 9. Tech-debt

- **TD-SPRINTREVIEW-STORY-TIER-STATIC** — paid: tier now derived from `execution_parent_slots`.
- **TD-WORKTYPE-FLOW-SEED** (resolved by this work) — note `CreateWorkType` now seeds a flow; the
  reusable `CloneDefaultFlowForType` is the primitive the canonical seed path was missing.
- **TD-WORKTYPE-BEHAVESLIKE-NOT-PERSISTED** (new, S3) — Part 1 didn't store `behaves_like_type_id` on
  the type, so a flowless type's original base can't be recovered for backfill; backfill falls back
  to standard spine. Trigger: if post-hoc "re-clone from base" is ever needed, persist the base id.
- **TD-SPRINTPLANNING-CUSTOM-TYPES** (new, S3) — `value-sprint/page.tsx` deferred; custom types don't
  appear in sprint-planning. Trigger: user readiness (explicitly held back 2026-06-07).

## 10. Phasing (for the plan)

1. **Backend Class B** — `CloneDefaultFlowForType` + wire into `CreateWorkType` + tests.
2. **Backfill** — seed flows for existing flowless tenant work types (Spike).
3. **Frontend tier helper** — `isStoryTier`/`workTypeTier` + tests.
4. **Frontend Class A sweep** — show-all surfaces + wizard union + sprint-review tier (NOT
   sprint-planning).
5. **Tech-debt + verify.**
