# Handover 2 — PLA-0026 wrap state

**Date:** 2026-05-07
**Branch:** main (57+ commits ahead of origin/main as of last check; verify `git status` after pull)
**Last commit:** `dc01be5 test(PLA-0026/00504 T4): saga-level integration test — re-adoption preserves parent_artefact_id NOT NULL`

## TL;DR

PLA-0026 (Per-Workspace Portfolio Adoption Cutover to vector_artefacts, 37 stories) **active execution is complete**. All B/F/M/T-series cards are in Planka **Completed**. Nine cards remain in **To Do** as deferred sanitisation/audit drops gated on 7-day deployment soaks — not actionable until those soaks elapse.

## What just shipped (this session)

**T4 / Story 00504 — re-adoption parent invariant test**

- File: [`backend/internal/portfoliomodels/adopt_readopt_saga_test.go`](backend/internal/portfoliomodels/adopt_readopt_saga_test.go)
- Saga-level integration test: across two `Adopt()` cycles with different models (aa01 → bb01), a tracer work artefact parented under a cycle-1 strategy artefact must end up repointed (not orphaned) onto the placeholder artefact after cycle 2.
- Two consecutive PASS runs on dev DB (3.41s, 3.64s).
- Committed in `dc01be5`.

**Lifecycle hygiene completed:**

- `dev/research/R047.json` — both T4 rows (§13.8 prose row + `<tr id="track-T4">` story-mapped row) struck and marked `<strong>done</strong>`.
- `dev/plans/PLA-0026.json` — work_item_backlog order 29 → `done`; acceptance_criteria order 29 → `done: true`. `date_last_updated` already `"2026-05-07"`.
- Planka card `1769517112969135342` already in Completed list.

## Remaining PLA-0026 work — all deferred, all gated

Nine cards in Planka **To Do** waiting on time-based triggers. Do **not** start these until the trigger condition is met (gradual-DB-sanitisation rule):

| Story | Title | Gate |
|---|---|---|
| 00482 | Drop `strategy_layers_adopted` | B5 deployed ≥1 day |
| 00483 | Migration parity test (T1) | post-M6 |
| 00484 | Pre-migration audit assertion (T2) | gate for M2 |
| 00485 | Drop `obj_strategy_types_layers` (S1) | B3 deployed 7 days zero reads |
| 00486 | Drop `subscription_workflows` + transitions (S2) | B4 deployed 7 days |
| 00487 | Drop `subscription_artifacts` (S3) | B5 deployed 7 days |
| 00488 | Drop `strategy_layers_adopted` register row (S4) | M7 lands |
| 00489 | Drop `subscription_terminology` (S5) | terminology design lands |

Tracking lives in [`docs/c_c_v2_workitems_cutover_followups.md`](docs/c_c_v2_workitems_cutover_followups.md) and [`dev/plans/PLA-0026.json`](dev/plans/PLA-0026.json).

## Standing tech-debt observations (not yet carded)

Picked up while wrapping T4 — surface when next touched, but no card cut yet:

1. **`workspace` (singular) vs `workspaces` (plural) tables coexist in `mmff_vector`.** `resolveWorkspaceID` (adopt.go:475–493) queries `workspaces`. T3 was written against `workspace`. Both have rows for the seeded padmin subscription. Naming/schema inconsistency worth a register row.
2. **Cross-workspace `artefact_types` FK drift in dev DB.** `artefacts` rows in workspace `00000000-0000-0000-0000-000000000002` reference `artefact_types` in workspace `a4df2e21-...`. Forced T4 cleanup to skip type-wipes; instead per-run randomized prefixes avoid `artefact_types_prefix_unique_live` collisions. Production-side this likely doesn't apply, but dev-DB sanity is owed.
3. **`artefact_types_prefix_unique_live` is global, not workspace-scoped.** If you ever need workspace-scoped prefix uniqueness, that's a constraint rewrite.

These are observations — none warrant blocking work. Surface when adjacent code is touched.

## Pre-existing tech-debt items still open

- **S2 (F2)** — lockstep duplication between `dispatchFrame` and `handleFrame` in `AdoptionOverlay`.
- **S3 (F4 + F1)** — shared `WorkspaceContext` provider; fold when 3+ consumers.
- **F1 follow-up** — B12 card-vs-route name mismatch.
- **B13 follow-up** — workspace hard-delete still 501; new `workspace.delete` permission code deferred.
- **T6 follow-up** — 12 dev-data orphan workspace_ids cleanup.

