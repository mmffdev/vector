-- ============================================================
-- DOWN for 052_seed_dev_strategy_artefacts.sql
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f down/052_seed_dev_strategy_artefacts_DOWN.sql
--
-- Deletes the 25 seeded strategy artefacts for the default dev tenant
-- (rows with number BETWEEN 1 AND 5 for the five strategy types) and
-- drops the seed function. Reset of artefact_number_sequence is best-effort
-- — UI-created items will still allocate from the bumped value, which is
-- forward-safe.
-- ============================================================

BEGIN;

-- Delete the seeded artefacts. Surgical on (subscription_id, type, number)
-- so we don't touch any items a user has created above number 5.
DELETE FROM artefacts a
USING artefact_types at
WHERE at.id = a.artefact_type_id
  AND a.subscription_id = '00000000-0000-0000-0000-000000000001'
  AND at.scope = 'strategy'
  AND at.name IN ('Theme', 'Business Objective', 'Feature', 'Product', 'Portfolio Runway')
  AND a.number BETWEEN 1 AND 5;

DROP FUNCTION IF EXISTS seed_dev_strategy_artefacts(UUID, UUID);

COMMIT;
