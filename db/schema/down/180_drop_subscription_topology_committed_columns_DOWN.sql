-- DOWN for mmff_vector/180_drop_subscription_topology_committed_columns.sql
-- Re-adds the two columns. Data is NOT restored — recover from backup if needed.
--
-- Pair with vector_artefacts/down/053 to fully revert the cutover.

BEGIN;

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS topology_committed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS topology_committed_by  UUID REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