## Working state on disk (uncommitted)

`git status` will show a long list of **unrelated** modified/deleted files predating PLA-0026 work — do NOT clean these up without the user's explicit go-ahead (HARD RULE: never wipe uncommitted). Notable buckets:

- `.claude/` memory and command renames (boot files removed; new feedback memories present).
- `MMFF Vector Launcher/` Swift updates.
- `corp-ident/`, `examples/`, `local-assets/launcher/` moved under `MMFFDev - Vector Assets/` (Untracked side; deletes on the original side).
- `db/artefacts_schema/025_timebox_sprints.sql` + DOWN — untracked, related to TimeboxManager.
- `dev/research/R045.json`, `R046.json` — untracked research drafts.
- `docs/c_c_timebox_manager.md` — untracked.
- `backend/.env.production.locked`, `backend/.env.staging.locked` — untracked, env-pin sentinels.

If you need to push only PLA-0026 work, the staged commits are already clean (the working-tree clutter above is **not** in any commit since this session opened).

## How to resume on the remote machine

```bash
# 1. Pull
cd "<vector repo>"
git pull origin main

# 2. Sanity check
git log --oneline -5
# expect: dc01be5 test(PLA-0026/00504 T4): ...

# 3. Verify PLA-0026 plan state
python3 -c "
import json
d = json.load(open('dev/plans/PLA-0026.json'))
todo = [w for w in d['work_item_backlog'] if w.get('status') != 'done']
ac_todo = [a for a in d['acceptance_criteria'] if not a.get('done')]
print(f'work_item_backlog todo: {len(todo)}')
print(f'acceptance_criteria todo: {len(ac_todo)}')
print('expected: 8 work_items, 9 AC — all deferred drops/audits')
"

# 4. Confirm board state (optional — needs Planka tunnel on :3333)
./.claude/bin/planka board 2>/dev/null | grep -E "^id=.*(00482|00483|00484|00485|00486|00487|00488|00489) " | head
# expect: all in listId for "To Do"
```

## Active backend pin

- **`BACKEND_ENV=dev`** (HARD RULE — pinned). Tunnel `localhost:5435` → dev VPS Postgres. Env file: `backend/.env.dev`. Do not switch without typed user request.
- Planka tunnel: `localhost:3333`.

## Next concrete unit of work

Nothing actionable in PLA-0026 right now. Either:

1. **Wait** — soaks elapse, then knock off 00485 → 00489 in order as their gates clear. Each is a single migration drop + plan flip.
2. **Move to next plan** — check [`docs/c_plan_index.md`](docs/c_plan_index.md) for the next active PLA. PLA-0024 (subscriptions cutover to `master_record_tenant`) was the most recent one before PLA-0026.
3. **Tech-debt cleanup** — pick from the open list above; F2 (`dispatchFrame`/`handleFrame` lockstep) is the most concrete.

## Files of interest

- [`backend/internal/portfoliomodels/adopt.go`](backend/internal/portfoliomodels/adopt.go) — orchestrator, `resolveWorkspaceID`, isReadoption gate (line 244)
- [`backend/internal/portfoliomodels/adopt_readopt.go`](backend/internal/portfoliomodels/adopt_readopt.go) — `runReadoption` placeholder + repoint logic
- [`backend/internal/portfoliomodels/adopt_readopt_saga_test.go`](backend/internal/portfoliomodels/adopt_readopt_saga_test.go) — T4 (this session)
- [`backend/internal/portfoliomodels/adopt_va_only_test.go`](backend/internal/portfoliomodels/adopt_va_only_test.go) — T3 (prior session)
- [`backend/internal/portfoliomodels/handler_workspace_layers.go`](backend/internal/portfoliomodels/handler_workspace_layers.go) — B10 cutover endpoint
- [`app/(user)/portfolio-model/LayersPreviewTable.tsx`](app/(user)/portfolio-model/LayersPreviewTable.tsx) — F5 placeholder badge surface
- [`dev/plans/PLA-0026.json`](dev/plans/PLA-0026.json) — plan source of truth
- [`dev/research/R047.json`](dev/research/R047.json) — design reference

---

_Wrote on cookra@me.com's local; safe to delete after pickup._
