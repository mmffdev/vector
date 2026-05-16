-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 5 — DOWN
-- Migration 075 DOWN — drop Risk field bindings
-- ============================================================

BEGIN;

DELETE FROM artefacts_types_fields
 WHERE artefact_type_id = (
    SELECT artefacts_types_id FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL
 );

COMMIT;
