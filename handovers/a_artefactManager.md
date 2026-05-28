# Artefact Manager — Artefact Types admin page

**Surface:** `/workspace-admin/artefacts/artefact-types` (file: `app/(user)/workspace-admin/artefacts/artefact-types/page.tsx`)
**Goal:** mount the page on `<ObjectTreeV2>` with `ActionBar` chrome and a per-scope **Create** action (one "New Execution Type", one "New Strategy Type"). No drag-reorder (deferred to flow-states reorder mechanic).
**Started:** 2026-05-29
**Status:** Design locked. Sequencing question open. No code written yet.

---

## What this surface is

The workspace-admin editor for **artefact type definitions** — the rows on `vector_artefacts.artefacts_types` that answer "what kind of artefact is it?". Two scopes:

- **work** (Execution) — Story, Defect, Task, Epic, … (sprint-tracked, flat hierarchy)
- **strategy** (Strategic) — Theme, Business Objective, Feature, … (Rally hierarchy via `parent_type_id`)

Each row carries: `prefix` (1-4 uppercase, unique per `(subscription, scope)` among live rows), `name`, `description`, `colour`, `parent_type_id`, `layer_depth` (0-9), `sort_order`, `source` (`system` | `tenant`).

Current page is read + inline-patch only — no create, no reorder. User flagged this: "this page needs to use the objecttree for our artefacts, it needs the action bar and it needs a create new artefact type per section, one for execution and one for strategic."

---

## Key memory loaded this session

**`memory/project_otv2_refactor_intent.md`** — ObjectTreeV2 is being intentionally genericised to a stateless, row-type-orthogonal primitive. The inner generics (`useObjectTreeWindow<T>`, `ResourceTree<T>`, `ObjectTreeDataConfig<T>`) are **already done**. The WorkItem-specific imports in `p_ObjectTree.tsx` are the **unfinished part** of an in-progress refactor, not the intended end state. Spec: `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md`.

**What this means for artefact-types:** the proper foundation move is to land the OTV2 genericisation per that spec, then mount artefact-types as a second non-WorkItem adapter (alongside the planned `customFieldsAdapter`). Anything else is drift or a hack.

---

## Design decisions (locked)

1. **Use `<ObjectTreeV2<ArtefactType>>` literally** via the planned `ObjectTreeAdapter<T>` interface — NOT a chrome-copy over `ResourceTree`. (User pushed back on the chrome-only path; correctly.)

2. **Two create chips** wired via `ActionBar`'s existing `createAction: CreateActionConfig[]` surface — `single` mode each. No new ActionBar work needed; the array shape is already supported.
   - `{ mode: "single", label: "New Execution Type", onCreate: () => openCreate("work") }`
   - `{ mode: "single", label: "New Strategy Type",  onCreate: () => openCreate("strategy") }`

3. **Inline-row create UX** (approved):
   - Click chip → placeholder editable row appears at bottom of corresponding scope section
   - Focus jumps to Name; Tab cycles Name → Prefix → Colour; Enter saves; Esc cancels
   - On success: replace placeholder with returned row (real id, real sort_order)
   - Validation errors surface inline via existing `InlineEditField` red-state

4. **No drag-and-drop** on this page — deferred to the flow-states reorder mechanic. User's call. `sort_order` retains current semantics.

