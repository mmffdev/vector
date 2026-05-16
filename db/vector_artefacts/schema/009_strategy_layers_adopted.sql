-- ============================================================
-- MMFFDev - vector_artefacts: strategy_layers_adopted
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 009_strategy_layers_adopted.sql
--
-- A subscription adopts a portfolio model from mmff_library. That model
-- defines an ordered set of strategy LAYERS (e.g. Theme > Business
-- Objective > Feature). Adoption copies those layers into this table so
-- they can be referenced by FK from artefact_types (an adopted layer
-- materialises as one row in artefact_types with scope='strategy').
--
-- This is the same pattern used by mmff_vector.subscription_layers - a
-- local mirror that lets us keep hard FKs intra-DB while the upstream
-- library lives in another database.
--
-- The FK relationship:
--   artefact_types.parent_type_id walks the hierarchy WITHIN a subscription.
--   strategy_layers_adopted exists for traceability back to mmff_library
--   (audit, "what library version produced this layer").
-- ============================================================

BEGIN;

CREATE TABLE strategy_layers_adopted (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Soft FK -> mmff_vector.subscriptions(id). App enforced.
    subscription_id     UUID NOT NULL,

    -- Soft FK -> mmff_library.portfolio_model_layers(id). App enforced.
    -- Records which library row produced this layer (lineage / audit).
    library_layer_id    UUID,

    -- Hard FK -> the artefact_type row this adoption created.
    artefact_type_id    UUID NOT NULL REFERENCES artefact_types(id) ON DELETE CASCADE,

    -- Snapshot of library metadata at adoption time. Reading mmff_library
    -- is not viable from this DB, so we copy what the UI needs.
    library_layer_name  TEXT NOT NULL,                  -- 'Feature'
    library_layer_tag   TEXT NOT NULL,                  -- 'FE'
    library_depth       INTEGER NOT NULL,               -- 0..9

    adopted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A library layer is adopted at most once per subscription.
CREATE UNIQUE INDEX strategy_layers_adopted_unique_per_sub
    ON strategy_layers_adopted (subscription_id, library_layer_id)
    WHERE library_layer_id IS NOT NULL;

CREATE INDEX strategy_layers_adopted_by_type
    ON strategy_layers_adopted (artefact_type_id);

COMMENT ON TABLE strategy_layers_adopted IS
    'Per-subscription record of which mmff_library portfolio-model layers '
    'have been adopted. Each adoption materialises one artefact_types row '
    '(scope=''strategy'') that the app inserts here for lineage. Mirrors '
    'the mmff_vector.subscription_layers <-> mmff_library bridge pattern.';

COMMIT;
