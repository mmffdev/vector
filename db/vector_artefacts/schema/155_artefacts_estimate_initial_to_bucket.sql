-- ============================================================
-- 155_artefacts_estimate_initial_to_bucket.sql
--
-- Decision B — ALTER artefacts_estimate_initial from NUMERIC to
-- TEXT (bucket name) + add artefacts_estimate_initial_value
-- INTEGER alongside. Mig 147 shipped _estimate_initial as NUMERIC
-- (zero rows populated — verified pre-flight); this rewires it
-- to Rally's two-field model: named bucket (UI dropdown) + numeric
-- value-per-bucket (projection layer).
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.6
--
-- ALTER COLUMN TYPE caveat: the DOWN reverses TYPE → NUMERIC but
-- cannot meaningfully coerce bucket-name TEXT back to NUMERIC.
-- Bucket values are dropped (set NULL) on reversal. Documented in
-- the DOWN script.
--
-- Pre-flight check (done by subagent):
--     SELECT COUNT(*) FROM artefacts
--      WHERE artefacts_estimate_initial IS NOT NULL;
-- → expected 0. If non-zero, ABORT (bucket values lose meaning).
--
-- ROLLBACK: db/vector_artefacts/schema/down/155_artefacts_estimate_initial_to_bucket_DOWN.sql
-- ============================================================

BEGIN;

-- Step 1: ALTER TYPE. USING NULL because there's no meaningful
-- NUMERIC → bucket-name mapping (and zero rows populated).
ALTER TABLE artefacts
    ALTER COLUMN artefacts_estimate_initial TYPE text
        USING (NULL::text);

-- Step 2: add bucket-value sidecar column.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_estimate_initial_value integer;

-- Step 3: CHECK on bucket name vocab.
ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_estimate_initial_chk
        CHECK (artefacts_estimate_initial IS NULL
            OR artefacts_estimate_initial = ANY (ARRAY['xs','s','m','l','xl','xxl']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_estimate_initial_value_nonneg_chk
        CHECK (artefacts_estimate_initial_value IS NULL
            OR artefacts_estimate_initial_value >= 0);

COMMIT;
