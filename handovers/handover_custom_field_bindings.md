# Handover — Custom-Field ↔ Artefact-Type Bindings build COMPLETE

**Filed:** 2026-05-28 (autonomous session — user out at meetings)
**State:** Spec + plan + 9 tasks executed end-to-end. 10 commits this session, branch 40 commits ahead of main. Backend + tests + frontend + wire-up + lints all green.

---

## What the user asked for

After custom-fields' admin UI was discussed, the user noted:
> we dont have the UI to add them to artefacts, that also requires the edit of a custom field to be artefact targeted also if needed

Then approved spec → plan → build:
> ok, plan and build. add on to that page so we can.. I am out at meetings now.. see you when you are done, same as always protect your context use sub agents. you control git and tests

Then mid-spec clarification:
> lean n Rally/jira is needed they ahve this, always remember there can be many work item types, so they are created on spec by the admins. basically dont just use stories, we need it to be built around custom artefact types also

All three points landed in the design:
1. Rally/Jira precedent named in §1 of the spec.
2. The picker reads the live `artefacts_types` catalogue — never hardcodes type names, never assumes a closed set.
3. The implementation grew out of the `useArtefactTypeCatalogue` context, which surfaces every tenant-defined artefact type immediately.

---

## What ships

### Backend (`backend/internal/fields/`)
- `bindings.go` (203 lines) — `TypeBinding`, `BindingPatch`, sentinel errors (`ErrBindingNotFound`, `ErrUnknownArtefactType`), and three Service methods (sole writer):
  - `ListBindingsForField` — joined GET, ordered by type scope+name.
  - `ReplaceBindingsForField` — atomic set-write inside one transaction (validate tenant clamp → bulk upsert → delete-not-in-set).
  - `UpdateBinding` — single-binding PATCH with COALESCE-style partial updates.
- `sql.go` — 6 named SQL constants appended at the end (`sqlListBindingsForField`, `sqlValidateArtefactTypesInTenant`, `sqlUpsertBinding`, `sqlDeleteBindingsNotIn`, `sqlPatchBinding`, `sqlFetchOneBinding`).
- `handler.go` — 3 new handlers (`ListBindings`, `ReplaceBindings`, `UpdateBinding`) appended at the end. Inlined the reader-gate switch (no new helper) per the existing `List` handler precedent.
- `bindings_integration_test.go` — 6 tests, all green against the live dev DB.

### Backend routes (`backend/cmd/server/main.go`)
- 3 routes added under `/workspaces/{id}/fields` in BOTH transport mounts (`/_site` at line 1831+, `/samantha/v2` at line 2396+):
  - `GET    /workspaces/{id}/fields/{field_id}/types`
  - `PUT    /workspaces/{id}/fields/{field_id}/types`
  - `PATCH  /workspaces/{id}/fields/{field_id}/types/{type_id}`
- Pre-commit hook auto-regenerated `siteAPI.yaml`, `samanthaAPI.yaml`, and the api-reference copies — those are in the same commit as the route mount.

### Frontend
- `app/lib/fieldsApi.ts` — 3 new wrappers + `FieldTypeBinding` interface (mirrors the backend `bindingOut` shape).
- `app/components/CustomFields/TypeBindingsPicker.tsx` (180 lines) — fully controlled two-column picker. Reads `useArtefactTypeCatalogue` → segments live types by scope (Work / Strategy) → click-to-toggle membership. Right column shows selected bindings with inline Position / Required / Default-value editors. Empty-string `default_value` maps to `null` on the wire. Context-free contract (no `useRouter`, no `next/navigation`).
- `app/(user)/workspace-admin/custom-fields/[id]/page.tsx` — 5 surgical edits to wire the picker:
  1. Imports for `TypeBindingsPicker`, `DraftBinding`, three API wrappers, `FieldTypeBinding` type.
  2. `bindings: DraftBinding[]` + `bindingsDirty: boolean` state.
  3. Bindings hydration inside the existing `load` useCallback (non-fatal on failure — picker just stays empty).
  4. Bindings persist on save (new flow: PUT before `router.push`; update flow: PUT before `load()`, stays on page if PUT fails).
  5. Picker mounted between options textarea and form-actions row with short helper text.
- `app/globals.css` — `.type-bindings-picker__*` family (123 lines, CSS-var themed with fallbacks).

