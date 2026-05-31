# Handover — Unified Field Registry + `is_compulsory` (Option A)

**Written:** 2026-05-30 (end of FLB session, pre context-wipe)
**Author:** Claude (governing agent)
**Pairs with:** `handovers/handover_form_viewer_live_preview.md` (the consumer of this work)
**Design doc:** `docs/superpowers/specs/2026-05-30-unified-field-model-design.md` (read it first — this handoff implements its **Option A**)

---

## ⚠️ STATUS (2026-05-31): SUPERSEDED & SHIPPED — Option A evolved into the 3-LAYER model

This handover's "Option A registry" was the right instinct but got **upgraded** after researching how Jira/Salesforce/Rally/ServiceNow/Azure DevOps/Asana actually model fields. They all converge on a **3-layer** separation, and Vector adopted it. **What actually shipped (committed `ee475805`, applied to dev):**

- **mig 167** (`artefacts_types_fields_is_compulsory`) — the per-binding compulsory marker described below. ✅ DONE, committed `b7f2c16e`.
- **mig 168 `vector_fields_library`** — Layer 1, field DEFINITION (once, Vector-wide, kind core|custom, tenant/workspace scoped).
- **mig 169 `vector_fields_context`** — Layer 2, BINDING (Jira "context"): polymorphic `entity_kind` (artefact|timebox) + full tenant/workspace scope; `NULL entity_type = all-types` (kills universal-field duplication); FK→library; carries `required`/`is_compulsory`/`position`.
- **mig 170** — backfill from legacy (`artefacts_fields_library`⋈`artefacts_types_fields`). Counts verified **85 context / 34 library**, idempotent.
- **`backend/internal/vectorfields/`** — new reader package (`ContextForType`).
- **`formlayouts.CustomFields` REPOINTED** onto `vectorfields` — custom fields now read from the 3-layer tables. **Parity verified 69/69 active types, 0 mismatches.**
- **Test noise purged** (36 Test Types + 19 test fields + 9 bindings) before backfill — only real data carried forward.
- **SY003** regenerated (eighth-wave).

**Canonical docs now:** spec `docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md` + plan `docs/superpowers/plans/2026-05-31-vector-fields-3layer.md`. Read THOSE, not the Option-A framing below (kept for history).

**Still deferred (follow-on plans, NOT done):** core-field seeding from `columns.go` into `vector_fields_context`; repoint the `fields`/`artefactitems`/`notifications` consumers; drop legacy `artefacts_types_fields`/`artefacts_fields_library` one reader at a time. Legacy tables remain authoritative for those consumers — gradual cutover.

**The consumer (form-viewer preview) is now UNBLOCKED:** `getCoreFields(typeId)` returns every field with `valueLocation` ("artefacts_column"|"eav") + `isCompulsory`, so the preview knows where each value lives. Next active work → `handovers/handover_form_viewer_live_preview.md`.

---

<details><summary>Historical Option-A framing (superseded — kept for context)</summary>

---

## 1. The decision (what Rick approved)

Rick said "one table, every field, marked core/custom/compulsory — kill the design noise." The substrate investigation (in the design doc §Problem / §Critical substrate facts) proved that **physically merging field VALUES into one table is a regression** (loses typed columns, real FKs, generated columns like `risk_calculated`, and the DB slot-gate trigger — a security regression for a Trust-No-One/defence-finance product). Migrations 146–164 are actively moving the *opposite* way (custom→core demotion to GAIN typed columns).

**So the approved path is Option A — a unified field REGISTRY (metadata in one queryable surface), values stay in their two performant homes.** Rick's instruction this session: *"pivot to that plan and action it."* He did NOT pick Option B (physical EAV-everything) or C (registry-generates-columns). If a future session is tempted toward B/C, STOP and reconfirm — A is the live decision.

**Why this matters for the form viewer:** the viewer needs ONE uniform way to ask "for artefact type X, what are all its fields (core + custom), which are compulsory, and where does each field's value live?" Today that requires touching `columns.go` (Go, compile-time) AND `artefacts_fields_library`⋈`artefacts_types_fields` (DB). The registry collapses that to one read.

---

## 2. Substrate facts (VERIFIED this session — do not re-assume, but DO re-verify before applying per the "never assume a DB" HARD RULE)

