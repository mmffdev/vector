-- ============================================================
-- MMFFDev - vector_artefacts: M5 (PLA-0026 / story 00480)
-- master_record_portfolio — one row per workspace holding the persistent
-- portfolio model record (model identity + adoption metadata).
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 020_master_record_portfolio.sql
--
-- Per R047 §6: this table holds the *persistent* portfolio model record
-- (model identity, prose, adoption metadata) only. Workspace identity
-- (name, description, owner) lives in mmff_vector.workspaces and is NOT
-- duplicated here — that table is sanitised in a deliberate later cutover
-- (PLA-0026 S-series, deferred 7+ days post-cutover).
--
-- Why a separate table from artefact_types:
--   - artefact_types are the layer-shape rows (one per layer per workspace).
--     A portfolio model has a name, description, adopted_at, and adopted_by
--     that are facts about the *model*, not about any single layer.
--   - Mirrors master_record_tenant (workspace settings) for symmetry — both
--     are "one row per workspace, model-level metadata".
--   - Survives library deletion: model_name + model_description are *copied*
--     from mmff_library.portfolio_templates at adoption time (R047 §6).
--
-- Cross-DB references:
--   workspace_id  → mmff_vector.workspaces.id (PRIMARY KEY)
--   model_id      → mmff_library.portfolio_templates.id (NULL for tenant-
--                   built models that never came from a library template)
--   adopted_by_user_id → mmff_vector.users.id (soft FK)
--
-- Trigger trg_master_record_portfolio_touch_updated_at mirrors the pattern
-- in master_record_tenant (db/schema/126).
--
-- No auto-seed trigger here. Workspaces are created in mmff_vector
-- (different DB) and the saga (B-series) is responsible for inserting the
-- master_record_portfolio row at adoption time. Pre-adoption workspaces
-- simply have no row, which is the correct semantics: "no portfolio model
-- adopted".
-- ============================================================

BEGIN;

CREATE TABLE master_record_portfolio (
    -- One row per workspace. Cross-DB soft FK to mmff_vector.workspaces.id;
    -- canary test PLA-0026 T6 substitutes for the FK.
    workspace_id          UUID PRIMARY KEY,

    -- Cross-DB soft FK to mmff_library.portfolio_templates.id.
    -- NULL for tenant-built models that never came from a library template.
    model_id              UUID,

    -- Copied from mmff_library at adoption — survives library row deletion.
    model_name            TEXT NOT NULL,
    model_description     TEXT,

    -- Adoption metadata.
    adopted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    adopted_by_user_id    UUID,  -- soft FK to mmff_vector.users.id

    -- Audit.
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at           TIMESTAMPTZ
);

CREATE INDEX idx_master_record_portfolio_archived_at
    ON master_record_portfolio (archived_at);
CREATE INDEX idx_master_record_portfolio_model_id
    ON master_record_portfolio (model_id);

-- Touch updated_at on every UPDATE. Mirrors the pattern in
-- master_record_tenant (db/schema/126).
CREATE OR REPLACE FUNCTION fn_master_record_portfolio_touch_updated_at()
    RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_master_record_portfolio_touch_updated_at
    BEFORE UPDATE ON master_record_portfolio
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_portfolio_touch_updated_at();

COMMENT ON TABLE master_record_portfolio IS
    'One row per workspace. Persistent portfolio model record (model '
    'identity + adoption metadata). Workspace identity remains in '
    'mmff_vector.workspaces. Inserted by the adoption saga at adoption time '
    '— absence means no model adopted.';
COMMENT ON COLUMN master_record_portfolio.workspace_id IS
    'Cross-DB reference to mmff_vector.workspaces.id (app-enforced; canary '
    'test PLA-0026 T6 stands in for the FK).';
COMMENT ON COLUMN master_record_portfolio.model_id IS
    'Cross-DB reference to mmff_library.portfolio_templates.id. NULL for '
    'tenant-built models with no library template origin.';
COMMENT ON COLUMN master_record_portfolio.model_name IS
    'Copied from the library template at adoption — survives library deletion.';
COMMENT ON COLUMN master_record_portfolio.model_description IS
    'Prose copied from the library template at adoption — replaces the '
    'live read against mmff_library that the legacy saga depended on.';

COMMIT;
