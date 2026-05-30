# Unified Field Model — Design Spec (DRAFT — pending user decision on shape)

**Date:** 2026-05-30
**Status:** DRAFT — substrate mapped, key fork awaiting user decision (see §Decision Required)
**Author:** Claude (governing agent)
**Motivates:** the Compulsory-Locked-Group feature + Rick's "one table, every field, marked core/custom/compulsory — kill the design noise" instruction (2026-05-30).

## Synopsis

Field identity in Vector is spread across three disjoint sources of truth, so answering "is field X core or custom, compulsory or optional, and which types does it apply to?" requires touching 5+ places. Rick asked to collapse this to **one table where every field is a row with marker columns**. This spec maps the substrate, shows which parts of that vision are achievable vs constrained by hard performance/security requirements, and proposes a **unified field registry** (metadata + markers in one place) while field *values* stay in their performant typed homes. The Compulsory-Locked-Group feature then falls out of a single `is_compulsory` marker.

## Problem — the three sources of truth (mapped 2026-05-30)

| Concern | Core fields | Custom fields |
|---|---|---|
| **Definition** | `ArtefactItemColumns []ColumnSpec` (Go slice, compile-time) — `backend/internal/artefactitems/columns.go`, ~80 entries | `artefacts_fields_library` rows (DB, runtime), `c_artefacts_*` slug |
| **Which types** | `ColumnSpec.Family` + `AppliesToType()` — AND the DB trigger `trg_artefacts_slot_gate_aiu_fn` (migs 158/162), kept in sync only by a drift test | `artefacts_types_fields` bindings (`position`, `required` per type) |
| **Required?** | `mandatoryCoreFieldKeys = {title, flow_state_name, owner}` (hardcoded, `formlayouts/types.go:97`) | `artefacts_types_fields.required` (per binding) |
| **Value storage** | a real typed column on `artefacts` | an EAV row in `artefacts_fields_values` (5 typed buckets) |
| **Forbidden gate** | DB trigger raises `23514` if an out-of-family core column is non-null | n/a (bindings simply absent) |

There is **no single "required" concept** and **no table that describes both core and custom fields**. That is the design noise.

## Critical substrate facts (verified, not assumed)

1. **Field VALUES already travel across nodes.** `artefacts_fields_values` is keyed purely by `(id_artefact, id_field_library)` — **no topology-node column** (verified against the full post-rename schema). So a value set on Node A persists by artefact identity when the artefact is shared to Node B. This is the spine of the bidirectional carry-through Rick wants (Node A's fields + Node B's fields accumulate on one artefact). **Only the layout needs to travel** — and it does, via the `artefacts_id_form_layout` snapshot stamp.

2. **Core field values + the slot-gate trigger CANNOT leave the `artefacts` table** without a fundamental rework:
   - `?fields=` projection maps names directly to `WorkItem` json tags → real SQL columns. Sort/filter (`story_points > 5`) rely on typed columns + indexes.
   - The BEFORE-INSERT/UPDATE trigger reads `NEW.<column>` — it physically cannot reference rows in another table per-row. Moving cores to EAV means re-implementing every family gate in app logic (a security regression for a Trust-No-One product).
   - Generated columns (`risk_calculated`), real FKs (`submitted_by` user FK), and typed CHECKs are column-level; EAV's 5-bucket typing is coarser and loses them.
   - **Migrations 146-164 are actively demoting custom → core** (the opposite of EAV-everything) precisely to gain typed columns + indexing.

   **Conclusion:** "one table for all field VALUES" is the wrong target — it regresses indexing, typing, FKs, and DB-enforced gating. The *movable* part is field **metadata** (label, group, kind, family, compulsory, default-visible), which is already pure data.

## The fork — Decision Required

Rick said "one table, 100%." The substrate says values can't unify without regression. Two honest readings:

### Option A — Unified field REGISTRY (recommended)
One queryable surface (a DB **view** `artefacts_fields_registry`, or a Go-assembled registry) that lists **every field, core and custom**, each row carrying markers:
`field_key · kind(core|custom) · label · group · data_type · applies_to(slot/scope or binding) · is_compulsory · is_mandatory · value_location(artefacts_column | eav) · is_required_per_type`.
- Values stay where they perform: core → `artefacts` columns; custom → `artefacts_fields_values`. **No value migration, no regression.**
- The slot-gate trigger stays as the hard DB gate; the registry mirrors it (drift-pinned, as today).
- "Compulsory" becomes one marker column. The locked-group + save-gate read it directly.
- Kills the *design noise* (one place to answer "what is field X?") without touching the *value substrate*.

