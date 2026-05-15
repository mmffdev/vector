---
name: Portfolio Templates Migration — Handoff to Next Agent
description: Summary of R010 portfolio model redesign; what shipped, what's next, migration + schema state
type: project
---

> **Historical document.** Planka was decommissioned 2026-05-15; references to Planka cards or boards below are frozen snapshots from when this handoff was written. Current story tracker = `dev/plans/PLA-NNNN.json` `work_item_backlog`.


## What Just Shipped

**Stories 00167–00170** — Portfolio model table restructure (R010):

- **00167** — `db/library_schema/010_portfolio_templates.sql` 
  - Drops 7 old tables: `portfolio_models`, `portfolio_model_layers`, `portfolio_model_workflows`, `portfolio_model_workflow_transitions`, `portfolio_model_artifacts`, `portfolio_model_terminology`, `portfolio_model_shares`
  - Creates `portfolio_templates(id, name, description, layers JSONB, created_at, updated_at)`
  - Layers array: index 0 = top tier (strategy), last = leaf (feature/execution)

- **00168** — `db/library_schema/seed/004_portfolio_templates.sql`
  - Seeds 5 framework models with original UUIDs preserved:
    - Vector Standard: `PRW→PR→BO→TH→FT`
    - Enterprise: `SO→PO→BE→BC→FE`
    - Rally: `ST→IN→FE`
    - SAFe: `STH→PBL→PGB→FE`
    - Jira: `IN`
  - Each layer is `{tag, name}` object in JSONB array

- **00169** — Backend API updated
  - `backend/internal/librarydb/list.go`: `ListPublishedModels` reads from `portfolio_templates`; unmarshals layers via `TemplateLayer` type (avoids redecl conflict with `bundle.go` Layer)
  - `backend/internal/portfoliomodels/list.go`: wire shape updated — `Layers []templateLayerDTO` replaces old `LayerSummary`, `LayerCount`, `Version`, `ModelFamilyID` fields
  - Backend compiles clean ✅

- **00170** — Frontend updated
  - `app/(user)/portfolio-model/WizardModelCardList.tsx`: consumes `layers: TemplateLayer[]` directly from API
  - Diagram renders top-down (index 0 at top) — **block order bug fixed** ✅
  - Removed redundant frontend sort (backend ORDER BY handles Vector Standard first); version badge removed
  - TypeScript clean ✅

## Critical: Adoption Saga Bridge

**The adoption saga** (`backend/internal/portfoliomodels/adopt.go`) still mirrors into tenant-side tables. The old `FetchByModelID` queried `portfolio_models` + 5 child tables (all now dropped). I added a new function to bridge this:

**`librarydb.FetchTemplateByID`** (in `backend/internal/librarydb/fetch.go`):
- Reads `portfolio_templates` JSONB row
- Synthesises a `Bundle` with layers (synthesised `sort_order = index`, `is_leaf = last`, `allows_children = !is_leaf`)
- Workflows/Transitions/Artifacts/Terminology are empty slices (templates don't define them)
- Updated `adopt.go` line 264 to call `FetchTemplateByID` instead of `FetchByModelID`

**This means adoption still works** — the saga writes layers to `subscription_layers` using the synthesised data.

## What's NOT in portfolio_templates

The new table is flat JSONB layers only. It **does not** include:
- Workflows / states / state transitions (no longer in library schema)
- Artifacts / terminology (no longer in library schema)
- sort_order, parent_layer_id, icon, colour, description_md, help_md (these were per-layer customization in the old model; templates are now just sequence definitions)
- version, model_family_id, key, scope, visibility, feature_flags (model-level metadata gone)

The synthesis step generates dummy values (sort_order=index*10, is_leaf=last, allows_children=!is_leaf) to keep the saga happy. If workflows/artifacts/terminology ever come back, that's a new story.

## Dev Database State

- ✅ Migration `010_portfolio_templates.sql` runs on dev (drops old schema, creates new)
- ✅ Seed `004_portfolio_templates.sql` populates 5 models
- ❌ Migrations NOT yet applied to staging/production (they still have old schema)

If staging/prod need the new schema, you'll need to:
1. Dump dev: `pg_dump -Fc mmff_library > /tmp/lib_latest.dump`
2. Drop staging/prod: `dropdb mmff_library` (on each remote)
3. Restore: `pg_restore --no-owner --role=mmff_dev -d mmff_library < /tmp/lib_latest.dump`

Or run migrations 010 + seed 004 directly on staging/prod if you prefer schema-only.

## Recent Commits

```
f0ad61f Portfolio model: replace portfolio_models+layers with portfolio_templates (R010)
fa9b004 WIP: Artefacts feature — schema, service, handler, routes (from parallel agent)
```

## Parallel Work in Flight

Another agent is working on artefacts (migrations 060/061, backend package). That's vector DB schema, not library DB, so no collision. The commits are already landed.

There's also `backend/internal/searchworker/` (untracked, WIP) and a modified `backend/server` binary — both from parallel agents.

## What's Next

1. **If you're running migrations on staging/prod**, apply 010 + seed 004
2. **If you're touching adoption**, the saga is now using `FetchTemplateByID` — test a full adoption flow end-to-end
3. **If you're building new portfolio features**, they now read from the flat `portfolio_templates` JSONB — no joins needed
4. Planka stories 00165–00166 (Portfolio Settings page, padmin-only) are still in Backlog — that's the next portfolio work

## Key Files

- `db/library_schema/010_portfolio_templates.sql` — migration (CREATE/DROP)
- `db/library_schema/seed/004_portfolio_templates.sql` — seed data
- `backend/internal/librarydb/list.go` — `ListPublishedModels` + `TemplateLayer` type
- `backend/internal/librarydb/fetch.go` — `FetchTemplateByID` (new function for saga)
- `backend/internal/portfoliomodels/adopt.go` — line 264 calls `FetchTemplateByID`
- `app/(user)/portfolio-model/WizardModelCardList.tsx` — frontend consumption

All compiling, TypeScript clean, ready for next phase.
