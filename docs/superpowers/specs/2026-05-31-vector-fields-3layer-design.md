# Vector Fields — 3-Layer Model (Definition · Context · Layout)

**Date:** 2026-05-31
**Status:** DRAFT — pending user approval
**Author:** Claude (governing agent)
**Supersedes the fork in:** `docs/superpowers/specs/2026-05-30-unified-field-model-design.md` (that doc surfaced Option A/B/C; this doc resolves it against the industry-standard pattern).
**Evidence base:** deep-research run 2026-05-31 (22 sources, 80 claims → 7 high-confidence after 3-vote adversarial verification). Primary sources: Atlassian Jira DC custom-fields developer docs, Jira context admin docs, Jira screen-scheme docs, Asana custom-field-settings API, Azure DevOps process-field docs, Martin Fowler "UserDefinedField".

---

## Synopsis

Rick asked for "a single fields table — all fields, core + custom, with families." Investigating how mature multi-tenant work-management platforms (Jira, Salesforce, Rally, ServiceNow, Azure DevOps, Asana) model this shows they **all converge on the same 3-layer separation**, and that a single physical table is the wrong target for the same reasons EAV-everything was. The battle-tested shape is: **(1) a field DEFINITION table** (the field, once), **(2) a CONTEXT/binding table** (which entity-types the field applies to, carrying per-context rules like required/compulsory/position, with NULL=all and tenant/workspace scoping), and **(3) a LAYOUT/screen layer** (presentation per type — which Vector ALREADY HAS as form layouts). Vector's current `artefacts_fields_library` + `artefacts_types_fields` + form-layouts is a stunted version of exactly this; the fix is to rename + promote them into the standard shape, made Vector-wide (artefacts AND timeboxes) and full-tenant-scoped.

## The pattern (verified, not invented)

Every platform researched uses the same three layers. Jira is the best-documented and the closest analog to Vector (system + custom fields, fields reused across issue types, typed values, multi-tenant):

| Layer | Jira | Salesforce | Asana | Vector (target) |
|---|---|---|---|---|
| **1. Definition** — the field, once | `customfield` | `custom_field_definition` / MT_Fields | custom field | **`vector_fields_library`** |
| **2. Context** — field↔type binding + per-binding rules | `fieldconfigscheme` + `configurationcontext` (project, NULL=all) + `fieldconfigschemeissuetype` (issue-type, NULL=all) | object association | **`custom_field_settings`** (per-project binding, carries `is_important`+position) | **`vector_fields_context`** (NEW) |
| **3. Layout** — presentation per type | `screen` → `screenscheme` → `issuetypescreenscheme` | page layout | (client) | **form layouts** (ALREADY BUILT) |

**Key verified facts (3-0 / 2-0 adversarial votes):**
- Jira's **context** is a first-class entity: "a combination of projects and issue types where that field can be used." One field → **many contexts**; per-context **default/options/required live on the context, not the definition**.
- **`NULL` scope = "all"** — a universal field (e.g. `title`) is ONE context row with NULL type, NOT duplicated per type. This is the answer to the universal-field duplication Rick rejected.
- **Context (validity/required) and Layout (placement) are deliberately SEPARATE layers.** You require a field in the context; you position it in the layout. Don't fuse them.
- **Values:** neither Jira nor Salesforce uses pure EAV-key/value or a JSON blob as the canonical store. Jira = typed columns (`customfieldvalue.STRINGVALUE/NUMBERVALUE/TEXTVALUE/DATEVALUE` + discriminator, keyed by field FK). Salesforce = pre-allocated flex columns (`val0..valN`). **Vector's existing `artefacts_fields_values` (5 typed buckets) IS the Jira model already.**

## Why NOT a single physical table

Rick's "one table" instinct is right at the METADATA layer (definition unified once) but wrong at the VALUE layer — confirmed by both the substrate analysis (prior doc §Critical substrate facts) AND the industry evidence (no leader collapses values to one EAV/JSON table). A single table conflates three things that vary independently:
- what a field IS (per field) — belongs in Definition
- whether a TYPE uses it + is it required (per field×type×tenant) — belongs in Context
- where it's DRAWN (per layout) — belongs in Layout
Collapsing them forces duplication (the pain Rick named) or NULL-soup. The 3-layer split is what removes the duplication.

## Target tables (Vector names, full column-prefix per HARD RULE)