5. **Section split = scope-divider rows** (today's pattern), NOT one-panel-per-scope. Section header is a non-editable divider row inside the same grid; matches what's on the page now.

---

## Phase plan

### Phase 1 — OTV2 genericisation (gating refactor)

Execute the existing spec `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md` end-to-end:
- Genericise `app/components/ObjectTreeV2/p_ObjectTree.tsx` to `<T>`; introduce `ObjectTreeAdapter<T>` interface (`app/components/ObjectTreeV2/adapters/types.ts`)
- Extract WorkItem-specific orchestration into `workItemsAdapter.tsx` (default — 5 production mounts keep working unchanged)
- Build `customFieldsAdapter.tsx` + rebuild custom-fields page (per spec §4.3, §4.5)
- `/[id]` redirect (per spec §4.4)
- Repaint inline-styled buttons (per spec §4.6)

**5 production mounts to verify unchanged after Phase 1:**
work-items, portfolio-items, risk, value-sprint sprint-panel, value-sprint backlog.

### Phase 2 — Artefact-types as the second non-WorkItem adapter

Once Phase 1 ships, this work becomes a small follow-on PR:

**New files:**
- `app/components/ObjectTreeV2/adapters/artefactTypesAdapter.tsx`
  - `buildColumns()` — lifts the 6 existing inline-edit columns: Tag, Name, Description, Parent type, Layer, Colour
  - `useFiltersAndSort()` — scope chip filter (All / Execution / Strategy), sort by `sort_order`
  - `patchRow(id, body)` — calls `artefactTypesApi.patch(id, body)`
  - `buildCreateAction()` — returns array of two `single`-mode chips (see #2 above)
  - `renderRowFlyout` — not used (artefact types edit inline)
- `app/components/ObjectTreeV2/configs/p_wizard_artefact_types.json`
  - `dataType: "artefact_types"`, `resourceUrl: "/artefact-types"`, `treeName: "artefacttypes"`, `dndEnabled: false`, `defaultSortKey: "sort_order"`

**Backend additions:**
- `backend/internal/artefacttypes/handler.go` — add `r.Post("/", h.Create)` + `Create` method. 422 with `violations[]` on validation failure; 409 on prefix collision per the partial unique index `artefact_types_prefix_unique_live`.
- `backend/internal/artefacttypes/service.go` — add `Create(ctx, subscriptionID, workspaceID, in CreateInput) (*ArtefactType, error)`. Reuses Patch validators (name 1-64, prefix 1-4 `[A-Z0-9]+`, colour `#RRGGBB`). Sets `sort_order = max(sort_order) + 10` within `(subscription, scope)`. Forces `source='tenant'`. Sentinel-clamped via `sentinel.WorkspaceIDFromCtx`.
- `backend/internal/artefacttypes/types.go` — add `CreateInput` struct.

**Frontend API:**
- `app/lib/artefactTypesApi.ts` — add `create(body: CreateInput): Promise<ArtefactType>` → POST `/artefact-types`.

**Page rewrite** (`app/(user)/workspace-admin/artefacts/artefact-types/page.tsx`):
- Strips from ~380 LOC to ~30 LOC. All column / row / scope-divider / patch logic moves into the adapter.
- New shape:
  ```tsx
  <ObjectTree<ArtefactType>
    title="Artefact Types"
    addressableName="artefact_types_grid"
    subtitle="Definition catalogue"
    description="Create and manage the artefact type definitions used across the workspace."
    adapter={artefactTypesAdapter()}
    wizardConfig={resolveWizardConfig(artefactTypesWizardJson)}
  />
  ```

**Docs:**
- `docs/c_tech_debt.md` — one entry: `TD-ARTTYPES-DND` (drag-reorder of artefact types within scope; pay down when the flow-states reorder mechanic lands).

---

## HARD-RULE compliance checklist (for the eventual implementer)

- **SERVER IS THE GATE** — all Create validation in `service.go`; frontend re-validation is defence-in-depth only.
- **SENTINEL** — Create reads `auth.User.SubscriptionID` + `sentinel.WorkspaceIDFromCtx`. Writes `subscription_id` + `workspace_id` columns directly. No client-supplied scope.
- **NEVER ASSUME A DATABASE** — `vector_artefacts.artefacts_types` via `vaPool`. Already wired (List + Patch use it).
- **NO HACKS** — on prefix collision return 409 with the conflicting prefix in the body; never silent-suffix the prefix.
- **EVERY COLUMN PREFIX** — table is post-rename `artefacts_types` with `artefacts_types_*` columns (the Go service.go already uses these). No new column-name violations to introduce.
- **HUMAN ACCOUNTS** — N/A (this surface doesn't touch credentials).
- **INSPECT INDEX BEFORE COMMIT** — `git diff --cached --stat` before every commit; explicit-path `git add` is additive.

---

## Where to pick up next

**P1 — Decide the sequencing.** Three options were on the table, user interrupted before answering:
  1. **Land Phase 1 first, then artefact-types** (Recommended) — two PRs, clear seams. Custom-fields ships its UX win in PR1; artefact-types in PR2. Strictly correct ordering per the existing spec.
  2. **One mega-PR** — both adapters land together; stronger correctness signal for the genericisation (two consumer shapes proven at once); bigger blast radius.
  3. **Artefact-types only, defer Phase 1** — ships the user-visible feature today but creates the drift the memory + spec warn against. NOT recommended.

**P2 — Once sequencing is chosen, start with Phase 1 implementation per `2026-05-28-objecttree-generic-rowtype-design.md` §7 file plan.** Spec is detailed enough to drive directly.

**P3 — Phase 2 implementation** (per file list above). Each piece is small and well-scoped.

---

## Known caveats

- **Original framing was wrong** — early in the session I framed ObjectTreeV2 as hardwired to WorkItem and proposed three paths (literal swap / chrome over ResourceTree / brainstorm). User correctly pushed back ("no it isnt we use it on portfolio-items") and pointed to the existing memory + spec. The chrome-over-ResourceTree fallback I described mid-session is the WRONG path — do NOT revert to it. The literal `<ObjectTree<ArtefactType>>` mount via adapter is the answer.
- **OTV2 spec already exists** — `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md` is authoritative for Phase 1. Don't re-spec it; execute it.
- **`p_wizard_*.json` sidecars** — current pattern: pages load JSON via `resolveWizardConfig()` from `app/lib/wizardLoader.ts`, then build runtime functions inline (`buildWorkItemsFunctions()`). After Phase 1 the runtime-function building moves into the adapter, so `p_wizard_artefact_types.json` only needs the static fields (label, resourceUrl, scope, etc.).
- **Two databases active per env** — `vector_artefacts` (vaPool, where `artefacts_types` lives) and `mmff_library` (libPools, read-only spine). Legacy `mmff_vector` was dropped 2026-05-26.
- **`source='system'` rows are immutable** — schema permits patches but UX/service should refuse Create-with-source=system and refuse Patch on immutable fields of system rows. Existing Patch doesn't enforce this — flag as `TD-ARTTYPES-SYSTEM-GUARD` if not picked up in Phase 2.

---

## Files already read this session

- `app/(user)/workspace-admin/artefacts/artefact-types/page.tsx` (378 lines, current implementation)
- `app/lib/artefactTypesApi.ts` (70 lines — list + patch + resync; no create)
- `backend/internal/artefacttypes/handler.go` (112 lines — List + Patch only)
- `backend/internal/artefacttypes/service.go` lines 1-259 (List + Patch service)
- `db/vector_artefacts/schema/003_artefact_types.sql` (94 lines — original schema; live table is post-rename to `artefacts_types`)
- `app/components/ObjectTreeV2/p_ObjectTree.tsx` lines 1-300 (orchestration layer with WorkItem coupling)
- `app/components/ObjectTreeV2/configs/p_wizard_portfolio.json` (15 lines — reference sidecar)
- `app/components/ObjectTreeV2/kinds/ActionBar.tsx` (223 lines — full surface)
- `app/(user)/portfolio-items/page.tsx` (148 lines — reference OTV2 mount)
- `app/lib/wizardLoader.ts` (40 lines)
- `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md` (343 lines — Phase 1 spec)
- `memory/project_otv2_refactor_intent.md` (project memory — OTV2 refactor intent)
