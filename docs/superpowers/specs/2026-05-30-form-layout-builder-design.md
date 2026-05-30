# Form Layout Builder — Design Spec

**Date:** 2026-05-30
**Status:** Approved-by-delegation (user handed full control for an overnight solo PoC build; locked the key decisions below before delegating).
**Author:** Claude (control agent)

## Why this exists

Vector's headline differentiator. Per-topology-node, drag-and-drop form layouts for execution artefacts (User Story first), saved as **versioned JSON**, that travel **with the artefact** when work crosses team/node boundaries.

Jira / Rally / Azure DevOps all lock form layout to a project or global admin scope. None let a team own its own form **and** have a receiving team inherit both the data and the layout on hand-off. That carry-through is the wedge — "never been done in this space" (user, 2026-05-30).

## Locked decisions (user, before delegation)

1. **Carry-through = origin-ref + graceful merge.** On create, a story is stamped with a ref to the authoring node's layout *version*. It renders in that layout by default. A receiving node can later "adopt" / re-lay-out it; any field that has a value but is absent from the new layout drops into a visible **"Carried fields"** section — no data is ever hidden. **PoC scope:** build the snapshot-ref spine + the Carried-fields fallback. Defer the receiving-node *adopt* interaction.
2. **Layout keyed per (topology_node_id + artefact_type_id).** Insurance can have a different layout for Story vs Defect vs Risk. PoC focuses User Story; schema supports all types from day one.
3. **Storage = dedicated versioned table** `topology_node_form_layouts`. The version column is what makes snapshot-ref carry-through possible.

## Substrate (validated live against vector_artefacts, 2026-05-30)

All columns are full-table-name prefixed (live DB is 100% Rule-2-compliant; the on-disk `031_topology_nodes.sql` is stale vs applied).

- `topology_nodes` (vector_artefacts, vaPool): PK `topology_nodes_id`, `topology_nodes_id_workspace`, `topology_nodes_id_subscription`, `topology_nodes_id_parent`, …
- `artefacts_types`: PK `artefacts_types_id`, `artefacts_types_prefix` ('US'=Story), `artefacts_types_id_workspace`, `artefacts_types_id_subscription`.
- `artefacts`: `artefacts_id_topology_node`, `artefacts_id_artefact_type`. **No layout-ref column yet** → this spec adds one.
- `artefacts_fields_library` (catalogue), `artefacts_types_fields` (type→field bindings, `_position`/`_required`), `artefacts_fields_values` (EAV values keyed by `(artefacts_fields_values_id_artefact, _id_field_library)`).
- **Carry-through is already half-solved:** `artefacts_fields_values` has NO topology scoping, so values persist across nodes by artefact identity. Only the *layout* needs to travel.
- Sample seed targets: Story type `150ddfa1-8ba7-406b-bdfb-17adbe5f44ad`; node "B2C Insurance" `651b8696-881d-4876-8c7e-0fdf99800fa7`.

## The layout JSON schema (the heart)

The existing `app/components/DataGrid/formSpec.ts` `FormLayout` is fixed 1-or-2 columns, vertical stacks only — it cannot express "row A = 50/50, row B = 30/70". So we define a new **row-based** schema. The builder produces it; the runtime renderer consumes it (same renderer → WYSIWYG).

```jsonc
{
  "version": 1,                         // schema version (bump on breaking shape changes)
  "artefactTypeId": "<uuid>",
  "rows": [
    {
      "id": "row-1",
      "template": "100",                // 100 | 50-50 | 30-70 | 70-30 | 30-30-30
      "cells": [
        { "id": "c1", "fieldKey": "title", "span": 100 }
      ]
    },
    {
      "id": "row-2",
      "template": "50-50",
      "cells": [
        { "id": "c2", "fieldKey": "description",       "span": 50 },
        { "id": "c3", "fieldKey": "acceptance_flags",  "span": 50 }
      ]
    }
  ]
}
```

