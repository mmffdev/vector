---
name: Table names use domain prefix for transparency
description: New tables in a substrate (artefacts, flows, etc.) MUST carry the domain prefix in the table name for grep-ability and audit clarity
type: feedback
---

When proposing or creating new tables, the table name MUST start with the domain prefix that signals which subsystem owns it. Generic-sounding names like `field_library` or `workspace_fields` are not acceptable — they hide ownership.

**Rule:**
- Tables in the artefacts substrate → `artefact_*` (singular) prefix.
  - `field_library` → `artefact_field_library`
  - `workspace_fields` → `artefact_workspace_fields`
  - Existing examples already follow this: `artefact_types`, `artefact_type_fields`, `artefact_field_values`, `artefact_number_sequence`.
- Master single-row records keep the `master_record_*` family (`master_record_tenant`, `master_record_portfolio`).
- Flow tables (`flows`, `flow_states`, `flow_transitions`) are a self-contained subsystem and follow their own family pattern.

**Why:** User is "a stickler for transparency". A grep for `artefact_` should return every table in the artefact substrate. Generic table names ambush future readers and obscure provenance — bad for procurement audit (finance / defence). Worth one extra prefix at creation time to avoid an entire class of "what does this table belong to?" lookups.

**How to apply:**
- Any time a new table is proposed in this project, name it with its domain prefix on first introduction. Don't propose `foo_bar` and rely on the user to ask for the prefix.
- If renaming an existing generically-named table, include an `ALTER TABLE … RENAME TO …` migration in the same change set, plus codebase-wide grep + replace of references.
- Same rule applies to columns when ambiguous (e.g. prefer `artefact_id` over `parent_id`), though existing column names take precedence over reflexive renaming.
