-- ============================================================
-- MMFFDev - Vector: Drop the rigid theme_pack CHECK constraint.
-- Migration 042 — applied on top of 041_fix_subscription_layer_sort_order.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 042_theme_pack_drop_check.sql
--
-- The CHECK constraint added in 039 only allowed ('default', 'vector-mono').
-- The library has since grown to 42 themes, but every addition required a
-- migration + backend allow-list edit + frontend allow-list edit (three
-- places to keep in sync). The backend allow-list and frontend allow-list
-- are the authoritative gates; the DB CHECK adds no real safety, only
-- friction. Drop it. The column stays NOT NULL DEFAULT 'default' so a
-- bad write still cannot null the field — only the value space is freed.
-- ============================================================

BEGIN;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_theme_pack_check;

COMMIT;
