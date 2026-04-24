-- ============================================================
-- MMFFDev - mmff_library: Portfolio model shares (Phase 1)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 004_portfolio_model_shares.sql
--
-- Plan §6.7. Composite PK is (model_id, grantee_subscription_id).
-- grantee_subscription_id and granted_by_user_id are app-enforced FKs
-- to mmff_vector — Postgres can't enforce cross-DB RI.
-- ============================================================

BEGIN;

CREATE TABLE portfolio_model_shares (
    model_id                UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    grantee_subscription_id UUID        NOT NULL,                        -- app-enforced FK to mmff_vector.subscriptions
    granted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by_user_id      UUID        NOT NULL,                        -- app-enforced FK to mmff_vector.users
    revoked_at              TIMESTAMPTZ,
    revoked_by_user_id      UUID,
    PRIMARY KEY (model_id, grantee_subscription_id)
);

CREATE INDEX idx_portfolio_model_shares_grantee
    ON portfolio_model_shares (grantee_subscription_id)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE portfolio_model_shares IS
    'Per-subscription share grants for portfolio models. grantee_subscription_id and '
    'granted_by_user_id are app-enforced FKs into mmff_vector (no cross-DB RI in Postgres).';

COMMIT;
