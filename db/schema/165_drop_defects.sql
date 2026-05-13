-- MMFFDev - Vector: drop defects from mmff_vector
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- Dead table — drop rather than migrate. Justification:
--   • 0 rows on dev (verified pre-drop).
--   • 0 backend Go writers / readers (grep across backend/internal/**/*.go
--     finds only an unrelated `Defects int` JSON field on artefactitemsv2/types.go).
--   • 0 incoming FKs (no other table references defects).
--   • Outgoing FKs targeted dead/legacy tables (user_stories: 0 rows;
--     execution_item_types: 0 rows; subscriptions/users: live but defects
--     itself has no live consumers).
--   • Custom enum `defect_severity` is only used by this table and its
--     `idx_defects_severity` index — both drop with the table; the type
--     is then orphaned. Dropping it cleans up.
--
-- Future defect tracking, if revived, will use the artefact substrate
-- (artefact_types row for 'defect') on vector_artefacts — no schema
-- needs to be carried forward.

BEGIN;

DROP TABLE IF EXISTS defects;
DROP TYPE  IF EXISTS defect_severity;

COMMIT;