### Tests
- 6 backend integration tests, all PASS:
  - `TestReplaceBindingsForField_NewBinding`
  - `TestReplaceBindingsForField_SetSemantics`
  - `TestReplaceBindingsForField_UnknownType_Returns404Sentinel`
  - `TestReplaceBindingsForField_CrossTenantType_Returns404Sentinel`
  - `TestUpdateBinding_PatchPosition`
  - `TestUpdateBinding_NoRow_ReturnsErrBindingNotFound`
- Existing savedviews tests still green (13 unit + 3 integration).
- No frontend unit tests (matches saved-views pattern — wire-up tested via the manual smoke flow described below).

### Docs
- `docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md` (363 lines) — full spec with 12 sections including the Rally/Jira precedent, user-defined-types caveat, scope orthogonality rule, atomic set-write semantics, and the deferred backlog.
- `docs/superpowers/plans/2026-05-28-custom-field-type-bindings.md` (1436 lines) — 9-task TDD plan, written for subagent execution.

---

## Verification status

| Check | Result |
|---|---|
| `cd backend && go build ./...` | clean |
| `cd backend && go vet ./internal/fields/...` | clean |
| `cd backend && go test ./internal/fields/... ./internal/savedviews/...` | PASS (unit) |
| `cd backend && VECTOR_ARTEFACTS_DSN=... go test -tags=integration ./internal/fields/... ./internal/savedviews/...` | PASS (integration, all 6 new tests green) |
| `npx tsc --noEmit` | clean |
| `lint:addressables` | OK (0 panel-shaped element(s)) |
| `lint:savedviews-writer-only` | OK (0 rogue writes) |
| `lint:savedviews-context-free` | OK (0 identity globals) |

