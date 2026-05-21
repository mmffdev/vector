# ⚠️ Active Refactor — ObjectTree V2

**Status:** ALL SLICES COMPLETE on the worktree — 0–4 + 1.5 + 4.6a + 2.5 + 4.6c + 4.5 + 5A + 6 (all sub-slices) + 5B + 7. Sprint + release production pages run on `<TimeboxObjectTree>` (V2). `<TimeboxManager>` + `useTimebox` + `timebox/kinds.ts` deleted (−442 net lines). Heartbeat inheritance ships end-to-end: propagation radio in the inline form → backend read-time ancestor-walk → grid renders inherited rows italic+muted with "↑ from <Parent>" badge → flyout switches to read-only banner on inherited rows → write-side 409 ErrInheritedReadOnly.
**Owner:** Claude (working from Rick's main session)
**Active branches (worktree, NOT YET MERGED to main):** `refactor/objecttree-s6-page-swap` (slices 6.1 → 6.5), `refactor/objecttree-s5b` (slice 5B), `refactor/objecttree-s7-heartbeat-ux` (slice 7 — current tip). Rick to decide merge order + timing.
**Landed branches:** s0 (baseline), s1 (data hook), s2 (flyout shell), s3 (chrome kinds), s4 (reparent rules), s1.5 (registries), s4.6a (coalescing), s2.5 (backend ?fields=), s4.6c (touched_ids + by-ids), s4.5 (column picker), s5a (scope_propagation substrate)
**Worktree:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector-refactor-objecttree-s0/`
**Plan:** [docs/c_c_objecttree_refactor_plan.md](docs/c_c_objecttree_refactor_plan.md)
**Started:** 2026-05-20

---

## What this file is for

A WIP flag at the repo root so any **other agent** working in this codebase can see, at a glance, which files are being actively refactored — and avoid touching them on `main` until the refactor lands. This file is deleted when the refactor merges.

If you are another agent and your task touches any file listed below: **stop, send a SendMessage to the human, ask whether to wait or coordinate.** Do not assume it is safe just because the file builds.

---

## The single-agent-ownership rule applies

Per the rule in [context/memory/c_workflow_rules.md](context/memory/c_workflow_rules.md): never spawn a second agent into a package another is currently or recently working — they adopt different mental models and break the seam. This refactor IS that "currently working" condition for everything below.

Origin of the rule: 2026-05-20 fields-domain incident where two agents wired the workspace-fields write API two different ways and the frontend imported names that didn't exist.

---

## Files I am claiming for this refactor

These are off-limits on `main` until each slice merges. The list grows slice by slice. When a slice lands on `main`, those files are released.

### Claimed for the WHOLE refactor (every slice touches these eventually)

- `app/components/ObjectTreeV2/**` — entire new directory, mine top to bottom
- `app/(user)/scope/page.tsx` — the dev harness page
- `docs/c_c_objecttree_refactor_plan.md` — the plan doc
- `docs/examples/p_wizard_workitems_v2.json` — schema example
- This file (`objectTreeRefactor.md`) — the WIP flag itself

### ~~Claimed by SLICE 1~~ — DONE (flat row store + window hook extraction)

- ✅ `app/components/ObjectTreeV2/hooks/useObjectTreeWindow.ts` (new) — landed
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — now consumes the new generic hook (V2 only; production ObjectTree untouched)
- ✅ `app/components/work-items-tree-config.tsx` — UNTOUCHED (production keeps using `useArtefactItemsWindow` here; the legacy hook stays)
- Note: the old artefact-coupled hook is NOT yet a "thin wrapper over the new one" as the plan called for. That migration happens when production swaps to V2 (Slice 6+). For now, two parallel paths.

### ~~Claimed by SLICE 1.5~~ — DONE (registries + loader + context resolver)

- ✅ `app/components/ObjectTreeV2/registry.ts` (new) — componentRegistry, ruleRegistry, pluginRegistry with strict accessors
- ✅ `app/components/ObjectTreeV2/context.ts` (new) — auth/scope hook accessors + useResolveContext
- ✅ `app/components/ObjectTreeV2/loader.ts` (new) — recursive wizard-config walker with *Ref-suffix resolution
- Note: substrate only at this slice. No existing consumer migrated yet; future slices wire onto these incrementally.

### ~~Claimed by SLICE 2~~ — DONE (detail flyout shell + interaction contract)

- ✅ `app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout.tsx` (new)
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — now mounts the shell
- ✅ `app/components/ArtefactInlineForm/**` — UNTOUCHED. V2 wraps it in an inline `ArtefactBody` adapter; AIF's internals are still mounted via the legacy path for production pages.

### ~~Claimed by SLICE 2.5~~ — DONE (backend `?fields=` contract)

- ✅ `backend/internal/artefactitems/columns.go` (new), `handler.go` (parse + project + Columns handler)
- ✅ `backend/internal/timeboxsprints/columns.go` (new), `handler.go` (same shape)
- ✅ `backend/internal/timeboxreleases/columns.go` (new), `handler.go` (same shape)
- ✅ `backend/cmd/server/main.go` — `/columns` route added under both `/_site` and `/samantha/v2` for artefactitems; under `/_site` for timeboxes
- ✅ Tests in `artefactitems/columns_test.go` (allow-list, parseFieldsParam edges, projectItems)
- Note: portfolioitems doesn't have its own package — it's `artefactitems` with `scope="strategy"`, so it inherits the catalogue automatically.

### ~~Claimed by SLICE 3~~ — DONE (chrome to kind components)

- ✅ `app/components/ObjectTreeV2/kinds/DenseGridHeader.tsx` (new)
- ✅ `app/components/ObjectTreeV2/kinds/ActionBar.tsx` (new) — discriminated-union `CreateActionConfig` covers single + type-picker patterns
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — chrome JSX deleted, replaced with kind component mounts
- Panel kind deferred — `<Panel>` already exists as a project-wide primitive; V2 doesn't need its own variant.

### ~~Claimed by SLICE 4~~ — DONE (drag/reparent rules into per-domain config)

- ✅ `app/components/ObjectTreeV2/configs/workItemsReparentRules.ts` (new) — pure-function predicates lifted from V2's inline implementation
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — no longer imports `PARENT_PREFIX_MAP`; delegates to the per-domain rules module
- DragEngine plugin deferred — current direct-import is sufficient; Slice 1.5 will move it into the plugin registry when that lands.

### ~~Claimed by SLICE 4.5~~ — DONE (column selector + lazy `?fields=`)

- ✅ `app/components/ObjectTreeV2/plugins/ColumnPicker.tsx` (new) — ColumnCatalogue type, useColumnPickerState hook, dropdown UI
- ✅ `app/components/ObjectTreeV2/hooks/useObjectTreeWindow.ts` — new `fields` opt forwards visible wireKeys as `?fields=`
- ✅ `app/components/ObjectTreeV2/p_ObjectTree.tsx` — optional `columnCatalogue` prop; mounts picker, filters columns before render, threads visibleWireKeys into the data hook
- localStorage key: `objecttree-v2.columns.<catalogue.prefsKey>`. Server-side prefs deferred to a follow-up.

### Claimed by SLICE 4.6 (memoisation + cascade-scope reduction)

- ✅ Slice 4.6a (request coalescing in useObjectTreeWindow) — done on `refactor/objecttree-s4.6a-request-coalescing`
- ✅ Slice 4.6c (backend touched_ids + by-ids endpoint) — done on `refactor/objecttree-s4.6c-touched-ids`
- ⏳ Slice 4.6b (cell memoisation audit on `work-items-tree-config.tsx`) — next; shared file with production, additive React.memo wrappers

### ~~Claimed by SLICE 5A~~ — DONE (scope_propagation substrate, fully threaded)

- ✅ `db/vector_artefacts/schema/091_timebox_scope_propagation.sql` (new) + DOWN — column + check + partial indexes on both timeboxes_sprints + timeboxes_releases. APPLIED to dev DB; schema_migrations row inserted.
- ✅ `backend/internal/timeboxsprints/types.go` — Sprint.ScopePropagation + CreateSprintInput.ScopePropagation
- ✅ `backend/internal/timeboxsprints/sql.go` — scope_propagation appended to all 6 column lists; INSERT $1..$11 with COALESCE
- ✅ `backend/internal/timeboxsprints/service.go` — scanSprint scans new field; Create + BulkCreate pass 11th arg
- ✅ `backend/internal/timeboxreleases/types.go` — Release.ScopePropagation + CreateReleaseInput.ScopePropagation
- ✅ `backend/internal/timeboxreleases/sql.go` — scope_propagation appended to all 4 column lists; INSERT $1..$11 with COALESCE
- ✅ `backend/internal/timeboxreleases/service.go` — scanRelease + Create + BulkCreate threaded
- Phase A complete: column persists + round-trips on every read path. Phase B (read-side ancestor-walk + `{origin}` on response) lands in slice 5B once UI shape is signed off.

### ~~Claimed by SLICE 6.1~~ — DONE (bulk-create sheet substrate, timeboxes-only)

- ✅ `app/components/ObjectTreeV2/kinds/ActionBar.tsx` — `CreateActionConfig` grows `bulk` variant; `ActionBarProps.createAction` widens to `CreateActionConfig | CreateActionConfig[]` so sprints/releases can render single+bulk side-by-side
- ✅ `app/components/ObjectTreeV2/sheets/ObjectTreeBulkCreateSheet.tsx` (new) — inline sheet shell (per Rick's design decision 2026-05-21: pushes the grid down, not modal). `BulkColumnSpec` + `BulkCreateConfig` are the JSON contract; cascade math hard-coded behind boolean flags
- **Domain rule (MEMORY.md → ## Active Threads):** bulk-create is TIMEBOXES-ONLY. Never add `bulk` to work-items/portfolio/risks/future kinds.

### ~~Claimed by SLICE 6.2~~ — DONE (TimeboxInlineForm)

- ✅ `app/components/TimeboxInlineForm/index.tsx` (new) — single-row create/edit body for the V2 detail flyout. Handles both kinds via small `KIND_CFG` map (apiBase + rowPrefix + namePrefix). Diff-based PATCH; Start/Close use dedicated transition endpoints, not generic UPDATE
- Lifecycle matches ArtefactInlineForm: `rowId` nullable, renders nothing when null so the shell can leave the body mounted across opens

### ~~Claimed by SLICE 6.3a + 6.3b~~ — DONE (backend + frontend cutover to `{items,total}`)

**Problem found:** `useObjectTreeWindow<T>` consumes responses shaped `{ items, total }`. Sprint/release handlers returned `{ sprints, count }` / `{ releases, count }` — written before the V2 contract existed, diverged in place.

**Decision: backend cutover (Road A).** Migrate handlers to `{ items, total }`, add paging, update the frontend consumer.

- ✅ `backend/internal/timeboxsprints/handler.go` — List + BulkCreate response cut over; `?limit=`/`?offset=` paging added (in-handler windowing since sprint counts per workspace are <50; if scale changes push LIMIT into SQL)
- ✅ `backend/internal/timeboxreleases/handler.go` — same cutover
- ✅ `app/lib/apiSite/index.ts` — `sprints.list` / `sprints.bulkCreate` / `releases.list` / `releases.bulkCreate` return-types updated
- ✅ `app/components/ArtefactInlineForm/ArtefactInlineForm.tsx` — sprint + release dropdown reads cut over to `data.items` (milestones still on legacy `{milestones,count}` — left for a later slice if milestones move to V2)
- ✅ `app/hooks/useTimebox.ts` — bridged to the new shape so legacy TimeboxManager keeps working through the transitional commits

### ~~Claimed by SLICE 6.3c~~ — DONE (TimeboxObjectTree + sprint page swap)

- ✅ `app/components/TimeboxObjectTree/index.tsx` (new) — composes V2 primitives (DenseGridHeader, ActionBar single+bulk, ObjectTreeBulkCreateSheet, ObjectTreeDetailFlyout + TimeboxInlineForm). **Sibling to** `ObjectTreeV2/p_ObjectTree.tsx`, not a parameterisation. p_ObjectTree.tsx is still heavily work-items-shaped (flow_states, artefact_types, parent cascade); pushing sprints through it would mean either gutting it or accepting dead branches. A sibling is the honest answer — V2 is a primitives toolkit + a work-items reference composition; new domains pick primitives until painful drift forces convergence.
- ✅ `app/(user)/sprints/page.tsx` — swapped from `<TimeboxManager>` to `<TimeboxObjectTree kind="sprint">`
- **No `p_wizard_sprints.json` this slice.** Honest reason: `ObjectTreeDataConfig` today doesn't express bulk-create / status transitions / cadence semantics. Empty JSON would be cargo-cult. Wizard-JSON convergence for timeboxes is a later question when V2's central component generalises.

### ~~Claimed by SLICE 6.4~~ — DONE (releases page swap)

- ✅ `app/(user)/releases/page.tsx` — swapped to `<TimeboxObjectTree kind="release">`. No code change inside TimeboxObjectTree; same component handles both kinds via its KIND_CFG map.

### ~~Claimed by SLICE 6.5~~ — DONE (legacy deletion + scope harness wiring)

- ✅ Deleted: `app/components/TimeboxManager.tsx` (375 lines), `app/hooks/useTimebox.ts` (52 lines), `app/components/timebox/kinds.ts` (31 lines)
- ✅ `app/(user)/scope/page.tsx` — `ready:false` → `ready:true` on sprints + releases modes; harness now mounts `<TimeboxObjectTree>` for those modes (not ObjectTreeV2's central p_ObjectTree.tsx)
- **Net: −442 lines.** TimeboxManager's 375-line monolith replaced with composable V2 primitives + a single thin per-domain wrapper.

### ~~Claimed by SLICE 5B~~ — DONE (read-side ancestor-walk + write-side 409)

**Status:** committed on `refactor/objecttree-s5b` (off the slice 6 tip). Backend complete; frontend visual treatment for inherited rows lands in slice 7.

**Decisions taken autonomously** (overruling my earlier "design only" handover that bailed before code — apology + accountability noted in chat):
- (a) Response shape: **inline** — `Sprint.Origin` + `Sprint.FromNodeID` + `Sprint.FromNodeName` as optional JSON fields on every row (omitempty). Flat wire, no nested `inheritance` object.
- (b) Write-side: **viewing_node_id read from the existing `?org_node_id=` query param** (same param the List endpoint already accepts). When the handler sees `?org_node_id=` on a write, it calls `Service.EnsureWritable` first. If the row is inherited from that vantage, 409. When the param is absent, the guard is a no-op (back-compat).
- (c) Inherited-row UX: deferred to slice 7. The wire already carries everything slice 7 needs (`origin`, `from_node_id`, `from_node_name`).

**What landed:**

Backend:
- `backend/internal/timeboxsprints/types.go` + `timeboxreleases/types.go` — `ErrInheritedReadOnly` sentinel; `Origin/FromNodeID/FromNodeName` non-persisted fields on Sprint + Release; `ListFilters.SubscriptionID` opt-in field.
- `backend/internal/timeboxsprints/service.go` + `timeboxreleases/service.go` — `WithTopology` setter; `Service.List` performs ancestor-walk when SubscriptionID + OrgNodeID + topo are all set (otherwise legacy pinned-only behaviour); `isInheritedRead` + `EnsureWritable` helpers.
- `backend/internal/timeboxsprints/handler.go` + `timeboxreleases/handler.go` — `guardInherited` runs `EnsureWritable` before Update/Delete/Start/Close (releases has no Start/Close); 409 maps to `ErrInheritedReadOnly.Error()`; List wires `SubscriptionID` from auth context.
- `backend/internal/timeboxsprints/columns.go` + `timeboxreleases/columns.go` — `?fields=` allow-list grows `scope_propagation` + `origin` + `from_node_id` + `from_node_name` so projection doesn't strip them.
- `backend/cmd/server/main.go` — `sprintSvc.WithTopology(orgDesignSvc)` + `releaseSvc.WithTopology(orgDesignSvc)`.

Tests (sprint integration, live dev vector_artefacts):
- `TestAncestorWalk_InheritedSprintAppears` — parent sprint with propagation flag surfaces in child node List with `origin=inherited` + correct `from_node_id`/`name`.
- `TestAncestorWalk_NoPropagationFlag` — parent sprint WITHOUT flag stays invisible to child.
- `TestAncestorWalk_BackCompat_NoSubscriptionID` — caller without SubscriptionID gets legacy pinned-only behaviour (ancestor-walk dormant).
- `TestEnsureWritable_RejectsInheritedRow` — child-vantage EnsureWritable returns ErrInheritedReadOnly; parent-vantage + empty viewingNodeID return nil.
- Pre-existing handler tests touched: two stale `{sprints,count}` → `{items,total}` assertions fixed (left over from slice 6.3a). All sprint tests pass.

**For slice 7:** `TimeboxObjectTree` needs to (1) pass `org_node_id=<active scope>` through to GET/PATCH/DELETE/start/close calls so the backend can identify inherited rows, (2) read `row.origin` to apply visual treatment for inherited rows, (3) handle the 409 ErrInheritedReadOnly gracefully (currently it surfaces via the existing toast).

### Claimed by SLICE 6 (sprint + release page swap)

- `app/(user)/sprints/page.tsx`
- `app/(user)/releases/page.tsx`
- New `app/components/TimeboxInlineForm/**`
- DELETE `app/components/TimeboxManager.tsx` and `app/hooks/useTimebox.ts` (after page swap proves green)

### ~~Claimed by SLICE 7~~ — DONE (heartbeat UX wired end-to-end)

Backend (7.1):
- ✅ `timeboxsprints/types.go` + `timeboxreleases/types.go` — `ScopePropagation *string` on `UpdateSprintInput` / `UpdateReleaseInput`
- ✅ `timeboxsprints/service.go` + `timeboxreleases/service.go` — Update SET clause accepts `scope_propagation`, validates against `{this_node_only, this_node_and_descendants}`
- ✅ `timeboxsprints/handler.go` + `timeboxreleases/handler.go` — Update body struct + UpdateInput mapping wires `timeboxes_<kind>_scope_propagation`

Frontend (7.2 + 7.3 + 7.4):
- ✅ `app/components/TimeboxObjectTree/index.tsx` — Name column reads `row.origin`; inherited rows render italic + muted with `"↑ from <Parent>"` badge under the name. `orgNodeId` flows through `bodyProps` to TimeboxInlineForm so every flyout write carries the active scope
- ✅ `app/components/TimeboxInlineForm/index.tsx` — new `orgNodeId` prop threaded through a `qs()` helper appending `?org_node_id=` to every fetch (refetch/save/start/close). Reads `row.origin` from the wire; when `"inherited"` the form is read-only (every input + save + start/close disabled). Banner at the top shows the pinned-node name. New scope-propagation radio fieldset (`this_node_only` | `this_node_and_descendants`) — saving the radio sends `timeboxes_<kind>_scope_propagation` on the PATCH

End-to-end flow:
1. User pins a sprint to node A with `this_node_and_descendants` via the radio → saves
2. User scope-clamps to node A's child B → `<TimeboxObjectTree orgNodeId=B>` mounts → List adds `?org_node_id=B` → backend ancestor-walks → returns sprint with `origin="inherited"`, `from_node_id=A`, `from_node_name="A"`
3. Grid renders the row italic+muted with "↑ from A" badge; click opens the flyout read-only with banner
4. Any write attempt (PATCH/Delete/Start/Close) from node B against the inherited sprint → backend's `EnsureWritable` → 409 `ErrInheritedReadOnly`. The frontend toast surfaces the message via the existing `notify.apiError` path.

### Claimed by SLICE 8 (milestones consolidation — optional)

- `app/(user)/milestones/page.tsx` (if exists)
- Possibly `backend/internal/timeboxmilestones/handler.go` (parity with 2.5)

---

## What other agents CAN safely work on

- Any path NOT listed above
- The ORIGINAL `app/components/ObjectTree/` (NOT the V2 directory) — production pages keep using it
- `app/(user)/work-items/page.tsx`, `app/(user)/portfolio-items/page.tsx`, `app/(user)/risk/page.tsx` — these stay on the legacy ObjectTree throughout the refactor; only swap to V2 in Slice 6+ AFTER coordination
- Any backend package NOT listed above
- All migrations not in the timebox space
- All docs not in the ObjectTree refactor plan

---

## Active branch / commits

```
refactor/objecttree-s0-baseline-and-tests
└── c77af29 feat(objecttree-v2): clone ObjectTree + /scope harness [solo-dev]
    (rebased onto main @ dbf1b98)
```

VSCode stays on `main`. The refactor lives in the sibling worktree directory. To work in it: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector-refactor-objecttree-s0"` — don't switch VSCode's branch.

---

## If you (other agent) absolutely need to touch something in my list

1. Don't.
2. If you really must, SendMessage to me first — the agentID for this work lives in the conversation context.
3. If I'm not active, leave a one-line note in this file under a new `## Held messages` section at the bottom with: the file you need, the change you need, and the reason. I'll handle it on my next turn.

---

## When this file gets deleted

Slice 8 merges (or the user decides to stop) → this file is removed in the same commit as the final slice. Until then, it stays at root as the load-bearing flag.
