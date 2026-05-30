---
name: form-layout-builder-poc
description: "The per-node form-layout builder PoC — Vector's killer differentiator. Drag-built artefact forms saved per (topology node + artefact type), travelling with the artefact across team boundaries."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d3f2757-250d-43da-982c-022dd73d5a00
---

# Form Layout Builder PoC (started 2026-05-30, overnight solo build)

Vector's headline differentiator — "never been done in this space" (user's words). Per-topology-node, drag-and-drop form layouts for execution artefacts (User Story first), saved as versioned JSON, that travel WITH the artefact when work crosses team/node boundaries.

**Why:** Jira/Rally/Azure DevOps lock form layout to project/global admin scope. None let a team own its own form AND have a receiving team inherit both the data and the layout on hand-off. This is the wedge.

**Locked decisions (user, 2026-05-30):**
- Carry-through = **origin-ref + graceful merge**: story stamped with a ref to the authoring node's layout VERSION; renders in that layout by default; receiving node can later adopt/re-lay-out; fields with values not in the new layout drop into a visible "Carried fields" section — no data ever hidden. PoC builds the snapshot-ref spine + Carried-fields fallback; defers the receiving-node adopt interaction.
- Layout keyed **per (topology_node_id + artefact_type_id)**. PoC focuses User Story; schema supports all types.
- Storage = **new dedicated versioned table** `topology_node_form_layouts` (id, topology_node_id, artefact_type_id, layout_json, version, created_at…). Version column is what makes snapshot-ref carry-through possible.

**Layout JSON schema (the heart):** row-based. `{ version, artefactTypeId, rows: [{ id, template, cells: [{ id, fieldKey, span }] }] }`. template ∈ {100, 50-50, 30-70, 70-30, 30-30-30}. fieldKey = core string key (title/description/owner…) OR `custom:<field_library_id>`; null = empty cell. One field per cell. Layout stores REFERENCES not metadata — label/type resolved at render from catalogues.

**Substrate (from explore, 2026-05-30):**
- topology_nodes → vector_artefacts, migration 031. No JSON col yet. Service topology.New(servicePool, vaPool), routes /_site/api/topology.
- Existing FormRenderer at app/components/DataGrid/formSpec.ts is vertical-stack 1-or-2 col ONLY — cannot do row grids. New row schema fills the gap.
- Cross-node carry-through HALF-SOLVED: artefact_field_values keyed by (artefact_id, field_library_id), NO topology scoping — values already persist across nodes. Only the layout needs to travel.
- Custom fields catalogue: artefact_field_library (006), artefact_type_fields bindings (007), artefact_field_values (008). All vector_artefacts.
- Current hardcoded form: app/components/ArtefactInlineForm/ArtefactInlineForm.tsx (two-col JSX, lines ~301-566 are the replaceable block).

**Build entry point:** custom-fields page → Panel (title/description/Launch Form Builder) → fullscreen builder over rails+shell, save/cancel top-right, 20% field-sidebar / 80% canvas. Core fields = must-haves (block save with reason). Then custom fields + create-new-field inline.

**Column-prefix HARD RULE:** every column `<table_name>_<column>`. New table cols: topology_node_form_layouts_id, _id_topology_node, _id_artefact_type, _layout_json, _version, _created_at, etc.

**Build discipline:** solo overnight, commit on main as I go, sub-agents for parallel work, SERVER IS THE GATE (validate core-field presence + read-only on backend, not just client). Design doc: docs/superpowers/specs/2026-05-30-form-layout-builder-design.md.
