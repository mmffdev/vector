-- DOWN for db/schema/126_master_record_tenant.sql

DROP TRIGGER IF EXISTS trg_subscriptions_seed_master_record ON subscriptions;
DROP FUNCTION IF EXISTS fn_master_record_tenant_seed_for_subscription();

DROP TRIGGER IF EXISTS trg_master_record_tenant_touch_updated_at ON master_record_tenant;
DROP FUNCTION IF EXISTS fn_master_record_tenant_touch_updated_at();

DROP TABLE IF EXISTS master_record_tenant;
