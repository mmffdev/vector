-- ============================================================
-- 164_artefacts_flow_state_change_owner_core.sql
--
-- Promotes Flow State Change Owner from the custom-fields catalogue to
-- a first-class core column on artefacts, and archives the two catalogue
-- rows whose semantics are now fully provided by core columns.
--
-- WHY:
--   Rick's call (2026-05-30) on the two remaining CORE-CANDIDATE rows
--   deferred by the 2026-05-29 core-field demotion spec
--   (TD-CORE-CANDIDATE-FIELDS-PENDING-DESIGN):
--     1. flow_state_change_owner → promote to a real user-FK column,
--        assigned to ALL artefact types by default (universal — no
--        slot/scope gate). Mirrors the artefacts_id_user_submitted_by
--        pattern from mig 153.
--     2. strategic_investment_weight → the core column already exists
--        (mig 162, gated to scope='strategy' types via the slot trigger,
--        which IS the "assign to all strategic types" default). Only the
--        duplicate catalogue row remained active. Archive it.
--
--   Both catalogue rows are demoted to CORE: they leave the
--   artefacts_fields_library catalogue (soft-archive) because "core" in
--   this codebase means a column on artefacts, not a catalogue entry.
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS / ADD CONSTRAINT guarded by a catalog probe /
--   CREATE INDEX IF NOT EXISTS. The catalogue archive is WHERE
--   archived_at IS NULL, so re-running is a no-op (the SIW row was
--   already archived via the sole-writer API on 2026-05-30; this
--   migration is the reproducible source of truth for other envs).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/164_artefacts_flow_state_change_owner_core_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. Flow State Change Owner core column (universal user-FK) ────
-- uuid NULL, FK to users(users_id) ON DELETE SET NULL — mirrors
-- artefacts_id_user_submitted_by (mig 153). NO slot/scope gate: this
-- field is valid on every artefact type ("assign to all by default").
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_id_user_flow_state_change_owner uuid;

-- ADD CONSTRAINT has no IF NOT EXISTS; guard via catalog probe so the
-- migration stays re-runnable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'artefacts_id_user_flow_state_change_owner_fk'
    ) THEN
        ALTER TABLE artefacts
            ADD CONSTRAINT artefacts_id_user_flow_state_change_owner_fk
                FOREIGN KEY (artefacts_id_user_flow_state_change_owner)
                REFERENCES users (users_id)
                ON DELETE SET NULL;
    END IF;
END $$;

-- Partial index — supports "what did this user last change the flow
-- state on" queries. Mirrors idx_artefacts_id_user_submitted_by.
CREATE INDEX IF NOT EXISTS idx_artefacts_id_user_flow_state_change_owner
    ON artefacts (artefacts_id_user_flow_state_change_owner)
    WHERE artefacts_id_user_flow_state_change_owner IS NOT NULL
      AND artefacts_archived_at IS NULL;

-- ── 2. Archive the two demoted catalogue rows ────────────────────
-- Soft-archive only (project pattern — never hard-delete catalogue
-- rows). Idempotent on archived_at IS NULL.
--   c_artefacts_pi_flow_state_change_owner  → artefacts_id_user_flow_state_change_owner (this mig)
--   c_artefacts_pi_strategic_investment_weight → artefacts_strategic_investment_weight (mig 162)
UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = now(),
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND artefacts_fields_library_field_name IN (
       'c_artefacts_pi_flow_state_change_owner',
       'c_artefacts_pi_strategic_investment_weight'
   );

COMMIT;
