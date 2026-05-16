-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 3 — DOWN
-- Migration 073 DOWN — soft-archive Risk Flow + cascade states/transitions
-- ============================================================

BEGIN;

UPDATE flows
   SET flows_archived_at = NOW()
 WHERE flows_name = 'Risk Flow'
   AND flows_id_artefact_type = (
        SELECT artefacts_types_id FROM artefacts_types
         WHERE artefacts_types_prefix = 'RSK'
           AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
           AND artefacts_types_archived_at IS NULL
   )
   AND flows_archived_at IS NULL;

UPDATE flows_states
   SET flows_states_archived_at = NOW()
 WHERE flows_states_id_flow IN (
        SELECT flows_id FROM flows
         WHERE flows_name = 'Risk Flow'
           AND flows_archived_at IS NOT NULL
   )
   AND flows_states_archived_at IS NULL;

-- Transitions have no archived_at column; hard delete is safe since they
-- reference only states within the now-archived flow.
DELETE FROM flows_transitions
 WHERE flows_transitions_id_flow IN (
    SELECT flows_id FROM flows
     WHERE flows_name = 'Risk Flow'
       AND flows_archived_at IS NOT NULL
 );

COMMIT;
