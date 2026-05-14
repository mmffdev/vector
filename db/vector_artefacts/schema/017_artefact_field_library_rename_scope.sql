-- ============================================================
-- MMFFDev - vector_artefacts: M2 (PLA-0026 / story 00477)
-- Rename field_library -> artefact_field_library + add scope discriminator
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 017_artefact_field_library_rename_scope.sql
--
-- This migration is the schema mechanism for the per-workspace portfolio
-- adoption cutover (R047). It is DELIBERATELY MINIMAL:
--
--   - Renames the table to its substrate-prefixed name (audit transparency).
--   - Adds the explicit scope discriminator (global | tenant | workspace).
--   - Relaxes subscription_id to nullable (NULL only when scope='global').
--   - Adds two CHECK constraints to keep scope and subscription_id honest.
--
-- Deliberately NOT in scope here:
--   - Column harmonisation (field_type -> data_type, options_json+config_json
--     -> config) — that is a follow-up that breaks Go readers and earns its
--     own migration once the read paths are scope-aware (M3+).
--   - Workspace whitelist table — M3.
--   - Cross-tenant uniqueness on global rows — handled when the first global
--     row is seeded (no global rows exist today; audit M1 confirmed).
--
-- Pre-flight (audited in M1, R047-audit-M1.txt):
--   - 1 row total (0 live, 1 archived); 0 NULL subscription_id; 0 cross-
--     tenant field_name duplicates; 0 inbound FK rows on either
--     artefact_type_fields.field_library_id or artefact_field_values.
--     field_library_id. The rename is safe.
--
-- Inbound FK constraints from artefact_type_fields and artefact_field_values
-- track the table by OID, not name; renaming the table does not invalidate
-- them and they keep referencing the renamed table without further work.
-- ============================================================

BEGIN;

-- 1. Rename the table.
ALTER TABLE field_library RENAME TO artefact_field_library;

-- 2. Rename the indexes (Postgres does not auto-rename named indexes).
ALTER INDEX field_library_pkey                RENAME TO artefact_field_library_pkey;
ALTER INDEX field_library_slug_unique_live    RENAME TO artefact_field_library_slug_unique_live;
ALTER INDEX field_library_by_subscription     RENAME TO artefact_field_library_by_subscription;

-- 3. Rename the trigger (auto-named after the table).
ALTER TRIGGER field_library_set_updated_at
    ON artefact_field_library
    RENAME TO artefact_field_library_set_updated_at;

-- 4. Relax subscription_id to nullable. Existing rows keep their values;
--    only future scope='global' rows will set this to NULL.
ALTER TABLE artefact_field_library
    ALTER COLUMN subscription_id DROP NOT NULL;

-- 5. Add the scope discriminator. DEFAULT 'tenant' is correct for every
--    pre-existing row (M1 audit confirmed: every row is tenant-scoped today).
--    Once backfilled the DEFAULT is dropped so future inserts must declare
--    scope explicitly — no implicit-tenant inserts that hide global intent.
ALTER TABLE artefact_field_library
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'tenant';

ALTER TABLE artefact_field_library
    ALTER COLUMN scope DROP DEFAULT;

-- 6. CHECK constraints — scope must be one of the three known values, and
--    subscription_id must be NULL iff scope='global'.
ALTER TABLE artefact_field_library
    ADD CONSTRAINT chk_afl_scope_values
        CHECK (scope IN ('global','tenant','workspace'));

ALTER TABLE artefact_field_library
    ADD CONSTRAINT chk_afl_global_no_subscription
        CHECK ( (scope = 'global'  AND subscription_id IS NULL)
             OR (scope IN ('tenant','workspace') AND subscription_id IS NOT NULL) );

-- 7. Refresh comments under the new name.
COMMENT ON TABLE  artefact_field_library IS
    'Catalogue of custom field DEFINITIONS, scoped to global / tenant / '
    'workspace. One row = one reusable field definition. Workspace-level '
    'whitelist (when scope=workspace) lives in artefact_workspace_fields.';
COMMENT ON COLUMN artefact_field_library.scope IS
    'global = visible to every tenant (subscription_id NULL); '
    'tenant = subscription-wide; '
    'workspace = subscription-scoped, gated by artefact_workspace_fields.';

COMMIT;
