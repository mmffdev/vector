# Per-Type Form Layout Builder — Design

**Date:** 2026-05-30
**Status:** Approved (business answers captured), ready for implementation plan
**Supersedes scope of:** `2026-05-30-form-layout-builder-design.md` (PoC, single-type)

## Synopsis

The Form Layout Builder PoC authors ONE form (User Story / `wrk_story`) against a topology node. This design generalises it to **every artefact type the tenant has loaded** — strategic (Feature, Theme, Business Objective, Product, Portfolio Runway) and execution / work (Story, Defect, Risk, Task, Epic). The padmin picks the type from a **grouped dropdown** on the launch panel (no extra click — the dropdown IS the entry), and the builder opens scoped to that type: its sidebar shows **only the fields that legitimately belong to that type**, both core and custom. A defect never sees WSJF; an epic never sees Steps-to-Reproduce.

## Problem

Three gaps between the PoC and the requirement:

1. **Entry is single-type.** `FormBuilderLaunchPanel` resolves `wrk_story` and launches one builder. There is no type chooser.
2. **Core fields are NOT type-scoped.** `formlayouts.Service.CoreFields()` returns the entire `ArtefactItemColumns` list (77 columns) for every type. Custom fields ARE already type-scoped (via `artefacts_types_fields`); core fields are not.
3. **No mandatory-per-type rule.** The save gate uses a single global `["title","flow_state_name","owner"]` for all types.

## Approach

### Single source of truth for field→type applicability

The DB already owns this knowledge. Migration `158_artefacts_slot_gate_trigger.sql` enforces, at INSERT/UPDATE time, which core columns may be non-null for which `artefacts_types_slot` / `artefacts_types_scope`. That trigger is the **authoritative rubric**. We must NOT invent a second, divergent mapping.

**Decision: encode the same families once in Go, pin it to the trigger with a test.**

- Add an `AppliesTo` predicate to `ColumnSpec` (Go) expressing the same slot/scope families the trigger encodes. Default = universal (applies to every type) — matches the trigger, which only gates the named families and lets everything else through.
- `CoreFields(slot, scope)` filters `ArtefactItemColumns` by `AppliesTo(slot, scope)`.
- A Go test (`columns_slot_gate_test.go`) asserts the Go families match the trigger families exactly (the defect-8+4, risk-7, task-2, defect|risk submitted_by, strategy-3 sets from mig 158). If migration 158 changes, the test breaks — the two can't drift silently.

This keeps **SERVER IS THE GATE** intact: the trigger remains the hard enforcement at the data layer; the Go rubric is the *presentation* filter (which fields the builder offers) AND the *save-validation* filter (reject a layout that places a field not applicable to its type). Both derive from one rubric.

Why not read the trigger definition at runtime? It's plpgsql branching, not data — not queryable as a mapping. Encoding the families as Go data + a drift test is the honest, maintainable shape.

### Field families (from mig 158, verbatim)

| Family | Gate | Core columns gated to it |
|---|---|---|
| **Defect** | `slot = wrk_defect` | defect_resolution, defect_test_case_status, defect_fixed_in_build, defect_found_in_build, defect_is_release_note, defect_steps_to_reproduce, defect_steps_to_reproduce_doc, defect_is_regression, environment, defect_severity, defect_status, affects_doc, defect_browser |
| **Risk** | `slot = wrk_risk` | risk_resolution, risk_impact, risk_impact_score, risk_probability, risk_probability_score, risk_response, risk_exposure, risk_calculated |
| **Task** | `slot = wrk_task` | estimate_hours, estimate_remaining |
| **Submitted-by** | `slot IN (wrk_defect, wrk_risk)` | submitted_by_user_id |
| **Strategy** | `scope = strategy` | strategic_job_size, strategic_preliminary_estimate_value, strategic_investment_group, strategic_value_stream_identifier, strategic_investment_weight |
| **Universal** | (no gate) | everything else — title, description, status, flow_state_name, priority, story_points, owner, parent_id, topology_node_id, tags, actuals, dates, etc. |

