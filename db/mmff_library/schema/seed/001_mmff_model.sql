-- ============================================================
-- MMFFDev - mmff_library SEED: MMFF portfolio model bundle (Phase 1)
-- Run against the mmff_library database AS mmff_library_admin:
--   docker exec -i mmff-ops-postgres psql -U mmff_library_admin -d mmff_library < seed/001_mmff_model.sql
--
-- Seeds the MMFF model — the canonical bundle every new tenant
-- adopts unless they pick a different system model. This is a
-- system model (scope='system', owner_subscription_id=NULL) and
-- public visibility so every tenant can see + adopt it.
--
-- Identity: model_family_id is FIXED across versions. Bumping
-- the model means inserting a new row set with the same family
-- id and version+1; this seed is version 1.
--
-- Idempotent: ON CONFLICT DO NOTHING guards re-runs in dev.
-- ============================================================

BEGIN;

-- Fixed family + version-1 row id so a re-run produces the same UUIDs
-- and downstream references (tenant adoptions, library_releases) stay stable.
WITH model_ins AS (
    INSERT INTO portfolio_models (
        id,
        model_family_id,
        key,
        name,
        description,
        instructions_md,
        scope,
        owner_subscription_id,
        visibility,
        feature_flags,
        default_view,
        icon,
        version,
        library_version
    ) VALUES (
        '00000000-0000-0000-0000-00000000aa01'::uuid,                 -- model id (v1)
        '00000000-0000-0000-0000-00000000a000'::uuid,                 -- model_family_id (stable)
        'mmff',
        'Vector Standard',
        $$**What**

Vector Standard is the MMFF native hierarchy. Five layers run from multi-year strategic planning down to individual features shipping each quarter. It keeps investment decisions separate from release planning so leadership and delivery teams each work at the level that is relevant to them.

**How**

Portfolio Runway captures where the portfolio is heading over the next one to three years. It is not a committed roadmap. Work flows down through Products and Business Objectives, which record what is being improved and why, before reaching Themes and Features, which define what is being built this quarter. Keeping those two questions at different layers stops aspirational roadmap items from being treated as sprint commitments before the underlying objectives have been confirmed.

**Why**

Pick Vector Standard if you have no existing framework requirement, or if you want a model that stays current as MMFF develops. Platform updates and new capabilities are built and tested against this structure first.$$,
        '# Vector Standard model

The MMFF default. Five portfolio layers from strategy down to deliverable feature, with the execution stack underneath.

- **Portfolio Runway** (PRW): strategic horizon
- **Product** (PR): long-lived value stream
- **Business Objective** (BO): measurable outcome
- **Theme** (TH): release-sized scope
- **Feature** (FT): adoptable user-facing change

Edit freely after adoption. Updates from MMFF arrive as release notifications you can review and merge per row.',
        'system',
        NULL,
        'public',
        '{}'::jsonb,
        'tree',
        'sitemap',
        1,
        '2026.04.0'
    )
    ON CONFLICT (model_family_id, version) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
),
model_id_resolved AS (
    SELECT id FROM model_ins
    UNION ALL
    SELECT id FROM portfolio_models WHERE model_family_id = '00000000-0000-0000-0000-00000000a000'::uuid AND version = 1
    LIMIT 1
)
-- ─── Layers ─────────────────────────────────────────────────────────
INSERT INTO portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000ab01'::uuid, (SELECT id FROM model_id_resolved), 'Portfolio Runway',  'PRW', 50, NULL::uuid,                                          'route',     'Strategic horizon — multi-year programme of intent.',                TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000ab02'::uuid, (SELECT id FROM model_id_resolved), 'Product',           'PR',  40, '00000000-0000-0000-0000-00000000ab01'::uuid,         'package',   'Long-lived value stream owned by a product team.',                   TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000ab03'::uuid, (SELECT id FROM model_id_resolved), 'Business Objective','BO',  30, '00000000-0000-0000-0000-00000000ab02'::uuid,         'target',    'Measurable outcome the product is pursuing this period.',            TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000ab04'::uuid, (SELECT id FROM model_id_resolved), 'Theme',             'TH',  20, '00000000-0000-0000-0000-00000000ab03'::uuid,         'layers',    'Release-sized scope: a coherent slice of work that ships together.', TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000ab05'::uuid, (SELECT id FROM model_id_resolved), 'Feature',           'FT',  10, '00000000-0000-0000-0000-00000000ab04'::uuid,         'star',      'Adoptable user-facing change. The leaf of the portfolio stack.',     TRUE,  TRUE)
) AS v(id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
ON CONFLICT (model_id, tag) DO NOTHING;

-- ─── Workflow states (per layer) ────────────────────────────────────
-- All five portfolio layers share the same lifecycle by default: Draft → Active → Done (terminal).
-- Tenants override per layer post-adoption.
INSERT INTO portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
SELECT * FROM (VALUES
    -- Portfolio Runway
    ('00000000-0000-0000-0000-00000000ac11'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab01'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ac12'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab01'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ac13'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab01'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    -- Product
    ('00000000-0000-0000-0000-00000000ac21'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab02'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ac22'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab02'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ac23'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab02'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    -- Business Objective
    ('00000000-0000-0000-0000-00000000ac31'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab03'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ac32'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab03'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ac33'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab03'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    -- Theme
    ('00000000-0000-0000-0000-00000000ac41'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab04'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ac42'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab04'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ac43'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab04'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    -- Feature
    ('00000000-0000-0000-0000-00000000ac51'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab05'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ac52'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab05'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ac53'::uuid, '00000000-0000-0000-0000-00000000aa01'::uuid, '00000000-0000-0000-0000-00000000ab05'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981')
) AS v(id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
ON CONFLICT (layer_id, state_key) DO NOTHING;

-- ─── Workflow transitions (per layer: draft→active, active→done) ────
INSERT INTO portfolio_model_workflow_transitions (model_id, from_state_id, to_state_id)
VALUES
    -- Portfolio Runway
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac11', '00000000-0000-0000-0000-00000000ac12'),
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac12', '00000000-0000-0000-0000-00000000ac13'),
    -- Product
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-00000000ac22'),
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac22', '00000000-0000-0000-0000-00000000ac23'),
    -- Business Objective
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac31', '00000000-0000-0000-0000-00000000ac32'),
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac32', '00000000-0000-0000-0000-00000000ac33'),
    -- Theme
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac42'),
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac42', '00000000-0000-0000-0000-00000000ac43'),
    -- Feature
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-00000000ac52'),
    ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000ac52', '00000000-0000-0000-0000-00000000ac53')
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

-- ─── Artifacts (board, sprint, PI; off by default for portfolio layers) ─
INSERT INTO portfolio_model_artifacts (model_id, artifact_key, enabled, config)
VALUES
    ('00000000-0000-0000-0000-00000000aa01', 'board',  TRUE,  '{"default_columns":["draft","active","done"]}'::jsonb),
    ('00000000-0000-0000-0000-00000000aa01', 'sprint', FALSE, '{}'::jsonb),
    ('00000000-0000-0000-0000-00000000aa01', 'pi',     FALSE, '{}'::jsonb)
ON CONFLICT (model_id, artifact_key) DO NOTHING;

-- ─── Terminology overrides (defaults match layer names; tenants override) ─
INSERT INTO portfolio_model_terminology (model_id, key, value)
VALUES
    ('00000000-0000-0000-0000-00000000aa01', 'portfolio.runway',     'Portfolio Runway'),
    ('00000000-0000-0000-0000-00000000aa01', 'portfolio.product',    'Product'),
    ('00000000-0000-0000-0000-00000000aa01', 'portfolio.objective',  'Business Objective'),
    ('00000000-0000-0000-0000-00000000aa01', 'portfolio.theme',      'Theme'),
    ('00000000-0000-0000-0000-00000000aa01', 'portfolio.feature',    'Feature')
ON CONFLICT (model_id, key) DO NOTHING;

COMMIT;
