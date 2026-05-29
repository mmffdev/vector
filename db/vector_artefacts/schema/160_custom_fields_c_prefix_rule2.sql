-- ============================================================
-- 160_custom_fields_c_prefix_rule2.sql
--
-- Rule 2 (2026-05-29 — Rick): every CUSTOM field row in
-- artefacts_fields_library must have its field_name prefixed
-- `c_artefacts_` so the row's name discloses
--   (a) it's a custom field, and
--   (b) which table its values join against
--       (artefacts_fields_values → artefacts).
--
-- Source audit: dev/research/column_prefix_compliance_audit.md §C
-- shows all 84 rows in artefacts_fields_library currently violate
-- (20 active + 64 archived), and 0 rows in artefacts_fields_values
-- reference any of them — so the rename is data-trivially-safe.
--
-- Rick decision 1 (2026-05-29): rename ALL 84 rows (active + archived)
-- for uniform compliance. Future re-activation of an archived row
-- cannot reintroduce a violation.
--
-- Rick decision 3 (2026-05-29): scope this migration to
-- artefacts_fields_library only. If a second per-table catalogue ever
-- appears (e.g. a hypothetical `workspaces_fields_library`), the rule
-- generalises to `c_<stripped_table_name>_<column>` for THAT table
-- and needs its own migration mirroring this one. See
-- dev/research/column_prefix_compliance_audit.md §F-4 for the
-- generalisation path.
--
-- Defence-in-depth (HARD RULE — server is the gate):
--   1. Handler-side validator in backend/internal/fields/handler.go
--      (createFieldIn) rejects bad submissions with 400 BEFORE SQL.
--   2. Postgres CHECK constraint below catches any path that bypasses
--      the handler (direct psql, future migrations, tests that seed
--      via SQL).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/160_custom_fields_c_prefix_rule2_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. Rename all violating rows. ──────────────────────────────────
-- The FK on artefacts_fields_values is on the UUID (artefacts_fields_library_id),
-- not the name, so this UPDATE does not break any reference. The two
-- unique partial indexes — (subscription, name) WHERE NOT archived, and
-- (subscription, label, type) WHERE NOT archived AND scope='tenant' —
-- are unaffected because we prepend the same constant prefix to every
-- name, preserving the partial order.
UPDATE artefacts_fields_library
   SET artefacts_fields_library_field_name =
         'c_artefacts_' || artefacts_fields_library_field_name
 WHERE artefacts_fields_library_field_name NOT LIKE 'c\_artefacts\_%' ESCAPE '\';

-- ── 2. Verify post-condition: 0 non-compliant rows remain. ─────────
DO $$
DECLARE bad INT;
BEGIN
    SELECT COUNT(*) INTO bad
      FROM artefacts_fields_library
     WHERE artefacts_fields_library_field_name !~ '^c_artefacts_[a-z][a-z0-9_]*$';
    IF bad > 0 THEN
        RAISE EXCEPTION 'mig 160: % non-compliant rows remain after rename', bad;
    END IF;
END $$;

-- ── 3. CHECK constraint: defence-in-depth gate. ────────────────────
-- The handler validator (backend/internal/fields/handler.go) gives
-- the discoverable 400 error message; this constraint stops any path
-- that bypasses the handler (direct psql, raw SQL in a migration,
-- tests that seed via the artefacts pool directly).
ALTER TABLE artefacts_fields_library
  ADD CONSTRAINT artefacts_fields_library_field_name_c_prefix_check
    CHECK (artefacts_fields_library_field_name ~ '^c_artefacts_[a-z][a-z0-9_]*$');

COMMIT;