Note: `defect_browser`, `strategic_value_stream_identifier`, `strategic_investment_weight` are commented in `columns.go` as trigger-gated (migs 162) but were NOT in the mig-158 function body. **Blast-radius check required during build:** confirm whether a later migration (159–164) extended the trigger to gate these three. If the trigger does NOT gate them, the Go rubric still SHOULD (they are semantically defect/strategy-only per their column comments) — but then the Go rubric is STRICTER than the trigger, which is safe (presentation hides them; trigger would allow them). Document the exact stance taken in the test.

### Grouped dropdown entry (no third click)

Replace the single "Launch Form Builder" button with a **type-picker dropdown** in the launch panel:

```
Create new form  ▾
├─ Strategic
│   Portfolio Runway
│   Product
│   Business Objective
│   Theme
│   Feature
└─ Execution
    Story
    Defect
    Risk
    Task
    Epic
```

- Types load live from `artefactTypesApi.list()` (already loaded in the panel). Group by `scope`: `strategy` → "Strategic" header, `work` → "Execution" header. Order within group by `sort_order`.
- Tenant renames flow through automatically (we render `type.name`, resolve by `id`).
- Selecting a type opens `FormBuilderShell` for `{ nodeId, artefactTypeId: type.id, artefactTypeLabel: type.name }` — exactly the existing shell props. The shell already fetches `getCoreFields(typeId)` and `getCurrentLayout(nodeId, typeId)`, so it opens the existing layout if one exists for that (node, type), else a blank canvas. **No third click** — dropdown-select IS the launch.

### Form scope: per node + per type (unchanged)

`topology_node_form_layouts` is already keyed `(topology_node_id, artefact_type_id)`. No schema change needed for scope — the PoC table already supports per-type forms per node. We were only ever saving against `wrk_story`; opening the type chooser lights up the other 9 (node, type) slots for free.

### Mandatory-per-type

Replace the global `mandatoryCoreFieldKeys` with a per-slot/scope lookup. **Source confirmed:** `dev/research/rally_screenshots_field_mapping.md` §I.3 (WSAPI-validated editable allow-list). Rally itself marks only a tiny set of fields as *required-on-create* — `Name` is the sole field Rally enforces as mandatory across every type; everything else is optional-but-editable. Vector's existing universal trio (`title`, `flow_state_name`, `owner`) is a stricter superset of Rally's `Name` rule and reflects Vector's own create-contract (a story needs a flow state + owner to be actionable). 

**Decision:** keep the universal mandatory trio (`title`, `flow_state_name`, `owner`) for ALL types — Rally provides no per-type *required-field* additions (its per-type lists in §H.1/§I.3 are the *available* set, not the *required* set). Add NO per-type mandatory extras. This is the "do not guess" fallback the brief authorised, and it is now backed by the §I.3 finding that Rally has no per-type required fields beyond Name. The server still returns `isMandatory` per descriptor so the client renders the lock; the trio is simply applied uniformly. Document the §I.3 source in the validator comment.

### Add-custom-field overlay in the builder canvas (NEW — 2026-05-30 interrupt)

Each per-type builder must let the padmin create a brand-new custom field WITHOUT leaving the builder. Reuse the existing create mechanics (`CustomFieldEditForm` + `TypeBindingsPicker` + `createWorkspaceField`/`replaceFieldTypeBindings`) mounted as a **canvas overlay** (modal dialog over the builder), NOT a route navigation.

**The locked-type rule.** The new field's artefact-type bindings list opens with the **currently-worked-on type pre-checked AND locked** (un-toggleable): a Defect-form build → "Defect" is auto-checked and cannot be removed. The padmin may ADDITIONALLY tick other types; those make the field available in those types' builders too. Example: building an Epic form, create a field, also tick Task → next time the Task form is edited, that field is available there.

