-- ============================================================
-- 155_artefacts_estimate_initial_to_bucket_DOWN.sql
--
-- Reverses 155 — best-effort TYPE reversal.
--
-- DESTRUCTIVE: ALTER COLUMN TYPE can't be cleanly reversed.
-- Bucket-name values (xs/s/m/l/xl/xxl) cannot be coerced back to
-- NUMERIC. Any bucket-name values present at DOWN time are set
-- to NULL on reversal (USING NULL::numeric). The sidecar bucket-
-- value column is also dropped.
-- ============================================================

BEGIN;

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_estimate_initial_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_estimate_initial_value_nonneg_chk;

ALTER TABLE artefacts
    ALTER COLUMN artefacts_estimate_initial TYPE numeric
        USING (NULL::numeric);

ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_estimate_initial_value;

COMMIT;
