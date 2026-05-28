# Custom-Field → Artefact-Type Bindings — Design

**Date:** 2026-05-28
**Branch:** `feat/objecttree-fields-picker`
**Status:** Draft (autonomous-mode spec; user out)
**Author:** Claude Opus 4.7
**Origin:** Follow-up from saved-views build session — user identified that the custom-fields editor at `/workspace-admin/custom-fields/[id]` carries no UI for binding fields to artefact types, so created fields cannot surface on any artefact form.

---

## 1. Synopsis

A workspace admin can create a custom field today (`artefacts_fields_library`), but there is **no UI to bind that field to one or more artefact types**. The binding table `artefacts_types_fields` is populated only by hand-written SQL seeds (mig 075). Until bindings exist, the field is dead weight: the artefact create/edit flyout's `ListFieldsForType` query (`backend/internal/artefactitems/sql.go:707`) joins through the binding table, so no binding means no rendering.

**Precedent:** This is the same idiom Rally and Jira ship — custom fields are catalogue-defined, then attached to one or more "issue types" (their term for artefact types). Vector's data model already mirrors that shape; we just need the binding-management UI.

**Artefact types are user-defined.** The seed migration creates a starting set (Theme, Business Objective, Feature, Story, Defect, Risk, etc.), but workspace admins create new artefact types on demand via `/workspace-admin/artefacts/artefact-types/`. The binding picker MUST read the live `artefacts_types` catalogue for the caller's tenant — it must never assume the seeded type names or count are the universe. A workspace might have 3 types or 30; the picker treats both the same.

