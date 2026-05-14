-- ============================================================
-- MMFFDev - Vector: Subscription tier column (Phase 0 / TD-LIB-002)
-- Migration 018 — applied on top of 017_subscriptions_rename.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 018_subscription_tier.sql
--
-- Adds subscriptions.tier so the library reconciler can decide
-- which mmff_library presets a subscription is entitled to read.
-- Default 'pro' so existing rows backfill safely; the entitlements
-- service will narrow this once the billing layer ships.
-- ============================================================

BEGIN;

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'pro';

ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_tier_check
    CHECK (tier IN ('free','pro','enterprise'));

COMMENT ON COLUMN subscriptions.tier IS
    'Entitlement tier for mmff_library access. Values: free, pro, enterprise. '
    'Default pro for backfilled rows; billing service will set this going forward.';

COMMIT;