Rules:
- `template` ∈ `{100, 50-50, 30-70, 70-30, 30-30-30}`. Cell `span` values derive from the template; not free-form — keeps snap-to-slot clean and prevents broken layouts.
- `fieldKey`: **core fields** use stable string keys (`title`, `description`, `owner`, `flow_state`, `plan_estimate`, `parent`, `sprint`, `release`, `milestone`, `colour`, `acceptance_flags`, …); **custom fields** use `custom:<artefacts_fields_library_id>`. Empty cell → `fieldKey: null`.
- One field per cell (matches "drop the field, it locks to that slot with its label").
- Layout stores **references, not metadata.** Label/type/options resolved at render from the core-column catalogue (`backend/internal/artefactitems/columns.go`) + custom-field catalogue. Rename a field's label once → every layout updates.

## Data model — new migration (next NNN = 165)

```sql
CREATE TABLE topology_node_form_layouts (
    topology_node_form_layouts_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topology_node_form_layouts_id_topology_node   UUID NOT NULL REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
    topology_node_form_layouts_id_artefact_type   UUID NOT NULL REFERENCES artefacts_types(artefacts_types_id) ON DELETE CASCADE,
    topology_node_form_layouts_id_workspace       UUID NOT NULL,   -- denormalised for clamp
    topology_node_form_layouts_version            INTEGER NOT NULL DEFAULT 1,
    topology_node_form_layouts_layout_json        JSONB NOT NULL,
    topology_node_form_layouts_is_current         BOOLEAN NOT NULL DEFAULT TRUE,
    topology_node_form_layouts_created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    topology_node_form_layouts_updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    topology_node_form_layouts_created_by          UUID
);
-- One CURRENT layout per (node, type). Old versions kept with is_current=false for snapshot-ref.
CREATE UNIQUE INDEX uq_tnfl_current ON topology_node_form_layouts
    (topology_node_form_layouts_id_topology_node, topology_node_form_layouts_id_artefact_type)
    WHERE topology_node_form_layouts_is_current;
CREATE INDEX idx_tnfl_node_type ON topology_node_form_layouts
    (topology_node_form_layouts_id_topology_node, topology_node_form_layouts_id_artefact_type);
CREATE INDEX idx_tnfl_workspace ON topology_node_form_layouts (topology_node_form_layouts_id_workspace);
```

Plus on `artefacts`: `artefacts_id_form_layout UUID REFERENCES topology_node_form_layouts(topology_node_form_layouts_id)` — the **snapshot ref** stamped on create. NULL = no saved layout for that (node,type) at create time → render the default hardcoded form.

**Versioning behaviour:** Saving a layout for an existing (node,type) flips the prior `is_current` row to false and inserts a new row (version+1, is_current=true). In-flight artefacts keep pointing at the exact version row they were stamped with. New artefacts get the new current version.

## Backend

New package `backend/internal/formlayouts/` (mirrors topology/fields shape; on vaPool):
- `GET  /_site/api/form-layouts?node={id}&type={id}` → current layout for (node,type), or 404.
- `GET  /_site/api/form-layouts/{layoutId}` → a specific version row (used by runtime to render a stamped story).
- `POST /_site/api/form-layouts` → upsert: body `{ nodeId, artefactTypeId, layoutJson }`; does the version flip; **validates** core-field presence (SERVER IS THE GATE) and rejects unknown fieldKeys / malformed templates.
- `GET  /_site/api/form-layouts/core-fields?type={id}` → authoritative list of core fields (from `columns.go`) + bound custom fields (from `artefacts_types_fields` ⋈ `artefacts_fields_library`) for the builder's sidebar. Each entry: `{ fieldKey, label, dataType, kind: 'core'|'custom', required, isCoreMandatory }`.

**Core-field validation (the "page won't save without them" rule):** a server-side mandatory set (subset of core fields — e.g. `title`, `description`, `flow_state`, `owner`) must all appear in the submitted layout's cells. Missing → 422 with `{ missing: [...], reason }`. Client mirrors this for live UX, but the server is the gate.

**Stamp-on-create:** when an artefact is created (`artefactitems` create path), look up the current layout for its (node, type); if present, set `artefacts_id_form_layout` to that version row's id. Existing artefacts with NULL ref render the default form (graceful).

## Frontend