This design adds:
- A **multi-select "Applies to" picker** to the custom-fields editor page.
- Per-binding **position / required / default override** controls (the binding row carries these — they're per-type-per-field, not per-field-globally).
- Backend write endpoints on the existing `/workspaces/{id}/fields/{field_id}/types` surface.
- A scope filter so a `tenant`-scope field can only bind to types within the right artefact-type scope (`strategy` vs `work`).

Bindings are managed **from the field side** (the editor we already have), not from the artefact-type side. A future enhancement could mirror the surface from the type-admin page; that's out of scope here.

---

## 2. Problem

`artefacts_fields_library` has 66 admitted rows. `artefacts_types_fields` has 56. The 56 came from `075_seed_risk_type_field_bindings.sql` — hand-seeded only for Risk's mandatory fields (probability, severity, etc.). Every other field a workspace admin creates today never reaches an artefact form, because no UI writes the binding row.

The header comment on the existing editor (`app/(user)/workspace-admin/custom-fields/page.tsx:7`) literally says:

> This page manages the catalogue; bindings live elsewhere.

"Elsewhere" does not exist. The lift here is to make "elsewhere" be **the same page** — fields and their bindings are managed together, because a field with no binding is dead.

---

## 3. Goals & non-goals

**Goals**

- Workspace admin can pick which artefact types a field applies to, while creating or editing the field.
- Workspace admin can set per-type position, required flag, and default value override.
- The picker offers **every artefact type in the caller's tenant**, segmented visually by `artefacts_types_scope` (Work / Strategy) for orientation. Field-scope and type-scope are orthogonal — see §4 rule 1; the picker does not filter cross-scope.
- Save the field record + its bindings as one atomic step from the user's perspective (one click → bindings persisted).
- Existing `ListFieldsForType` read path keeps working unchanged — bindings appear immediately on artefact forms once saved.

**Non-goals**

- No type-side surface ("manage fields for this type") — that's the inverse picker; future work if/when the binding count makes per-field management painful.
- No reordering of bindings via drag — position is a numeric input. Drag-reorder is a polish iteration.
- No value rendering in the grid (`<CustomFieldCell>`, bulk JOIN, `field:<uuid>` wire key) — that is **TD-OBJECTTREE-PICKER-CUSTOM-FIELDS**, a separate piece of work. This spec stops at "the field appears on the artefact edit/create form."
- No backfill of existing rows. The binding table is additive — adding `(type X, field Y)` doesn't retroactively write `artefacts_fields_values` rows; values are filled in by users via the form.
- No `global`-scope field UI on this page. The editor today lists workspace + tenant fields; global fields stay vector-admin-owned and read-only here.

---

## 4. Domain rules

These are intrinsic to the data model — the surface enforces them; it does not invent them.

1. **Field-scope and type-scope are orthogonal axes.** `artefacts_fields_library_scope` ∈ `{global, tenant, workspace}` is the catalogue-visibility scope (which tenants/workspaces see this field). `artefacts_types_scope` ∈ `{strategy, work}` is the domain-scope of the artefact type. **They do not constrain each other.** A `tenant`-scope field MAY bind to a `work`-scope type, a `strategy`-scope type, or both. The binding picker SHOULD segment the candidate type list visually by `artefacts_types_scope` (Work / Strategy headers) so the admin can see the partition, but it MUST NOT filter or forbid cross-scope bindings. This matches the Rally/Jira pattern: a custom field is a property, and any type can opt in.
2. **Tenant clamp on writes.** The binding can only join a field and a type that share `subscription_id`. Service-layer enforced; UI surfaces only types in the caller's tenant. A `global`-scope field has no `subscription_id` (NULL); binding it is vector-admin work and out of scope for this surface (the existing editor doesn't expose global fields for edit; this spec preserves that).
3. **Unique binding.** `artefacts_types_fields_id_artefact_type_id_field_library_uniq` already enforces "one binding per (type, field)" — the `PUT` set-write upserts on this constraint, so the same field bound twice to the same type is a no-op.
4. **Soft-delete of the field cascades the binding** only by FK behaviour: `artefacts_types_fields.id_field_library` is `ON DELETE RESTRICT` — so archiving a field (sets `archived_at`, doesn't DELETE) leaves the bindings in place. The read query (`sqlListFieldsForType`) already filters `WHERE fl.archived_at IS NULL`. **Result:** archiving a field "hides" it from forms without breaking the binding. Restoring (un-archiving) would re-surface it. This is correct behaviour; the spec does not change it.
5. **Cascade on type archive** is handled by `artefacts_types_fields_id_artefact_type_fkey ON DELETE CASCADE` — but artefact types are *also* soft-deleted, not hard-deleted, so the cascade rarely fires. The form-render query joins on `artefacts_types` so archived types stop rendering their bindings. Newly-created user-defined types appear in the picker the moment they exist — no allow-list to maintain.

---

## 5. Architecture

### 5.1 Data model — no schema change

The schema is **already correct**:

```
artefacts_fields_library  (catalogue — 66 rows)
   │
   ├── artefacts_types_fields  (binding — 56 rows seeded; this UI populates more)
   │      · id_artefact_type     → artefacts_types(id)         FK CASCADE
   │      · id_field_library     → artefacts_fields_library(id) FK RESTRICT
   │      · position (int, default 100)
   │      · required (bool, default false)
   │      · default_value (text, nullable)
   │      · UNIQUE (id_artefact_type, id_field_library)
   │
   └── artefacts_fields_values  (per-row values — currently 0; out of scope here)
```

No new tables. No new columns. No migration. **All work is service + handler + UI.**

### 5.2 Backend — new endpoints

Mounted under the existing `/_site/workspaces/{id}/fields/{field_id}/types` route group:

| Verb   | Path                                          | Behaviour                                         |
|--------|-----------------------------------------------|---------------------------------------------------|
| `GET`  | `/workspaces/{id}/fields/{field_id}/types`    | List bindings for the field (returns type IDs + per-binding rows) |
| `PUT`  | `/workspaces/{id}/fields/{field_id}/types`    | Replace the full binding set atomically (idempotent set-write) |
| `PATCH`| `/workspaces/{id}/fields/{field_id}/types/{type_id}` | Update one binding's `position` / `required` / `default_value` |

`PUT` is the primary write — it lets the editor send "the field should be bound to these N types, with these N (position, required, default) tuples." The service computes the diff (insert new, update existing, delete removed) inside a single transaction.

`PATCH` exists for the case where a user changes only one binding's properties without changing the set membership — saves a round-trip and avoids the diff hot-path.

`DELETE /types/{type_id}` is intentionally omitted — `PUT` covers removal by omission; one path is simpler than two.

**No new lint.** The existing `lint:no-db-in-handlers` covers this. `fields.Service` becomes the sole writer (extend, don't duplicate the saved-views pattern — `fields` is already the sole writer for the catalogue).

### 5.3 Backend — service surface

Three new methods on `fields.Service`:

```go
type TypeBinding struct {
    ArtefactTypeID uuid.UUID
    Position       int
    Required       bool
    DefaultValue   *string
}

func (s *Service) ListBindingsForField(ctx context.Context, subID, fieldID uuid.UUID) ([]TypeBinding, error)
func (s *Service) ReplaceBindingsForField(ctx context.Context, subID, fieldID uuid.UUID, bindings []TypeBinding) ([]TypeBinding, error)
func (s *Service) UpdateBinding(ctx context.Context, subID, fieldID, typeID uuid.UUID, patch BindingPatch) (*TypeBinding, error)
```

All three:
- Tenant-clamp on subscription (every type AND the field must share `subID`). Cross-tenant `artefact_type_id`s return `ErrUnknownArtefactType` → 404 (existence-leak guard, mirrors the saved-views pattern).
- Reject any `artefact_type_id` that is archived or unknown in the tenant.
- Emit `audit.Logger.Log` on every write with action `field_type_binding_replace` / `field_type_binding_update`.

`ReplaceBindingsForField` runs in one transaction:

1. `BEGIN`
2. Fetch existing bindings for the field.
3. Compute add / update / delete sets.
4. Execute the diff (one bulk `INSERT … ON CONFLICT DO UPDATE`, one `DELETE … WHERE … NOT IN (…)`).
5. `COMMIT`, return the full new set.

Atomicity matters: a partial write (some bindings added, others left orphaned) would leave the UI's "saved state" diverged from reality. One transaction = one consistent set.

### 5.4 Frontend — editor changes

The existing editor page (`app/(user)/workspace-admin/custom-fields/[id]/page.tsx`, 341 lines) gains one new section: **"Applies to"**.

**Picker shape:** A two-column layout below the existing options/config rows. The type names below are illustrative — actual labels come from the live `artefacts_types` catalogue for the caller's tenant, which is fully user-defined:

```
┌─ Applies to artefact types ─────────────────────────────────────┐
│                                                                  │
│  Available types                      Selected (3)               │
│  ┌─────────────────────────┐         ┌─────────────────────────┐ │
│  │ ── Work scope ──         │         │ <type-A>     pos: 200 ☑️ │ │
│  │ ☐ <type-D>               │         │ <type-B>     pos: 300    │ │
│  │ ☐ <type-E>               │  →      │ <type-C>     pos: 100 ☑️ │ │
│  │ ☑ <type-A> (selected)    │  ←      │                          │ │
│  │ ☑ <type-B> (selected)    │         │                          │ │
│  │ ── Strategy scope ──     │         │                          │ │
│  │ ☐ <type-F>               │         │                          │ │
│  │ ☑ <type-C> (selected)    │         │                          │ │
│  └─────────────────────────┘         └─────────────────────────┘ │
│                                                                  │
│  Per-binding: position (int), required (☑️), default value      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- Left list: **every artefact type in the caller's tenant** (could be 3, could be 30 — workspaces define their own), segmented visually by `artefacts_types_scope` (Work / Strategy). Reads the live catalogue via `useArtefactTypeCatalogue`; never hardcodes type names.
- Right list: currently-selected types, each with three inline editors (position number, required toggle, default-value text).
- Move-arrow buttons (`→` / `←`) toggle selection; clicking a row in either column also toggles.
- Header counts selected, e.g. "Selected (3)".
- A type the admin created an hour ago appears in the picker the moment the field editor opens (next catalogue refresh) — no rebuild, no allow-list update.

**Save behaviour:** the editor's existing Save button gains a follow-up step:

1. Existing: `createWorkspaceField` or `updateWorkspaceField` saves the catalogue row.
2. New: if bindings changed (dirty flag), call `PUT /workspaces/{id}/fields/{field_id}/types` with the full selected set.
3. If either fails: show a notification, leave the user on the page with the dirty state.
4. If both succeed: navigate back to the list.

Saving the field-row first means a "create-with-bindings" flow has a real `field_id` to bind to. If the binding-write fails after a successful create, the user can re-click Save to retry — the create is idempotent under the catalogue's `(subscription_id, field_name)` unique index, which causes the create to fail loudly the second time. **Mitigation:** wrap the second call in try/catch and surface "Field saved, bindings failed: <reason>" — the user can fix the binding state without re-creating the field.

### 5.5 Frontend — data layer

Three additions to `app/lib/fieldsApi.ts`:

```ts
export type FieldTypeBinding = {
  artefact_type_id: string;
  position: number;
  required: boolean;
  default_value: string | null;
};

export async function getFieldTypeBindings(workspaceId: string, fieldId: string): Promise<FieldTypeBinding[]>
export async function replaceFieldTypeBindings(workspaceId: string, fieldId: string, bindings: FieldTypeBinding[]): Promise<FieldTypeBinding[]>
export async function updateFieldTypeBinding(workspaceId: string, fieldId: string, typeId: string, patch: Partial<Pick<FieldTypeBinding,"position"|"required"|"default_value">>): Promise<FieldTypeBinding>
```

The picker reads its candidate list directly from the existing `useArtefactTypeCatalogue` context — no new hook needed. It groups by `artefacts_types_scope` at render time and filters out archived types client-side (archived rows are already excluded server-side, but a belt-and-braces check costs nothing).

### 5.6 Permission gate

Existing gates apply unchanged:

- **Tenant-scope field** → tenant admin only (gadmin/padmin) can edit (incl. bindings).
- **Workspace-scope field** → workspace admin OR tenant admin.

The `fields.Service.AssertCallerMayWrite` gate is reused as-is. No new permission code.

---

## 6. I/O Contract

### 6.1 `GET /workspaces/{id}/fields/{field_id}/types`

**Response 200:**
```json
{
  "field_id": "uuid",
  "bindings": [
    {
      "artefact_type_id": "uuid",
      "artefact_type_name": "<example: 'Story', or any user-defined type label>",
      "artefact_type_scope": "work",
      "position": 200,
      "required": true,
      "default_value": null
    }
  ]
}
```

Includes `artefact_type_name` + `artefact_type_scope` joined from `artefacts_types` so the UI doesn't need a separate fetch to render labels.

### 6.2 `PUT /workspaces/{id}/fields/{field_id}/types`

**Body:**
```json
{
  "bindings": [
    { "artefact_type_id": "uuid", "position": 200, "required": true,  "default_value": null },
    { "artefact_type_id": "uuid", "position": 100, "required": false, "default_value": "open" }
  ]
}
```

**Response 200:** Same shape as `GET`, reflecting the new state.

**Response 404 Not Found:** Returned if any `artefact_type_id` is unknown or not in the caller's tenant (existence-leak guard — same posture as saved-views). Body: `{"error":"unknown_type","unknown_ids":[...]}`.

**Response 400 Bad Request:** Returned for malformed input (non-UUID `artefact_type_id`, negative `position`, etc.). Body: `{"error":"invalid_request","reason":"<detail>"}`.

### 6.3 `PATCH /workspaces/{id}/fields/{field_id}/types/{type_id}`

**Body:** Partial of `{ position, required, default_value }`.
**Response 200:** Single updated binding.
**Response 404:** If no binding exists (caller is patching a non-existent row).

---

## 7. Components (file plan)

### Backend (Go)
- `backend/internal/fields/types.go` — add `TypeBinding`, `BindingPatch`, sentinel errors (`ErrUnknownArtefactType`, `ErrBindingNotFound`).
- `backend/internal/fields/sql.go` — add 4 named queries: `sqlListBindingsForField`, `sqlReplaceBindingsBatchUpsert`, `sqlDeleteBindingsNotInSet`, `sqlUpdateBinding`.
- `backend/internal/fields/service.go` — add `ListBindingsForField`, `ReplaceBindingsForField`, `UpdateBinding`.
- `backend/internal/fields/handler.go` — add `ListBindings`, `ReplaceBindings`, `UpdateBinding`.
- `backend/cmd/server/main.go` — mount 3 new routes under the existing field route group.
- `backend/internal/fields/service_test.go` — extend with tenant-clamp, scope-mismatch, replace-diff, audit-emission tests.

### Frontend (TypeScript / React)
- `app/lib/fieldsApi.ts` — add 3 wrapper functions + `FieldTypeBinding` type.
- `app/components/CustomFields/TypeBindingsPicker.tsx` — **new** component, the two-column picker described above. ~250 LOC.
- `app/(user)/workspace-admin/custom-fields/[id]/page.tsx` — mount `<TypeBindingsPicker>`, manage bindings state, wire to Save.
- `app/globals.css` — `.type-bindings-picker__*` family following root-block convention. ~80 lines.

### Tests
- Backend unit + integration (against live DB via `//go:build integration`).
- No frontend unit tests (matches saved-views pattern — UI is wired through e2e in a later session if/when).

---

## 8. How to use (UX walkthrough)

**Creating a new field with bindings:**

1. Admin navigates to `/workspace-admin/custom-fields/new`.
2. Fills in name, label, data type, scope, options, description.
3. The "Applies to" section lists every artefact type in the tenant, segmented visually by `artefacts_types_scope` (Work / Strategy headers) for orientation. Field-scope and type-scope are orthogonal — the field can bind to any type (or any combination) regardless of its own scope.
4. Admin selects 1+ types via the move-arrow or click-to-toggle.
5. Optionally edits per-binding position (default 100), required (default false), default value (default empty).
6. Clicks Save. Field is created → field_id is returned → bindings are PUT against that id → navigated back to list.

**Editing an existing field:**

1. Admin opens an existing field — current bindings load via `GET`.
2. Adjusts selection or per-binding settings.
3. Clicks Save. Catalogue row is PATCHed (if dirty) → bindings are PUT (if dirty) → navigated back.

**Archive of a field with bindings:**

Unchanged. Existing archive button soft-deletes the catalogue row. `ON DELETE RESTRICT` on the binding FK keeps the bindings in place but the read-side filters archived fields from form rendering. If the field is later restored (un-archived — separate UX not in this spec), the bindings reappear automatically.

---

## 9. Examples

The type names below are illustrative; substitute any user-defined artefact type the workspace admin has created.

### 9.1 Bind a brand-new "Risk Score" field to Risk + Defect

```sql
-- After Save, the binding rows look like:
INSERT INTO artefacts_types_fields
  (id_artefact_type, id_field_library, position, required, default_value)
VALUES
  ('<risk_type_id>',   '<risk_score_field_id>', 100, true,  NULL),
  ('<defect_type_id>', '<risk_score_field_id>', 200, false, '0')
ON CONFLICT (id_artefact_type, id_field_library)
DO UPDATE SET position = EXCLUDED.position,
              required = EXCLUDED.required,
              default_value = EXCLUDED.default_value;
```

### 9.2 Remove the Defect binding later

The admin opens the field, unticks Defect, clicks Save. The PUT body now contains only the Risk binding. The service computes:

- Existing set: `{Risk, Defect}`
- New set: `{Risk}`
- Diff: delete `(Defect, RiskScore)`, no inserts, no updates.

One `DELETE FROM artefacts_types_fields WHERE id_field_library = $1 AND id_artefact_type NOT IN ($2)` fires inside the transaction.

---

## 10. Constraints

- **Picker candidate filtering:** the catalogue is hit-the-server, not hit-the-network — the existing `useArtefactTypeCatalogue` context caches the type list at session start, so the picker has no per-render fetch cost.
- **Atomicity:** the `PUT` must be one transaction. Partial state would diverge from the UI's saved-state snapshot. The service implements it that way; the handler returns 500 only on transaction abort.
- **Scope mismatch returns 400, not 409.** It's a malformed request from the data model's point of view, not a collision with existing state. Aligns with `lint:httperr-status-discipline`.
- **No N+1 in the GET response.** `sqlListBindingsForField` joins to `artefacts_types` so type name + scope come back in one query.
- **Backwards compatibility:** existing `ListFieldsForType` (`sqlListFieldsForType` at `artefactitems/sql.go:707`) is read-only and untouched. It joins through the same binding table, so new bindings appear on artefact forms immediately after `PUT`.

---

## 11. Backlog (deferred)

- **Type-side surface** — "Manage fields for this type" on `/workspace-admin/artefacts/artefact-types/{id}`. Inverse of this picker. File when the binding count makes per-field management painful (probably ~10+ types per field).
- **Drag-reorder for position.** Today it's a numeric input. The same Rally idiom (drag rank) used elsewhere in the app would apply here once the picker is in use.
- **Bulk binding tools.** "Bind this field to every type in the work scope." Possibly a one-click "Apply to all" button. YAGNI today.
- **Field-template library / clone-from.** Out of scope; admins re-type for now.
- **Value rendering in the grid.** Tracked as **TD-OBJECTTREE-PICKER-CUSTOM-FIELDS** (separate, larger work).

---

## 12. Change Log

- **2026-05-28** — Initial spec (autonomous mode; user out at meetings).
