-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 6 — DOWN
-- Migration 076 DOWN — drop Risk number sequence row
-- DESTRUCTIVE: deleting this loses the current next_num counter. If any RSK
-- artefacts exist, they keep their numbers but new ones will restart from 1
-- if the row is re-seeded. Generally safe in dev; revisit before prod.
-- ============================================================

BEGIN;

DELETE FROM artefacts_number_sequences
 WHERE artefact_type_id = (
    SELECT artefacts_types_id FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL
 );

COMMIT;
