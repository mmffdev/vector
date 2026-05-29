-- ============================================================
-- 158_artefacts_slot_gate_trigger_DOWN.sql
--
-- Reverses 158 — drops the trigger and the function.
-- ============================================================

BEGIN;
DROP TRIGGER IF EXISTS trg_artefacts_slot_gate_aiu ON artefacts;
DROP FUNCTION IF EXISTS trg_artefacts_slot_gate_aiu_fn();
COMMIT;
