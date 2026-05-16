-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 1 — DOWN
-- Migration 071 DOWN — remove Risk system artefact type
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f down/071_seed_risk_artefact_type_DOWN.sql
--
-- Soft-deletes the Risk artefacts_types row by setting archived_at.
-- Hard delete is unsafe — downstream tables (artefacts, flows, etc. created
-- by migrations 073-077) reference this row via FK ON DELETE RESTRICT.
--
-- Order: this DOWN must run AFTER 077_DOWN, 076_DOWN, 075_DOWN, 074_DOWN,
-- 073_DOWN, 072_DOWN. The migration runner applies DOWN files in reverse
-- order so this is automatic.
-- ============================================================

BEGIN;

UPDATE artefacts_types
   SET artefacts_types_archived_at = NOW()
 WHERE artefacts_types_prefix = 'RSK'
   AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
   AND artefacts_types_archived_at IS NULL;

COMMIT;
