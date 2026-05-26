-- ============================================================
-- 253_page_entity_refs_column_prefix_RF1_5_1.sql
--
-- RF1.5.1 — Pillar 1 wave 1, table 3/5.
--
-- Applies the §2.3 column-prefix convention to page_entity_refs.
--
-- Note: the PK on this table is the FK column itself (PRIMARY KEY
-- (page_id) — one row per page max). The FK rename per §2.4
-- (`page_id` → `page_entity_refs_id_page`) takes priority; the PK
-- constraint stays attached by Postgres rename semantics. There is
-- no separate `<table>_id` PK column here.
--
-- entity_kind + entity_id are the polymorphic-FK pair per §2.4
-- ("Polymorphic FKs"); they get plain prefix only (no `_id_<target>`
-- shape because there is no single target).
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE page_entity_refs RENAME COLUMN page_id     TO page_entity_refs_id_page;
ALTER TABLE page_entity_refs RENAME COLUMN entity_kind TO page_entity_refs_entity_kind;
ALTER TABLE page_entity_refs RENAME COLUMN entity_id   TO page_entity_refs_entity_id;

-- ---- Index renames ----

ALTER INDEX idx_page_entity_refs_lookup                RENAME TO idx_page_entity_refs_entity_kind_entity_id;
ALTER INDEX page_entity_refs_entity_kind_entity_id_key RENAME TO page_entity_refs_entity_kind_entity_id_unique;

-- ---- Constraint renames ----

ALTER TABLE page_entity_refs
    RENAME CONSTRAINT page_entity_refs_page_id_fkey
                  TO page_entity_refs_id_page_fkey;

-- page_entity_refs_entity_kind_check + page_entity_refs_pkey already
-- carry the table prefix — left untouched.

COMMIT;