- `app/lib/formLayoutsApi.ts` — types (`FormLayout`, `FormRow`, `FormCell`, `RowTemplate`, `CoreFieldDescriptor`) + client (apiSite BFF).
- `app/components/FormLayoutBuilder/` :
  - `FormLayoutRenderer.tsx` — consumes the row schema, renders rows→cells→fields using the existing field input components (RichTextField for richtext, selects for enums, etc., reused from `EditCustomFields` / `ArtefactInlineForm`). **Two modes:** `mode="builder"` (each cell is a dnd drop target, empty slots highlight on drag, fields wrapped in drag handles) and `mode="runtime"` (plain form, values editable, commits via existing patch + field-values endpoints).
  - `FormBuilderShell.tsx` — fullscreen overlay above rails+shell; top-right Save/Cancel; 20% field sidebar / 80% canvas. Sidebar sections: **Core (must-have)**, **Custom**, **+ Create new field** (loads the existing create-field form into the canvas region). Add-row control with the 5 grid templates. Save blocked with inline reason if mandatory core fields not yet placed.
  - dnd via `@dnd-kit` (the project's canonical DnD lib).
  - **Builder-mode interaction contract (user, 2026-05-30):**
    - A placed field is **movable within the canvas** (drag it from one slot to another).
    - A placed field can be **sent back to the sidebar** — dragging it out (or a remove affordance on the cell) removes it from the canvas and returns it to the available list.
    - **Insertion pushes down:** dropping a field between two stacked fields (e.g. between `Blah` and `BlahBlah`) inserts it at that grid position and shifts the lower field(s) down one — it never overwrites an occupied slot.
    - **Anchor-point affordance:** every available/empty slot renders with a **dashed border + a filled circle containing a `+`** centred in it, so empty drop targets read as anchor points.
- Launch entry: a `<Panel>` on the custom-fields page (`app/(user)/workspace-admin/custom-fields` or equivalent) — title, description, **Launch Form Builder** button → opens `FormBuilderShell` for the current scope node + Story type.

## Runtime adoption + carry-through

- When an artefact edit form opens: if `artefacts_id_form_layout` is set, fetch that version row and render via `FormLayoutRenderer mode="runtime"`. Else render the existing `ArtefactInlineForm` (default).
- **Carried-fields fallback:** after rendering the layout's placed fields, query the artefact's `artefacts_fields_values`; any field with a value whose `fieldKey` is NOT in the layout renders in an appended **"Carried fields"** section. Guarantees no data hidden when a story authored on Insurance is viewed under a layout that omits some of Insurance's fields.

## Testing / verification (PoC bar)

- Migration applies clean; `schema_migrations` row present.
- Backend: build green; core-field validation rejects a layout missing `title`; happy-path save returns version 1, second save returns version 2 and flips is_current.
- Browser (as gadmin, read-only viewing): launch builder on B2C Insurance + Story; drag title/description/custom field into grid rows; save; create a Story on that node; reopen → renders in saved layout; add a custom-field value; verify Carried-fields fallback by rendering the story under a layout missing that field.
- Type/lint green (`lint:column-prefix`, `lint:no-direct-workspace-id`, etc.).

## YAGNI / explicit non-goals for PoC

- No receiving-node "adopt / re-lay-out" UI (the merge half) — only the carry + Carried-fields display.
- No per-field width beyond the 5 fixed templates.
- No multi-field cells, no nested rows.
- Only User Story wired end-to-end; other types share the schema but aren't seeded.
- Field reordering within the runtime form by end users (builder-only for now).

## Risks

- **Renderer reuse:** the existing field inputs are spread across `EditCustomFields` + `ArtefactInlineForm`. Risk of duplicating logic. Mitigation: extract a thin `<FieldInput descriptor value onChange>` dispatcher both can use; keep it minimal for PoC.
- **Stamp timing:** if create happens before a layout exists, ref stays NULL forever even if a layout is later authored. Acceptable for PoC (matches "adopt on create"); a future "re-stamp" job is tech-debt.
- **Version bloat:** every save inserts a row. Fine at PoC scale; add a prune/retention policy as TD if it grows.
```
