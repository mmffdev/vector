-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 7 — DOWN
-- Migration 077 DOWN — soft-archive tenant Risk rows
-- ============================================================

BEGIN;

UPDATE artefacts_types
   SET artefacts_types_archived_at = NOW()
 WHERE artefacts_types_prefix = 'RSK'
   AND artefacts_types_source = 'tenant'
   AND artefacts_types_archived_at IS NULL;

COMMIT;
