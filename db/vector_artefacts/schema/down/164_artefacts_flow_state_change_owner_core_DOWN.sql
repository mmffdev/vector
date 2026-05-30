-- ============================================================
-- 164_artefacts_flow_state_change_owner_core_DOWN.sql
--
-- Reverses 164 — drops the FSCO index, FK, and column, and
-- un-archives the two demoted catalogue rows (restores their
-- pre-164 active state).
--
-- NOTE: this un-archives c_artefacts_pi_strategic_investment_weight
-- even though it was first archived via the sole-writer API on
-- 2026-05-30 rather than by mig 164. That is the correct DOWN
-- behaviour: it returns the catalogue to its pre-164 active state.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_artefacts_id_user_flow_state_change_owner;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_id_user_flow_state_change_owner_fk;
ALTER TABLE artefacts DROP COLUMN IF EXISTS artefacts_id_user_flow_state_change_owner;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = NULL,
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_field_name IN (
       'c_artefacts_pi_flow_state_change_owner',
       'c_artefacts_pi_strategic_investment_weight'
   );

COMMIT;
