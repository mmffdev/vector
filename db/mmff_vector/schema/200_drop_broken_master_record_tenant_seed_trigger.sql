-- ============================================================
-- 200_drop_broken_master_record_tenant_seed_trigger.sql
--
-- PLA-0050 / Story 00568 — repair pre-existing bug.
--
-- fn_master_record_tenant_seed_for_subscription has been broken
-- since migration 173 dropped mmff_vector.master_record_tenant
-- (the legacy singular shadow table). The trigger still tries to
-- INSERT into that dropped table on every subscription INSERT —
-- any INSERT INTO subscriptions currently fails with
--   "relation master_record_tenant does not exist"
--
-- This migration drops the broken trigger + function. Seed
-- responsibility moves to the Go subscription-create path
-- (tenantmasterrecord.Service.SeedForSubscription, written in
-- Story 00569 and wired into call sites in Story 00570) — the
-- sole-writer pattern works across the mmff_vector → vector_artefacts
-- DB boundary that Postgres triggers cannot cross.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_subscriptions_seed_master_record ON subscriptions;
DROP FUNCTION IF EXISTS fn_master_record_tenant_seed_for_subscription();

COMMIT;
