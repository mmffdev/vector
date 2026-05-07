-- ============================================================
-- PLA-0023 / 00462 — invoke seed_system_artefact_types for the dev tenant.
--
-- 010_seed_system_artefact_types.sql was applied to vector_artefacts before
-- the self-invoke line was added (PLA-0023 story 00462). This migration
-- runs the invocation as a catch-up for the dev instance.
-- For any fresh install the self-invoke in 010 fires first, making this a
-- guaranteed no-op (the function is idempotent: it skips existing prefixes).
-- ============================================================

BEGIN;
SELECT seed_system_artefact_types('00000000-0000-0000-0000-000000000001'::uuid);
COMMIT;
