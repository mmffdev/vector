-- ============================================================
-- 108_fix_artefacts_triggers_RF1_5_7_DOWN.sql
--
-- Reverses 108_fix_artefacts_triggers_RF1_5_7.sql.
-- Must be applied BEFORE 107 DOWN.
--
-- This DOWN takes a teardown-only approach: it drops the new
-- per-table function + both triggers, and DOES NOT attempt to
-- re-create the bare-column pre-107 versions. The reason: the
-- bare-column trigger binding references `UPDATE OF title,
-- description` — columns that don't exist yet at this point
-- (107 DOWN hasn't reversed the rename). Re-creating the
-- pre-RF1.5.7 triggers is therefore a finalize step inside
-- 107 DOWN (which DOES restore bare columns) — see the tail of
-- 107 DOWN for the restoration block.
-- ============================================================

BEGIN;

-- Drop the new per-table triggers + functions installed by 108 UP.
DROP TRIGGER IF EXISTS artefacts_set_updated_at ON artefacts;
DROP TRIGGER IF EXISTS artefacts_search_enqueue ON artefacts;

DROP FUNCTION IF EXISTS artefacts_set_updated_at();
-- artefacts_search_enqueue() is NOT dropped here — 107 DOWN's
-- finalize block re-CREATEs OR REPLACEs it with the bare-column
-- body. We keep the function shell so the re-create is idempotent.

COMMIT;