### Layer 1 — `vector_fields_library` (the field, defined once)
Vector-wide (serves artefacts, timeboxes, future entity kinds). Rename/supersede of `artefacts_fields_library`.
```
vector_fields_library_id              uuid pk
vector_fields_library_id_tenant       uuid   NULL  -- NULL = Vector-global (core/default fields)
vector_fields_library_id_workspace    uuid   NULL  -- NULL = tenant-wide (custom not workspace-scoped)
vector_fields_library_name            text         -- stable key, e.g. "severity"
vector_fields_library_label           text         -- display, e.g. "Severity"
vector_fields_library_description      text
vector_fields_library_type            text         -- data type: text|number|date|boolean|select|richtext
vector_fields_library_kind            text         -- 'core' | 'custom'  (ONLY these two — Rick)
vector_fields_library_created_by      text         -- 'Core' for system fields, else the user's name (Rick)
vector_fields_library_options_json    jsonb  NULL  -- select options / config
vector_fields_library_created_at      timestamptz
vector_fields_library_updated_at      timestamptz
vector_fields_library_archived_at     timestamptz NULL
```
- `kind='core'` → Vector ships it; `created_by='Core'`; value lives in a typed `artefacts` column (value_location resolved by name).
- `kind='custom'` → a tenant made it; `created_by`=user name; value lives in the values table.
- Segregation: every query filters `id_tenant` (+ `id_workspace` where applicable). Core/global rows have NULL tenant and are visible to all (read-only).

### Layer 2 — `vector_fields_context` (NEW — the binding, Jira "context")
Replaces `artefacts_types_fields`. Polymorphic (artefacts AND timeboxes) + full tenant/workspace scope (Rick chose "full Jira").
```
vector_fields_context_id              uuid pk
vector_fields_context_id_field        uuid  -> vector_fields_library_id
vector_fields_context_entity_kind     text        -- 'artefact' | 'timebox' | …
vector_fields_context_id_entity_type  uuid  NULL  -- the Defect type / Sprint type; NULL = ALL types of that kind
vector_fields_context_id_tenant       uuid        -- per-tenant binding (segregation + Jira-grade flexibility)
vector_fields_context_id_workspace    uuid  NULL  -- NULL = tenant-wide binding
vector_fields_context_required        boolean     -- must enter DATA (per-binding)
vector_fields_context_is_compulsory   boolean     -- must be PLACED on the layout (per-binding)
vector_fields_context_position        integer
vector_fields_context_default_value   text  NULL
vector_fields_context_created_at      timestamptz
vector_fields_context_updated_at      timestamptz
```
- `id_entity_type = NULL` → field applies to ALL types of `entity_kind` (the universal-field answer; `title` = one row, NULL type). Queries use `(id_entity_type = $type OR id_entity_type IS NULL)`.
- One field → many context rows (one per type/tenant scope it's bound to).
- `required` vs `is_compulsory` kept distinct (Rick's earlier ask): data-entry vs layout-placement.

### Layer 3 — form layouts (ALREADY BUILT — `topology_node_form_layouts`)
No new table. The existing FLB layout IS the Jira screen/screen-scheme layer: per (node, type) it says which fields render, where, in what order. Context governs *validity/required*; layout governs *placement*. They stay separate.

### Values — `vector_fields_values` (rename of `artefacts_fields_values`; keep shape)
Already Jira-shaped (5 typed buckets). Core values stay in typed `artefacts` columns (indexing, FKs, slot-gate trigger). No value migration.

## Migration path (gradual — no big-bang, per HARD RULE)
1. Create `vector_fields_library` + `vector_fields_context` alongside the existing tables.
2. Backfill: copy `artefacts_fields_library` → `vector_fields_library` (kind='custom'); seed core fields from `columns.go` as kind='core', tenant NULL. Copy `artefacts_types_fields` rows → `vector_fields_context` (entity_kind='artefact', carrying required + the mig-167 is_compulsory).
3. Repoint the `formlayouts` registry read + save gate to the new tables (the `valueLocation` + compulsory-custom work from mig 167 ports directly).
4. Drop the old tables one reader at a time once nothing references them (SY003-tracked).
5. `columns.go` family system becomes the SEED for core context rows (Defect-family core fields → context rows with entity_type per Defect-ish type, or NULL where universal). Long-term: family logic becomes data, not code — resolving the Go/DB split the DBA-lens flagged.

## What this fixes (the DBA complaints)
- **Schema self-describing:** "what fields on a Defect?" = one SQL query against `vector_fields_context` (no Go family switch needed at query time).
- **One mechanism:** core + custom both bind via context rows; no core-by-Go / custom-by-DB asymmetry.
- **Clear names:** library=definition, context=binding, layout=presentation, values=data. No three-opaque-"fields"-tables confusion.
- **Vector-wide:** timeboxes get fields for free via entity_kind.

## Non-goals / YAGNI
- No value-store change (typed columns + typed-bucket values stay — industry-confirmed).
- No JSON/Mongo document model (form.io's approach — wrong for a typed/queryable defence-finance store).
- Layout layer untouched (already correct).

## Risks
- **Backfill correctness** — core-field seeding from `columns.go` families must exactly reproduce current applicability (drift-pin test, extended from `compulsory_test.go`).
- **Two-tables-live window** — registry read must union old+new during cutover, or cut over atomically per consumer.
- **Tenant-scoped context row count** — per-tenant binding multiplies rows; acceptable (it's data), indexed on `(id_tenant, entity_kind, id_entity_type)`.

## Change Log
- **2026-05-31** — Initial draft; resolves the 2026-05-30 Option A/B/C fork against the Jira 3-layer pattern (deep-research verified). Names: vector_fields_library + vector_fields_context + existing form layouts. Full tenant/workspace context scoping per Rick.
