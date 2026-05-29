---
name: custom_fields_core_demotion
description: 44 miscategorized catalogue entries need demoting to core schema; only acceptance_criteria (richtext) is legitimate custom; requires Rally-spec audit + schema migration
metadata:
  type: project
---

# Custom Fields → Core Fields Demotion (2026-05-29)

**The state:** `artefacts_fields_library` contains 44 rows; ZERO values exist across all of them. 18 are auto-generated `test_field_*` from integration-test cleanup failures. Remainder are orphaned catalogue entries (e.g., `blocked`, `blocked_reason`, `pi_date_`, `us_status_`, etc.) that should be **core artefact columns**, not custom.

**The legitimate custom field:** Only `acceptance_criteria` (richtext, created 2026-05-08) is a real workspace-defined field. `acceptance_criteria2` (textbox, created 2026-05-09 as a failed "fix") is a dup → delete outright.

**Why it slipped:** During Slice 4.5 (ObjectTreeV2 column-picker wiring), custom-field bindings were scaffolded but the upstream field demoting/auditing was deferred. Meanwhile test-helpers and hand-seeded entries accumulated in the catalogue without being cleaned up or classified correctly.

**How to apply:** Next session should:
1. Read the Rally OpenAPI spec (already fetched at `Rally-openapi-spec.json`, 1.5MB) to extract the canonical issue-field list (core fields by type).
2. Compare against current `artefacts` table schema + `artefacts_fields_library` rows.
3. File a spec (docs/superpowers/specs/2026-05-29-custom-fields-catalogue-audit.md) documenting:
   - Which catalogue rows are orphaned and should be hard-deleted
   - Which should be demoted to `artefacts` core columns (and the migration to add them)
   - Which are legitimate custom fields (acceptance_criteria only)
   - New UI: read-only **Core Fields** table + **Custom Fields** table side-by-side in the admin page
4. Plan the migrations + the UI refactor.
5. Execute.

**Scope:** This is a **Slice 4.5 follow-up**, non-trivial, multi-layer (DB + API + UI). Not a quick fix. Should be brainstorming → spec → plan → build, same as saved-views.

**Risk:** The catalogue was supposed to be the source-of-truth for per-workspace fields; it's now a garbage heap. Clean it first before shipping any grid-projection feature that reads from it.
