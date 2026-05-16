-- RF1.4.2.master_record — pluralise portfolio + tenant tables.
-- master_record_workspaces → workspaces (cross-DB move) DEFERRED: blocked
-- by the legacy mmff_vector.workspace (singular) collision; resolve via
-- the scheduled drop of `workspace` first.
BEGIN;

-- ── 1. master_record_portfolio → master_record_portfolios + column-prefix ──
ALTER TABLE master_record_portfolio RENAME TO master_record_portfolios;

ALTER TABLE master_record_portfolios RENAME COLUMN workspace_id       TO master_record_portfolios_id_workspace;
ALTER TABLE master_record_portfolios RENAME COLUMN model_id           TO master_record_portfolios_id_library_portfolio_model;
ALTER TABLE master_record_portfolios RENAME COLUMN model_name         TO master_record_portfolios_model_name;
ALTER TABLE master_record_portfolios RENAME COLUMN model_description  TO master_record_portfolios_model_description;
ALTER TABLE master_record_portfolios RENAME COLUMN adopted_at         TO master_record_portfolios_adopted_at;
ALTER TABLE master_record_portfolios RENAME COLUMN adopted_by_user_id TO master_record_portfolios_id_user_adopter;
ALTER TABLE master_record_portfolios RENAME COLUMN created_at         TO master_record_portfolios_created_at;
ALTER TABLE master_record_portfolios RENAME COLUMN updated_at         TO master_record_portfolios_updated_at;
ALTER TABLE master_record_portfolios RENAME COLUMN archived_at        TO master_record_portfolios_archived_at;

ALTER INDEX idx_master_record_portfolio_archived_at RENAME TO master_record_portfolios_archived_at_idx;
ALTER INDEX idx_master_record_portfolio_model_id    RENAME TO master_record_portfolios_id_library_portfolio_model_idx;

CREATE OR REPLACE FUNCTION master_record_portfolios_touch_updated_at()
    RETURNS trigger AS $$
BEGIN
    NEW.master_record_portfolios_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_record_portfolio_touch_updated_at ON master_record_portfolios;
DROP FUNCTION IF EXISTS fn_master_record_portfolio_touch_updated_at();

CREATE TRIGGER trg_master_record_portfolios_touch_updated_at
    BEFORE UPDATE ON master_record_portfolios
    FOR EACH ROW EXECUTE FUNCTION master_record_portfolios_touch_updated_at();

-- ── 2. master_record_tenant → master_record_tenants (pluralise; columns
-- already carry `tenant_` prefix which carries the semantic load — full
-- column-prefix migration deferred to a follow-up TD entry).
ALTER TABLE master_record_tenant RENAME TO master_record_tenants;

COMMIT;
