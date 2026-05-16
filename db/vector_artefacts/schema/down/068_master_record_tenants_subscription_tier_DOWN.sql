-- ============================================================
-- 068_master_record_tenants_subscription_tier_DOWN.sql
--
-- Rollback for 068. Drops the new master_record_tenants table,
-- the trigger function, and the fdw_subscriptions FDW shadow.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_master_record_tenants_touch_updated_at ON master_record_tenants;
DROP TABLE IF EXISTS master_record_tenants;
DROP FUNCTION IF EXISTS fn_master_record_tenants_touch_updated_at();
DROP FOREIGN TABLE IF EXISTS fdw_subscriptions;

COMMIT;
