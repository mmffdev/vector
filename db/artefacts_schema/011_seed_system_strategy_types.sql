-- ============================================================
-- MMFFDev - vector_artefacts: seed function for system strategy types
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 011_seed_system_strategy_types.sql
--
-- For the Phase 2 PoC: synthetically seed a 3-layer portfolio so the
-- v2 portfolio-model page has something to render. In production these
-- arrive via library adoption (strategy_layers_adopted) rather than a
-- system seed.
--
-- Seeds:
--   - Theme              (TH, layer_depth 0, parent_type_id NULL)
--   - Business Objective (BO, layer_depth 1, parent_type_id = Theme)
--   - Feature            (FE, layer_depth 2, parent_type_id = BO)
--
-- No flow attached - strategy artefacts in the PoC don't transition;
-- artefacts.flow_state_id is nullable.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_system_strategy_types(p_subscription_id UUID)
RETURNS VOID AS $$
DECLARE
    v_theme_id UUID;
    v_bo_id    UUID;
    v_fe_id    UUID;
BEGIN
    -- Idempotent: skip if any strategy type with prefix TH already exists.
    IF EXISTS (
        SELECT 1 FROM artefact_types
        WHERE subscription_id = p_subscription_id
          AND scope = 'strategy'
          AND prefix = 'TH'
          AND archived_at IS NULL
    ) THEN
        RETURN;
    END IF;

    INSERT INTO artefact_types (
        subscription_id, scope, source, name, prefix,
        parent_type_id, layer_depth, sort_order
    )
    VALUES (
        p_subscription_id, 'strategy', 'system', 'Theme', 'TH',
        NULL, 0, 10
    )
    RETURNING id INTO v_theme_id;

    INSERT INTO artefact_types (
        subscription_id, scope, source, name, prefix,
        parent_type_id, layer_depth, sort_order
    )
    VALUES (
        p_subscription_id, 'strategy', 'system', 'Business Objective', 'BO',
        v_theme_id, 1, 20
    )
    RETURNING id INTO v_bo_id;

    INSERT INTO artefact_types (
        subscription_id, scope, source, name, prefix,
        parent_type_id, layer_depth, sort_order
    )
    VALUES (
        p_subscription_id, 'strategy', 'system', 'Feature', 'FE',
        v_bo_id, 2, 30
    )
    RETURNING id INTO v_fe_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_system_strategy_types(UUID) IS
    'Phase 2 PoC seed: a synthetic 3-layer portfolio (Theme > Business Objective '
    '> Feature) for the given subscription. Production strategy types come from '
    'library adoption via strategy_layers_adopted.';

-- Run the seed for the PoC subscription right now so the page has data on first load.
SELECT seed_system_strategy_types('00000000-0000-0000-0000-000000000001'::uuid);

COMMIT;
