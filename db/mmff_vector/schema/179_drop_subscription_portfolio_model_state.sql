-- Drop subscription_portfolio_model_state from mmff_vector.
--
-- PLA-0023 cutover (SA3 complete 2026-05-13):
--   - 14 rows on mmff_vector at audit time, ALL archived (status=completed
--     or failed, archived_at IS NOT NULL). Test-run artefacts from today's
--     SA3 development; zero operational value.
--   - VA equivalent: vector_artefacts.artefact_adoption_state (mig 050,
--     created 2026-05-13 06:53 UTC).
--   - Go callers updated this commit:
--       * adopt.go state-row helpers: 6 functions had VAPool-vs-VectorPool
--         branches; all collapsed to VA-only. ErrVAUnavailable surfaced when
--         workspaceID is zero or VAPool is nil (orphan-sub fixture path
--         deprecated).
--       * dev_reset.go: resetAdoptionTables + masterResetVector legacy
--         block replaced with single DELETE FROM artefact_adoption_state
--         on VAPool.
--       * masterResetVA now clears artefact_adoption_state as step 0.
--
-- The GET adoption-state handler (adoption_state.go) already reads
-- exclusively from VA — never touched this table.
--
-- DOWN: db/schema/down/179_drop_subscription_portfolio_model_state_DOWN.sql
--       — recreates an empty table only; data not restorable.

BEGIN;

DROP TABLE IF EXISTS subscription_portfolio_model_state;

COMMIT;
