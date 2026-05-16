-- ============================================================
-- MMFFDev - vector_artefacts: TD-SEED-FN-DRIFT pay-down — DOWN
-- Migration 078 DOWN — restore seed_system_artefact_types() stub
--
-- Restores the function as a no-op stub (RAISE NOTICE only). The original
-- body referenced pre-RF1.4.4 column names that no longer exist; restoring
-- it verbatim would just re-create the broken function. The stub lets any
-- legacy caller that hardcodes `SELECT seed_system_artefact_types(uuid)`
-- complete without error — it does nothing, which matches the function's
-- effective behaviour pre-DROP (it would have errored on its first DB write).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_system_artefact_types(p_subscription_id UUID)
RETURNS VOID AS $$
BEGIN
    RAISE NOTICE 'seed_system_artefact_types is a no-op stub restored by migration 078 DOWN. To seed system artefact types now, follow the direct-INSERT pattern in migration 071.';
END;
$$ LANGUAGE plpgsql;

COMMIT;
