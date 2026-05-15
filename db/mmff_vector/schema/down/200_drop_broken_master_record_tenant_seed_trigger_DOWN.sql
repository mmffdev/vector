-- ============================================================
-- 200_drop_broken_master_record_tenant_seed_trigger_DOWN.sql
--
-- Rollback for 200. Re-creates the trigger function pointing at
-- the legacy mmff_vector.master_record_tenant table — which means
-- if you actually need this rollback, you'd need to re-create
-- that table too. Useful primarily for migration runner round-trip
-- testing; not for live recovery.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_master_record_tenant_seed_for_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO master_record_tenant (tenant_id, tenant_name)
        VALUES (NEW.id, COALESCE(NEW.name, 'New workspace'))
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscriptions_seed_master_record
    AFTER INSERT ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenant_seed_for_subscription();

COMMIT;
