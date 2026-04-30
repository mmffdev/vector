-- ============================================================
-- MMFFDev - mmff_library: Replace portfolio_models + children
-- with single portfolio_templates table (JSONB layers array).
--
-- Drops (dependency order):
--   portfolio_model_workflow_transitions
--   portfolio_model_workflows
--   portfolio_model_artifacts
--   portfolio_model_terminology
--   portfolio_model_shares
--   portfolio_model_layers
--   portfolio_models
--
-- Creates:
--   portfolio_templates  (id, name, description, layers JSONB,
--                         created_at, updated_at)
--
-- layers array: index 0 = top tier (strategy), last = leaf.
-- Seed data lives in db/library_schema/seed/004_portfolio_templates.sql
-- ============================================================

BEGIN;

-- Drop child tables first (FK dependency order)
DROP TABLE IF EXISTS portfolio_model_workflow_transitions CASCADE;
DROP TABLE IF EXISTS portfolio_model_workflows            CASCADE;
DROP TABLE IF EXISTS portfolio_model_artifacts            CASCADE;
DROP TABLE IF EXISTS portfolio_model_terminology          CASCADE;
DROP TABLE IF EXISTS portfolio_model_shares               CASCADE;
DROP TABLE IF EXISTS portfolio_model_layers               CASCADE;
DROP TABLE IF EXISTS portfolio_models                     CASCADE;

-- Create replacement table
CREATE TABLE portfolio_templates (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    layers      JSONB       NOT NULL CHECK (jsonb_typeof(layers) = 'array'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_portfolio_templates_updated_at
    BEFORE UPDATE ON portfolio_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