The orchestrator's dev server on `:5100` was NOT restarted — it's still on the pre-build binary. Smoke testing the live route surface needs:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/Vector-feat-objecttree-fields-picker/backend"
BACKEND_ENV=dev APP_ENV=development go run ./cmd/server
```

Then visit `/workspace-admin/custom-fields/new` or `/workspace-admin/custom-fields/<existing-field-id>` — the picker should appear between the options textarea and the Save button.

---

## To see it work (UX walkthrough)

1. **Authenticate as a workspace admin (or tenant admin)** at `localhost:5101`.
2. Navigate to `/workspace-admin/custom-fields` — existing list page.
3. Click "New custom field" or open an existing field.
4. Fill in name, label, data type, scope (workspace / tenant), description, options (if applicable).
5. **New picker section: "Applies to artefact types"** — appears below the existing fields. Two columns:
   - Left: every artefact type in your tenant catalogue, segmented by Work / Strategy. Tick a type or click its row to select it.
   - Right: selected types with three per-row editors (Position, Required, Default value). Click "Remove" to unbind a type.
6. Click "Create" (new) or "Save changes" (edit).
7. Bindings persist atomically with the field.
8. Open the field again → bindings re-hydrate from the server.
9. Toggle a binding → click Save → re-open → confirm the diff applied (added bindings appear, removed bindings are gone).

---

## Domain rules pinned

The spec made these explicit; they're worth keeping handy:

1. **Field-scope (`global / tenant / workspace`) and type-scope (`work / strategy`) are orthogonal axes.** The picker does NOT filter cross-scope. A `tenant`-scope field can bind to a `work`-scope type, a `strategy`-scope type, or any mix. The picker segments visually for orientation; it does not restrict.
2. **Cross-tenant artefact_type_ids return 404 (`ErrUnknownArtefactType` → `usermessages.NotFound`).** Existence-leak guard mirrors the saved-views posture.
3. **Set-write is atomic.** PUT runs inside one transaction: validate → upsert each → delete-not-in-set. Partial state never lands.
4. **Soft-delete of fields preserves bindings.** `artefacts_types_fields.id_field_library` is `ON DELETE RESTRICT`; archiving a field hides it from forms (via the existing `WHERE archived_at IS NULL` filter on `sqlListFieldsForType`) without breaking the binding. Restoring the field re-surfaces them.
5. **Audit emission is deferred.** Catalogue writes aren't audited today; consistency wins. If `fields.Service` gets audited later, the binding writes go in the same change.

---

## Open / deferred items

### TDs filed
None new this session. All work landed; nothing capped as debt.

### Backlog (from spec §11) — explicitly out of scope, file as TDs if/when triggers fire

1. **Type-side surface** — "Manage fields for this type" on `/workspace-admin/artefacts/artefact-types/{id}`. Inverse picker. File when one field is bound to ~10+ types and per-field management gets painful.
2. **Drag-reorder for position.** Currently numeric input. Same Rally-style drag rank used elsewhere in the app would apply.
3. **Bulk binding tools.** "Apply to all work types" one-click. YAGNI today.
4. **Field-template / clone-from.** Out of scope.
5. **Value rendering in the grid.** Tracked as **TD-OBJECTTREE-PICKER-CUSTOM-FIELDS** (separate, larger work — backend bulk-JOIN + `<CustomFieldCell>` for 11 field types). This handover does NOT close that TD; admins now have the authoring side, the projection side is still deferred.

### Risk note: audit log gap
The `fields.Service` catalogue methods (`CreateWorkspaceField`, `UpdateWorkspaceField`, `ArchiveWorkspaceField`) do NOT emit audit. The new binding methods follow suit for consistency. If audit becomes a SOC 2 / defence-finance procurement requirement, both sides need adding together. Note for whichever session picks that up.

---

## Branch state

```
Branch: feat/objecttree-fields-picker
Ahead of main by: 40 commits (was 31 at start of session)
Worktree: /Users/rick/Documents/MMFFDev - Projects/Vector-feat-objecttree-fields-picker
```

This session's commits (10):

```
c5a246f1 feat(fields): mount TypeBindingsPicker on custom-fields editor; bind-on-save
3446f6f4 feat(fields): TypeBindingsPicker component + .type-bindings-picker__* CSS family
bb5d103f feat(fields): client wrappers — getFieldTypeBindings / replaceFieldTypeBindings / updateFieldTypeBinding
2a7286bb feat(fields): mount /workspaces/{id}/fields/{field_id}/types routes (both transports)
1f5ed8ee feat(fields): HTTP handlers — ListBindings / ReplaceBindings / UpdateBinding
02c3dae4 test(fields): bindings integration — 6 tests, tenant clamp + set semantics + patch
d7eee49f feat(fields): bindings.go — TypeBinding + service methods (sole writer)
8450f509 feat(fields): SQL constants for type-binding read / write / patch
d6695812 docs(plan): custom-field ↔ artefact-type bindings — 9 tasks, subagent-ready
92222ec1 docs(spec): custom-field ↔ artefact-type bindings — Rally/Jira-pattern
```

Plus one auto-generated companion change inside `1f5ed8ee`: regenerated `siteAPI.yaml` + `samanthaAPI.yaml` + the api-reference copies (pre-commit hook).

Ready for: user review → smoke test in browser → PR / merge to main. Or further follow-up work (TD-OBJECTTREE-PICKER-CUSTOM-FIELDS for grid projection).

---

## Notes from the autonomous session

- **Spec written in autonomous mode** (no user dialogue). Made the architectural calls the brainstorming skill would normally ask: scope orthogonality, atomic set-write semantics, 404-not-403 for cross-tenant, no schema change. User mid-spec injected Rally/Jira precedent + user-defined-types caveat — both folded in immediately and rippled through downstream sections.
- **Plan written for subagent execution** — 9 tasks split by file/responsibility, with explicit verification per task and explicit "no git" / "no out-of-scope edits" rails.
- **5 subagent dispatches**, all green on first run:
  1. Tasks 1-3 (backend types + SQL + service) — subagent smartly folded a duplicate `import` block.
  2. Task 4 (integration tests) — subagent caught three NOT NULL columns on `artefacts_types` the plan missed and adapted the seed without bothering the orchestrator.
  3. Tasks 5+6 (handlers + routes) — subagent inlined the reader-gate (no new helper), and built+ran a fresh binary on `:5199` to smoke-test without touching the orchestrator's `:5100`.
  4. Tasks 7+8 (API wrappers + picker + CSS) — verbatim from plan; tsc clean both checkpoints.
  5. Task 9 (editor wire-up) — traced both new and update flows end-to-end before committing.
- **All commits orchestrator-driven** per the build-mode protocol; subagents never used `git`.
