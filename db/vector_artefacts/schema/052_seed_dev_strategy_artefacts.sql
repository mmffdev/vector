-- ============================================================
-- MMFFDev - vector_artefacts: seed function for dev strategy artefacts
--
-- Why: The strategy `artefact_types` survive MasterReset (re-seeded by
-- adoption) but `artefacts` with scope='strategy' do not. After a reset
-- /portfolio-items/list renders empty until items are hand-created.
--
-- This migration installs `seed_dev_strategy_artefacts(subscription_id,
-- workspace_id)` and invokes it once for the default tenant so the page
-- has data on first load. `MasterReset()` calls the same function after
-- wiping so dev pages never end up empty.
--
-- Seed layout (25 items per tenant, two trees):
--
--   Theme (5)
--     └─ Business Objective (5)            parent = round-robin Theme
--          └─ Feature (5)                  parent = round-robin BO
--   Product (5)
--     └─ Portfolio Runway (5)              parent = round-robin Product
--
-- Idempotency: the unique index
--   artefacts_number_unique_per_type (subscription_id, artefact_type_id, number)
-- gives natural deduplication — we INSERT … ON CONFLICT DO NOTHING using
-- deterministic number values (1..5 per type). Re-running the function is
-- a no-op; the DOWN migration deletes by the same (subscription_id, type, number)
-- triple, also surgical.
--
-- Cross-tenant safety: function takes subscription_id as a parameter and
-- only touches that tenant's rows. Default tenant in dev is
-- 00000000-0000-0000-0000-000000000001 (dev workspace is …000010).
--
-- DOWN: db/artefacts_schema/down/052_seed_dev_strategy_artefacts.down.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_dev_strategy_artefacts(
    p_subscription_id UUID,
    p_workspace_id    UUID
) RETURNS VOID AS $$
DECLARE
    v_theme_type_id   UUID;
    v_bo_type_id      UUID;
    v_feature_type_id UUID;
    v_product_type_id UUID;
    v_runway_type_id  UUID;

    v_theme_state_id   UUID;
    v_bo_state_id      UUID;
    v_feature_state_id UUID;
    v_product_state_id UUID;
    v_runway_state_id  UUID;

    -- arrays for parent lookups
    v_theme_ids   UUID[];
    v_product_ids UUID[];
    v_bo_ids      UUID[];

    -- placeholder titles per layer
    v_theme_titles   TEXT[] := ARRAY[
        'Customer Trust',
        'Operational Excellence',
        'Market Expansion',
        'Product Innovation',
        'Platform Resilience'
    ];
    v_bo_titles      TEXT[] := ARRAY[
        'Lift NPS by 10 points',
        'Reduce mean-time-to-recover by 50%',
        'Enter two new EMEA markets',
        'Ship the AI-assist suite',
        'Eliminate top-3 outage causes'
    ];
    v_feature_titles TEXT[] := ARRAY[
        'In-product feedback widget',
        'Realtime incident timeline',
        'Multilingual onboarding flow',
        'Smart-compose for portfolio notes',
        'Auto-scaling read replicas'
    ];
    v_product_titles TEXT[] := ARRAY[
        'Vector Core',
        'Vector Insights',
        'Vector Connect',
        'Vector Admin',
        'Vector Field'
    ];
    v_runway_titles  TEXT[] := ARRAY[
        'Q1 — Foundations',
        'Q2 — Differentiation',
        'Q3 — Scale',
        'Q4 — Hardening',
        'FY+1 — Vision'
    ];

    i INT;