DB: **`vector_artefacts`** (vaPool). Trace: handler in `backend/internal/artefactitems/` → `backend/cmd/server/main.go` `NewService(...)` uses `vaPool` → `docs/c_c_db_routing.md`. psql via the migration skill's password mapping (`VA_DB_PASSWORD`, host localhost:5435, user mmff_dev, db vector_artefacts).

**Tables in play (post-prefix-rename — these are the REAL current column names):**

- **`artefacts_fields_library`** (custom-field definitions, per subscription). Cols: `artefacts_fields_library_id`, `_id_subscription`, `_field_name`, `_label`, `_field_type`, `_options_json`, `_config_json`, `_description`, `_created_at`, `_updated_at`, `_archived_at`, `_scope`. (Source: mig 100.)
- **`artefacts_types_fields`** (binding: which custom field applies to which type). Cols: `artefacts_types_fields_id`, `_id_artefact_type`, `_id_field_library`, `_position`, `_required`, `_default_value`, `_created_at`, `_updated_at`. (Source: mig 101.) **NOTE: has `_required`, does NOT have `_compulsory` yet.**
- **`artefacts_fields_values`** (EAV custom VALUES — stays put). Cols: `artefacts_fields_values_id`, `_id_artefact`, `_id_field_library`, `_string_value`, `_text_value`, `_number_value`, `_date_value`, `_boolean_value`, `_created_at`, `_updated_at`. Keyed by `(_id_artefact, _id_field_library)` — **NO topology-node column** (values travel with the artefact by identity; this is the carry-through spine). (Source: migs 008 + 064.)
- **`artefacts`** (core VALUES = real typed columns — stay put). 77 columns as of mig 165.