### Option B — Full physical single table (NOT recommended)
Migrate all core columns into a generic `fields` + `field_values` EAV pair. Regresses typed indexing, real FKs, generated columns, and forces re-implementing the family gate in app code. High blast radius, contradicts the in-flight demotion direction (migs 146-164), weakens the security posture. Only justified if Rick explicitly wants EAV-everything despite the cost.

### Option C — Registry as the source, core columns generated from it
Registry table is authoritative; a build step generates `ColumnSpec` + (eventually) the trigger from registry rows. Highest future-proofing, but a bigger build now. Could be a phase-2 on top of Option A.

## Recommended path (Option A) — high level

1. **Registry surface.** A DB view unioning (a) core fields from a new `artefacts_core_fields_meta` table (the `ColumnSpec` metadata as rows, drift-pinned to `columns.go` — or `columns.go` generated from it) and (b) custom fields from `artefacts_fields_library ⋈ artefacts_types_fields`. Output one uniform row shape.
2. **Compulsory marker.** Add `is_compulsory` to the core-meta rows + to `artefacts_types_fields` (custom). Per-(field, type) granularity — because compulsory-ness IS per type (e.g. `is_expedite` compulsory on Defect/Epic/Story, not Task/Risk).
3. **Locked group.** The builder seeds a single top group "Required fields" from the registry's `is_compulsory` set for the type; renders it locked (the `lockedTypeId` UI pattern, applied to placed cells — can't remove/drag out).
4. **Save gate (SERVER IS THE GATE).** `formlayouts` validator rejects a layout missing any `is_compulsory` field for its type. Extends the existing `mandatoryCoreFieldKeys` check.
5. **Bidirectional carry-through (later phase, Rick: "build after grounding").** Node B edits a shared artefact through work-items → renders Node A's stamped layout → can append its own custom fields (values write to the shared `artefacts_fields_values`) → Node A reopens and sees both via the "Carried fields" surface. Registry's `value_location` + per-node provenance make "whose field is this" cheap to render.

## The compulsory set (from Rick's rubric, mapped to keys)

Universal: `title, description, owner, created_by, parent_id, tags, notes, topology_node_id, is_blocked, blocked_reason, flow_state_changed_at, flow_state_name, flow_state_change_owner_user_id, colour, children_count`.
Strategy +: `is_ready, estimate_initial, estimate_updated, planned_start_date, planned_finish_date, actual_start_date, actual_end_date, due_date, strategic_investment_group, strategic_investment_weight, strategic_job_size, strategic_value_stream_identifier, release_id, milestone_id`.
Defect +: `sprint, release_id, milestone_id, defect_severity, defect_status, defect_resolution, is_expedite, rollup_points, submitted_by_user_id, work_accepted_date`.
Epic +: `sprint, release_id, milestone_id, story_points, is_expedite, work_accepted_date, rollup_points`.
Story/work +: `sprint, release_id, milestone_id, story_points, is_expedite, work_accepted_date`.
Task +: `sprint, release_id, milestone_id, estimate_hours`.
Risk +: `sprint, release_id, milestone_id, estimate_hours, risk_impact, risk_impact_score, risk_probability, risk_probability_score, risk_response, risk_exposure, risk_calculated, risk_resolution, submitted_by_user_id, work_accepted_date`.
(Resolved: "Topology Mode"→`topology_node_id` typo; "Release Notes"→removed.)

## Non-goals / YAGNI
- No EAV migration of core values (Option B) unless Rick overrides.
- Bidirectional Node-B-appends-fields interaction is a later phase (spine already exists).
- No change to the slot-gate trigger's role as the hard DB gate.

## Risks
- **Registry/trigger drift** → mitigated by the existing drift-pin test pattern, extended to cover compulsory.
- **Per-(field,type) compulsory matrix size** → it's data, not code; modelled as rows, not a switch.

## Change Log
- **2026-05-30** — Initial draft; substrate mapped; fork surfaced for user decision.