BEGIN
    -- ----- Resolve the five strategy artefact_type ids by name --------------
    -- Idempotency at the type lookup level: if any of these types are missing,
    -- the function silently returns. Re-running after the types are seeded
    -- will pick them up.
    SELECT id INTO v_theme_type_id   FROM artefact_types
      WHERE subscription_id = p_subscription_id AND scope = 'strategy'
        AND name = 'Theme' AND archived_at IS NULL LIMIT 1;
    SELECT id INTO v_bo_type_id      FROM artefact_types
      WHERE subscription_id = p_subscription_id AND scope = 'strategy'
        AND name = 'Business Objective' AND archived_at IS NULL LIMIT 1;
    SELECT id INTO v_feature_type_id FROM artefact_types
      WHERE subscription_id = p_subscription_id AND scope = 'strategy'
        AND name = 'Feature' AND archived_at IS NULL LIMIT 1;
    SELECT id INTO v_product_type_id FROM artefact_types
      WHERE subscription_id = p_subscription_id AND scope = 'strategy'
        AND name = 'Product' AND archived_at IS NULL LIMIT 1;
    SELECT id INTO v_runway_type_id  FROM artefact_types
      WHERE subscription_id = p_subscription_id AND scope = 'strategy'
        AND name = 'Portfolio Runway' AND archived_at IS NULL LIMIT 1;

    IF v_theme_type_id IS NULL OR v_bo_type_id IS NULL
       OR v_feature_type_id IS NULL OR v_product_type_id IS NULL
       OR v_runway_type_id IS NULL THEN
        RAISE NOTICE 'seed_dev_strategy_artefacts: one or more strategy types not found for subscription %, skipping seed', p_subscription_id;
        RETURN;
    END IF;

    -- ----- Resolve the initial flow_state per type --------------------------
    SELECT fs.id INTO v_theme_state_id
      FROM flow_states fs JOIN flows f ON f.id = fs.flow_id
      WHERE f.artefact_type_id = v_theme_type_id
        AND f.is_default = TRUE  AND f.archived_at  IS NULL
        AND fs.is_initial = TRUE AND fs.archived_at IS NULL
      LIMIT 1;
    SELECT fs.id INTO v_bo_state_id
      FROM flow_states fs JOIN flows f ON f.id = fs.flow_id
      WHERE f.artefact_type_id = v_bo_type_id
        AND f.is_default = TRUE  AND f.archived_at  IS NULL
        AND fs.is_initial = TRUE AND fs.archived_at IS NULL
      LIMIT 1;
    SELECT fs.id INTO v_feature_state_id
      FROM flow_states fs JOIN flows f ON f.id = fs.flow_id
      WHERE f.artefact_type_id = v_feature_type_id
        AND f.is_default = TRUE  AND f.archived_at  IS NULL
        AND fs.is_initial = TRUE AND fs.archived_at IS NULL
      LIMIT 1;
    SELECT fs.id INTO v_product_state_id
      FROM flow_states fs JOIN flows f ON f.id = fs.flow_id
      WHERE f.artefact_type_id = v_product_type_id
        AND f.is_default = TRUE  AND f.archived_at  IS NULL
        AND fs.is_initial = TRUE AND fs.archived_at IS NULL
      LIMIT 1;
    SELECT fs.id INTO v_runway_state_id
      FROM flow_states fs JOIN flows f ON f.id = fs.flow_id
      WHERE f.artefact_type_id = v_runway_type_id
        AND f.is_default = TRUE  AND f.archived_at  IS NULL
        AND fs.is_initial = TRUE AND fs.archived_at IS NULL
      LIMIT 1;

    -- ----- Layer 1: Themes (5 roots, no parent) -----------------------------
    FOR i IN 1..5 LOOP
        INSERT INTO artefacts (
            subscription_id, workspace_id, artefact_type_id,
            number, title, flow_state_id, position
        ) VALUES (
            p_subscription_id, p_workspace_id, v_theme_type_id,
            i, v_theme_titles[i], v_theme_state_id, 0
        )
        ON CONFLICT (subscription_id, artefact_type_id, number) DO NOTHING;
    END LOOP;

    -- Collect theme ids for BO parent linkage (preserve number 1..5 order).
    SELECT array_agg(id ORDER BY number)
      INTO v_theme_ids
      FROM artefacts
      WHERE subscription_id = p_subscription_id
        AND artefact_type_id = v_theme_type_id
        AND number BETWEEN 1 AND 5;

    -- ----- Layer 2: Business Objectives (parent = round-robin Theme) --------
    FOR i IN 1..5 LOOP
        INSERT INTO artefacts (
            subscription_id, workspace_id, artefact_type_id,
            number, title, flow_state_id, parent_artefact_id, position
        ) VALUES (
            p_subscription_id, p_workspace_id, v_bo_type_id,
            i, v_bo_titles[i], v_bo_state_id,
            v_theme_ids[((i - 1) % array_length(v_theme_ids, 1)) + 1],
            0
        )
        ON CONFLICT (subscription_id, artefact_type_id, number) DO NOTHING;
    END LOOP;

    SELECT array_agg(id ORDER BY number)
      INTO v_bo_ids
      FROM artefacts
      WHERE subscription_id = p_subscription_id
        AND artefact_type_id = v_bo_type_id
        AND number BETWEEN 1 AND 5;

    -- ----- Layer 3: Features (parent = round-robin BO) ----------------------
    FOR i IN 1..5 LOOP
        INSERT INTO artefacts (
            subscription_id, workspace_id, artefact_type_id,
            number, title, flow_state_id, parent_artefact_id, position
        ) VALUES (
            p_subscription_id, p_workspace_id, v_feature_type_id,
            i, v_feature_titles[i], v_feature_state_id,
            v_bo_ids[((i - 1) % array_length(v_bo_ids, 1)) + 1],
            0
        )
        ON CONFLICT (subscription_id, artefact_type_id, number) DO NOTHING;
    END LOOP;

    -- ----- Layer 1b: Products (5 roots, separate tree) ----------------------
    FOR i IN 1..5 LOOP
        INSERT INTO artefacts (
            subscription_id, workspace_id, artefact_type_id,
            number, title, flow_state_id, position
        ) VALUES (
            p_subscription_id, p_workspace_id, v_product_type_id,
            i, v_product_titles[i], v_product_state_id, 0
        )
        ON CONFLICT (subscription_id, artefact_type_id, number) DO NOTHING;
    END LOOP;

    SELECT array_agg(id ORDER BY number)
      INTO v_product_ids
      FROM artefacts
      WHERE subscription_id = p_subscription_id
        AND artefact_type_id = v_product_type_id
        AND number BETWEEN 1 AND 5;

    -- ----- Layer 2b: Portfolio Runway (parent = round-robin Product) --------
    FOR i IN 1..5 LOOP
        INSERT INTO artefacts (
            subscription_id, workspace_id, artefact_type_id,
            number, title, flow_state_id, parent_artefact_id, position
        ) VALUES (
            p_subscription_id, p_workspace_id, v_runway_type_id,
            i, v_runway_titles[i], v_runway_state_id,
            v_product_ids[((i - 1) % array_length(v_product_ids, 1)) + 1],
            0
        )
        ON CONFLICT (subscription_id, artefact_type_id, number) DO NOTHING;
    END LOOP;

    -- ----- Bump artefact_number_sequence so UI-created items start at 6 -----
    -- Without this, the next UI Create would collide on number=1.
    INSERT INTO artefact_number_sequence (subscription_id, artefact_type_id, next_num) VALUES
      (p_subscription_id, v_theme_type_id,   6),
      (p_subscription_id, v_bo_type_id,      6),
      (p_subscription_id, v_feature_type_id, 6),
      (p_subscription_id, v_product_type_id, 6),
      (p_subscription_id, v_runway_type_id,  6)
    ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
      SET next_num = GREATEST(artefact_number_sequence.next_num, EXCLUDED.next_num);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_dev_strategy_artefacts(UUID, UUID) IS
    'Dev-only seed: 25 starter strategy artefacts for the given tenant + '
    'workspace, with item-level parent_artefact_id hierarchy (Theme→BO→'
    'Feature and Product→Portfolio Runway). Idempotent via the '
    'artefacts_number_unique_per_type partial unique index. Called once at '
    'migration time and again from MasterReset() so dev pages survive resets.';

-- Run the seed for the default dev tenant + workspace right now.
SELECT seed_dev_strategy_artefacts(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid
);

COMMIT;