**Core field METADATA lives in Go, not the DB:**
- `backend/internal/artefactitems/columns.go` — `ArtefactItemColumns []ColumnSpec` (~80 entries, compile-time). `ColumnSpec` has `.Family` + `.AppliesToType(slot, scope)` (line ~120).
- Compulsory-ness is **computed in Go**, NOT a column: `CompulsoryFieldsForType(slot, scope)` (columns.go line ~433) unions `compulsoryUniversalKeys` (line 367) + per-family slices (`compulsoryStrategyKeys` 380, `compulsoryDefectKeys` 392, `compulsoryEpicKeys` 402, `compulsoryStoryKeys` 409, `compulsoryTaskKeys` 416, `compulsoryRiskKeys` 422), filtered through the catalogue + `skipFromBuilder`.
- The compulsory rubric (Rick's mapping of which fields are compulsory per type) is written out in the design doc §"The compulsory set" (lines 62–71) — that is the source of truth for the per-type matrix.

**The DB slot-gate trigger** `trg_artefacts_slot_gate_aiu_fn` (migs 158/162) is the HARD gate: raises `23514` if an out-of-family core column is non-null. The registry MIRRORS this; it does NOT replace it. Drift between registry and trigger is pinned by a drift test (extend the existing `compulsory_test.go` pattern).

---

## 3. What to build (migration + backend, in order)

### Step A — Add `is_compulsory` to the custom-binding table
Migration (next NNN — scan `ls -r db/vector_artefacts/schema/ | grep -E '^[0-9]+_' | head -1`; **166 is taken** by the FLB draft column, so you're on **167+**). Use the `<migration>` skill, target `vector_artefacts`, `-env backend/.env.dev`.

```sql
ALTER TABLE artefacts_types_fields
  ADD COLUMN IF NOT EXISTS artefacts_types_fields_is_compulsory BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN artefacts_types_fields.artefacts_types_fields_is_compulsory IS
  'Per-(type,custom-field) compulsory marker — the layout save-gate requires every compulsory field be placed. Mirrors the core-field compulsory set computed in columns.go.';
```
Idempotent (`IF NOT EXISTS`). Per-(field,type) granularity is intentional — compulsory-ness IS per type. Pair a DOWN script.

### Step B — Core-field compulsory metadata as DB rows
The design doc Option A wants core metadata queryable too. Two honest sub-options — **pick the lower-risk one unless Rick says otherwise**:

- **B1 (recommended, smaller):** Keep `CompulsoryFieldsForType` in Go as the authority for CORE fields; expose it through the registry VIEW by having the backend assemble the registry in Go (union Go core-meta + a DB query for custom). NO new core-meta table. Lowest blast radius, no drift surface beyond what exists.
- **B2 (doc's literal Option A):** New table `artefacts_core_fields_meta` (the `ColumnSpec` metadata as rows, drift-pinned to `columns.go`), + `is_compulsory` per row. Bigger; only do this if Rick wants the registry to be a pure DB view with no Go assembly.

**Default to B1** — it delivers the unified read surface the form viewer needs without a core-metadata migration, and matches the in-flight direction. Note the choice explicitly in the migration header / a TD entry so the next reader knows why.

### Step C — The registry read surface
A backend method (NOT necessarily a DB view if B1) that returns, for a given `(artefactTypeId, slot, scope, subscriptionId)`, one uniform row list:

```
field_key · kind(core|custom) · label · data_type · group ·
is_compulsory · value_location("artefacts_column" | "eav") ·
(custom only) id_field_library · position
```

- Core rows: from `CoreFields(slot, scope)` (already exists in `formlayouts/service.go:336`) + `CompulsoryFieldsForType` for the `is_compulsory` flag + `value_location="artefacts_column"`.
- Custom rows: from `CustomFields(ctx, typeID, subscriptionID)` (already exists, `service.go:361`) joined to the new `artefacts_types_fields_is_compulsory` + `value_location="eav"`.
- **This is largely an EXTENSION of the existing `/api/form-layouts/core-fields` handler** (`formlayouts/handler.go:263` `coreFields`), which already merges core + custom into `CoreFieldDescriptor[]`. Add `isCompulsory` (already on the descriptor) + `valueLocation` to that DTO and you have the registry. The form viewer can reuse `getCoreFields(typeId)` rather than a brand-new endpoint.

### Step D — Wire `is_compulsory` into the save gate (already mostly done)
The FLB save gate already enforces `CompulsoryFieldsForType` (see `formlayouts/service.go` `validateDoc` + `compulsory_test.go`). When custom fields gain `is_compulsory`, extend the gate to also require placed compulsory CUSTOM fields. Mirror the drift test.

### Step E — SY003 + lints
- Regenerate SY003 after the migration applies (HARD RULE): `<report> -sy "..."` — note the new `artefacts_types_fields_is_compulsory` column + (if B2) the core-meta table.
- `lint:column-prefix` will demand the full-table-name prefix — `artefacts_types_fields_is_compulsory` already complies.

---

## 4. Gotchas / landmines

- **Do NOT touch human accounts** (gadmin@/padmin@/user@mmffdev.com) — HARD RULE.
- **Do NOT physically migrate values.** If you find yourself writing `INSERT INTO some_new_values_table SELECT ... FROM artefacts`, you've drifted into Option B — STOP.
- **The EAV table has NO node column on purpose** — don't "fix" that; it's the carry-through spine.
- **`meg=` is NOT how you scope** — it's a user bookmark/share URL param read by `SentinelProvider` (named after Megan, PLA-0053). The topology clamp is `sentinel.FromCtx(ctx).AllowedSubtreeIDs`, applied fail-closed via `sentinel.SubtreeClause`. Never append `meg=` to a query to scope it. (See CLAUDE.md tracing-authority corollary + diagnose skill, both updated this session.)
- **Backend env pinned to `dev`** — never switch.
- **Don't commit unless Rick asks.** Leave the dirty MFA file (`backend/internal/auth/service.go`) and untracked playwright debug scripts unstaged.
- **`is_compulsory` does not exist in the DB today** — verified this session via grep. Anything claiming it does is stale.

---

## 5. Definition of done
1. `artefacts_types_fields_is_compulsory` column applied + verified in `schema_migrations` (dev).
2. Registry read surface returns uniform core+custom rows with `isCompulsory` + `valueLocation` for a given type (B1: Go-assembled; reuse/extend `coreFields` handler).
3. Save gate enforces compulsory CUSTOM fields too; drift test extended.
4. SY003 regenerated.
5. Form viewer handoff's needs are met (it reads the registry to know which fields exist + where their values live).

</details>
