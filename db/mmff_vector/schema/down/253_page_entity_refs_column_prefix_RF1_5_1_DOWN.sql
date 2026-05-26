-- ============================================================
-- 253_page_entity_refs_column_prefix_RF1_5_1_DOWN.sql
--
-- Reverses 253_page_entity_refs_column_prefix_RF1_5_1.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE page_entity_refs
    RENAME CONSTRAINT page_entity_refs_id_page_fkey
                  TO page_entity_refs_page_id_fkey;

-- ---- Index renames (reverse) ----

ALTER INDEX page_entity_refs_entity_kind_entity_id_unique RENAME TO page_entity_refs_entity_kind_entity_id_key;
ALTER INDEX idx_page_entity_refs_entity_kind_entity_id    RENAME TO idx_page_entity_refs_lookup;

-- ---- Column renames (reverse) ----

ALTER TABLE page_entity_refs RENAME COLUMN page_entity_refs_entity_id   TO entity_id;
ALTER TABLE page_entity_refs RENAME COLUMN page_entity_refs_entity_kind TO entity_kind;
ALTER TABLE page_entity_refs RENAME COLUMN page_entity_refs_id_page     TO page_id;

COMMIT;