**Mechanism.** Add a `lockedTypeId?: string` prop to `TypeBindingsPicker`:
- On mount, if `lockedTypeId` is set and not already in `bindings`, the picker seeds a binding for it (so it's checked from the first render).
- The locked type's row renders checked with its checkbox `disabled`, its click-to-toggle suppressed, and no "Remove" affordance — it cannot be un-bound.
- All other type rows behave exactly as today (freely selectable).
- The locked binding is always included in the `onChange` payload, so `createWorkspaceField` + `replaceFieldTypeBindings` persist it.

**Wiring.** `FormBuilderShell` owns the overlay open/close state and the `workspaceId` (from `useSentinel()`). An "Add custom field" button in the sidebar's Custom section opens the overlay with `lockedTypeId = artefactTypeId` (the builder's current type). On `onSaved`, the shell refetches `getCoreFields`/custom fields for the current type so the new field appears in the sidebar immediately (it will, because it's bound to the locked current type). CSS: a `flb-overlay-*` modal family (scrim + centred card), reusing the existing `custom-field-edit-form` two-column layout inside.

**Scope-gate interplay.** The locked type guarantees the field is bound to (and therefore offered on) the current type's form. The new field is a CUSTOM field — custom fields are already type-scoped via `artefacts_types_fields` bindings, so no core-rubric change is needed; the overlay simply pre-seeds the binding the padmin would otherwise have to set by hand.

## Areas Impacted

**Backend (additive — low blast radius):**
- `artefactitems/columns.go` — add `AppliesTo` to `ColumnSpec` + family predicates. ADDITIVE field on struct; existing zero-value = universal. No existing reader breaks (the `?fields=` projection ignores the new field).
- `formlayouts/service.go` — `CoreFields()` → `CoreFields(slot, scope string)`; `skipFromBuilder` unchanged; mandatory logic → per-type.
- `formlayouts/handler.go` — `coreFields` handler resolves the type's slot+scope (it already has `typeID`; needs a lookup of slot/scope — add a tiny `artefactTypeMeta(typeID)` query or reuse the types service) and passes them to `CoreFields`.
- New test `formlayouts` or `artefactitems` — Go-rubric-vs-trigger drift pin.

**Frontend (additive):**
- `FormBuilderLaunchPanel.tsx` — single button → grouped dropdown; remove `resolveStoryType` hard-lock; pass selected type to shell.
- `formLayoutsApi.ts` — `getCoreFields(typeId)` unchanged signature (server now type-scopes internally). `MANDATORY_CORE_KEYS` may become per-type (server-sourced) — prefer server returns mandatory flags on descriptors (already has `isMandatory`), so client just reads `descriptor.isMandatory` and needs NO hard-coded list. **Decision: drive mandatory entirely off server `isMandatory` flags; delete the client `MANDATORY_CORE_KEYS` constant if nothing else uses it.**
- New CSS for the grouped dropdown (`flb-typepick-*`).

**No rename of existing assets** → per Rick's rule, additions won't break. The one signature change (`CoreFields()` → `CoreFields(slot,scope)`) is internal to the `formlayouts` package; grep confirms the only caller is the handler.

## Implementation Steps

1. Backend rubric: `AppliesTo` on `ColumnSpec` + families + `CoreFields(slot,scope)` + drift test. Verify against mig 158 + check migs 159–164 for trigger extensions.
2. Backend handler: resolve slot/scope for `typeID`, pass to `CoreFields`. Per-type mandatory in validator (+ save-side rejection of non-applicable fields).
3. Frontend dropdown: grouped type-picker replacing the button; wire selection → shell.
4. Frontend mandatory: drive off server `isMandatory`; drop client constant.
5. CSS for dropdown.
6. Verify: typecheck, `go test ./internal/formlayouts/... ./internal/artefactitems/...`, browser (per-type sidebars differ correctly).

## Risks

- **Drift between Go rubric and DB trigger** → mitigated by the pin test (step 1).
- **Mandatory-per-type guessing** → mitigated by sourcing from Rally research, falling back to the safe universal trio rather than inventing per-type requirements.
- **`defect_browser`/strategic-3 trigger-vs-comment mismatch** → explicit blast-radius check in step 1; Go-stricter-than-trigger is the safe default.

## Verification

- Per-type sidebar: open Defect → see defect_* fields, NO strategic/risk; open Feature → see strategic_* fields, NO defect; open Task → estimate_hours present; open Story → none of the family-gated fields, universal only.
- Save a layout per type; reopen → loads that (node, type)'s layout.
- `go test` drift pin passes.

## Change Log

- **2026-05-30** — Initial design.
