-- ============================================================
-- MMFFDev - mmff_library SEED: extra system portfolio models
-- Run against the mmff_library database AS mmff_library_admin:
--   docker exec -i mmff-ops-postgres psql -U mmff_library_admin -d mmff_library < seed/003_extra_models.sql
--
-- Seeds four additional system models so the adoption wizard
-- shows a real catalogue. All four mirror the MMFF Standard
-- shape (system / public / version 1) and use the same
-- per-layer Draft -> Active -> Done lifecycle.
--
-- Layer chains (top -> bottom, data flows up):
--   Enterprise  : SO -> PO -> BE -> BC -> FE
--   Rally       : ST -> IN -> FE
--   Jira        : IN
--   SAFe        : STH -> PBL -> PGB -> FE
--
-- UUID prefix bands (stable, do not change after seed has shipped):
--   Enterprise   model=bb01 family=b000 layers=bb1x states=bcXX
--   Rally        model=cc01 family=c000 layers=cc1x states=ccXX
--   Jira         model=dd01 family=d000 layers=dd1x states=dcXX
--   SAFe         model=ee01 family=e000 layers=ee1x states=ecXX
--
-- Idempotent: ON CONFLICT DO NOTHING guards re-runs.
-- ============================================================

BEGIN;

-- ============================================================
-- Enterprise: SO -> PO -> BE -> BC -> FE
-- ============================================================
WITH model_ins AS (
    INSERT INTO portfolio_models (
        id, model_family_id, key, name, description, instructions_md,
        scope, owner_subscription_id, visibility, feature_flags,
        default_view, icon, version, library_version
    ) VALUES (
        '00000000-0000-0000-0000-00000000bb01'::uuid,
        '00000000-0000-0000-0000-00000000b000'::uuid,
        'enterprise',
        'Enterprise',
        $$**What**

Enterprise is built for large organisations where portfolio strategy and delivery need to stay clearly separated. Five layers from Strategic Objective down to Feature create a distinct accountability at each level: executives set direction, portfolio managers allocate investment, and delivery teams ship outcomes.

**How**

Strategic Objectives capture the multi-year business commitments the organisation must deliver. Portfolio Objectives translate those into measurable targets across one or two planning periods. Business Epics define the major value initiatives that advance each objective. Business Outcomes act as checkpoints confirming the work is producing real results before the next phase. Features at the base are the discrete increments teams pick up sprint by sprint.

**Why**

Use Enterprise when you run formal portfolio governance across multiple delivery programmes under a shared strategic plan, or when you need clear traceability from board-level goals to released software. The extra layers are worth the effort only if you have the governance structure in place to maintain them.$$,
        '# Enterprise model

A five-layer chain for organisations that separate strategic intent from delivery outcomes.

- **Strategic Objective** (SO): top-level strategic intent
- **Portfolio Objective** (PO): measurable portfolio target
- **Business Epic** (BE): major value delivery initiative
- **Business Outcome** (BC): checkpoint confirming the epic is delivering
- **Feature** (FE): adoptable user-facing change',
        'system', NULL, 'public', '{}'::jsonb,
        'tree', 'sitemap', 1, '2026.04.0'
    )
    ON CONFLICT (model_family_id, version) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
)
INSERT INTO portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000bb11'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, 'Strategic Objective', 'SO', 10, NULL::uuid,                                          'route',   'Top-level strategic intent.',                          TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000bb12'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, 'Portfolio Objective', 'PO', 20, '00000000-0000-0000-0000-00000000bb11'::uuid,         'target',  'Portfolio-level objective laddering to strategy.',     TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000bb13'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, 'Business Epic',       'BE', 30, '00000000-0000-0000-0000-00000000bb12'::uuid,         'package', 'Major scope of work delivering portfolio value.',      TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000bb14'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, 'Business Outcome',    'BC', 40, '00000000-0000-0000-0000-00000000bb13'::uuid,         'layers',  'Measurable outcome the epic produces.',                TRUE,  FALSE),
    ('00000000-0000-0000-0000-00000000bb15'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, 'Feature',             'FE', 50, '00000000-0000-0000-0000-00000000bb14'::uuid,         'star',    'Adoptable user-facing change.',                        TRUE,  TRUE)
) AS v(id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
ON CONFLICT (model_id, tag) DO NOTHING;

INSERT INTO portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000bc11'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb11'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000bc12'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb11'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000bc13'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb11'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000bc21'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb12'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000bc22'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb12'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000bc23'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb12'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000bc31'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb13'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000bc32'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb13'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000bc33'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb13'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000bc41'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb14'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000bc42'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb14'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000bc43'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb14'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000bc51'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb15'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000bc52'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb15'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000bc53'::uuid, '00000000-0000-0000-0000-00000000bb01'::uuid, '00000000-0000-0000-0000-00000000bb15'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981')
) AS v(id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
ON CONFLICT (layer_id, state_key) DO NOTHING;

INSERT INTO portfolio_model_workflow_transitions (model_id, from_state_id, to_state_id) VALUES
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc11', '00000000-0000-0000-0000-00000000bc12'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc12', '00000000-0000-0000-0000-00000000bc13'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc21', '00000000-0000-0000-0000-00000000bc22'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc22', '00000000-0000-0000-0000-00000000bc23'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc31', '00000000-0000-0000-0000-00000000bc32'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc32', '00000000-0000-0000-0000-00000000bc33'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc41', '00000000-0000-0000-0000-00000000bc42'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc42', '00000000-0000-0000-0000-00000000bc43'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc51', '00000000-0000-0000-0000-00000000bc52'),
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bc52', '00000000-0000-0000-0000-00000000bc53')
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

INSERT INTO portfolio_model_artifacts (model_id, artifact_key, enabled, config) VALUES
    ('00000000-0000-0000-0000-00000000bb01', 'board',  TRUE,  '{"default_columns":["draft","active","done"]}'::jsonb),
    ('00000000-0000-0000-0000-00000000bb01', 'sprint', FALSE, '{}'::jsonb),
    ('00000000-0000-0000-0000-00000000bb01', 'pi',     FALSE, '{}'::jsonb)
ON CONFLICT (model_id, artifact_key) DO NOTHING;

INSERT INTO portfolio_model_terminology (model_id, key, value) VALUES
    ('00000000-0000-0000-0000-00000000bb01', 'portfolio.strategic_objective', 'Strategic Objective'),
    ('00000000-0000-0000-0000-00000000bb01', 'portfolio.portfolio_objective', 'Portfolio Objective'),
    ('00000000-0000-0000-0000-00000000bb01', 'portfolio.business_epic',       'Business Epic'),
    ('00000000-0000-0000-0000-00000000bb01', 'portfolio.business_outcome',    'Business Outcome'),
    ('00000000-0000-0000-0000-00000000bb01', 'portfolio.feature',             'Feature')
ON CONFLICT (model_id, key) DO NOTHING;


-- ============================================================
-- Rally: ST -> IN -> FE
-- ============================================================
WITH model_ins AS (
    INSERT INTO portfolio_models (
        id, model_family_id, key, name, description, instructions_md,
        scope, owner_subscription_id, visibility, feature_flags,
        default_view, icon, version, library_version
    ) VALUES (
        '00000000-0000-0000-0000-00000000cc01'::uuid,
        '00000000-0000-0000-0000-00000000c000'::uuid,
        'rally',
        'Rally',
        $$**What**

Rally is a three-layer portfolio hierarchy based on the Broadcom Rally portfolio management approach. The compact chain of Strategy, Initiative, and Feature suits organisations that want visible strategic alignment without the overhead of a deeper structure. Fewer layers means faster planning and less disruption when priorities shift.

**How**

Strategy at the top sets the investment themes that govern where funding goes. Initiatives are the work packages that act on that strategy, typically spanning one or more planning increments and owned at programme level. Features sit directly above the execution stack, connecting strategic intent to the sprint-level work delivery teams pick up day to day.

**Why**

Use Rally when your teams already work in a Rally environment and want familiar terminology in MMFF, or when you need something lighter than Enterprise but still want a distinct strategic layer above delivery work. The three-layer structure works well for programmes running fewer than ten delivery teams.$$,
        '# Rally model

A lean three-layer chain based on Rally portfolio management.

- **Strategy** (ST): investment themes guiding funding
- **Initiative** (IN): programme-level work package
- **Feature** (FE): adoptable user-facing change',
        'system', NULL, 'public', '{}'::jsonb,
        'tree', 'sitemap', 1, '2026.04.0'
    )
    ON CONFLICT (model_family_id, version) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
)
INSERT INTO portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000cc11'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, 'Strategy',   'ST', 10, NULL::uuid,                                          'route',   'Strategic intent.',                       TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000cc12'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, 'Initiative', 'IN', 20, '00000000-0000-0000-0000-00000000cc11'::uuid,         'package', 'Initiative laddering up to strategy.',    TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000cc13'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, 'Feature',    'FE', 30, '00000000-0000-0000-0000-00000000cc12'::uuid,         'star',    'Adoptable user-facing change.',           TRUE, TRUE)
) AS v(id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
ON CONFLICT (model_id, tag) DO NOTHING;

INSERT INTO portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000cc21'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc11'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000cc22'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc11'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000cc23'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc11'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000cc31'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc12'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000cc32'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc12'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000cc33'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc12'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000cc41'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc13'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000cc42'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc13'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000cc43'::uuid, '00000000-0000-0000-0000-00000000cc01'::uuid, '00000000-0000-0000-0000-00000000cc13'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981')
) AS v(id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
ON CONFLICT (layer_id, state_key) DO NOTHING;

INSERT INTO portfolio_model_workflow_transitions (model_id, from_state_id, to_state_id) VALUES
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc21', '00000000-0000-0000-0000-00000000cc22'),
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc22', '00000000-0000-0000-0000-00000000cc23'),
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc31', '00000000-0000-0000-0000-00000000cc32'),
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc32', '00000000-0000-0000-0000-00000000cc33'),
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc41', '00000000-0000-0000-0000-00000000cc42'),
    ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cc42', '00000000-0000-0000-0000-00000000cc43')
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

INSERT INTO portfolio_model_artifacts (model_id, artifact_key, enabled, config) VALUES
    ('00000000-0000-0000-0000-00000000cc01', 'board',  TRUE,  '{"default_columns":["draft","active","done"]}'::jsonb),
    ('00000000-0000-0000-0000-00000000cc01', 'sprint', FALSE, '{}'::jsonb),
    ('00000000-0000-0000-0000-00000000cc01', 'pi',     FALSE, '{}'::jsonb)
ON CONFLICT (model_id, artifact_key) DO NOTHING;

INSERT INTO portfolio_model_terminology (model_id, key, value) VALUES
    ('00000000-0000-0000-0000-00000000cc01', 'portfolio.strategy',   'Strategy'),
    ('00000000-0000-0000-0000-00000000cc01', 'portfolio.initiative', 'Initiative'),
    ('00000000-0000-0000-0000-00000000cc01', 'portfolio.feature',    'Feature')
ON CONFLICT (model_id, key) DO NOTHING;


-- ============================================================
-- Jira: IN (single layer)
-- ============================================================
WITH model_ins AS (
    INSERT INTO portfolio_models (
        id, model_family_id, key, name, description, instructions_md,
        scope, owner_subscription_id, visibility, feature_flags,
        default_view, icon, version, library_version
    ) VALUES (
        '00000000-0000-0000-0000-00000000dd01'::uuid,
        '00000000-0000-0000-0000-00000000d000'::uuid,
        'jira',
        'Jira',
        $$**What**

The Jira model is the lightest option in the catalogue. A single portfolio layer, Initiative, sits above the execution stack. It is for teams that already manage delivery work in Jira or a similar tool and want to connect that work to portfolio-level planning without adding a parallel hierarchy on top.

**How**

Initiatives are large strategic containers, broadly equivalent to Jira Initiatives or top-level Epics depending on your configuration. They exist to group delivery work under a declared portfolio commitment. Everything below that level, including epics, stories, and tasks, continues to live in your existing tooling and connects to MMFF through the execution stack.

**Why**

Use Jira when you have an established Jira workflow your teams rely on and do not want to change. A single portfolio layer gives portfolio managers visibility into strategic commitments without asking delivery teams to adopt a new structure. This model requires the least change from an existing Jira setup.$$,
        '# Jira model

Light-touch: a single portfolio layer above the execution stack. For teams that already manage detailed work in Jira or a similar tool.

- **Initiative** (IN): strategic container grouping delivery work',
        'system', NULL, 'public', '{}'::jsonb,
        'tree', 'sitemap', 1, '2026.04.0'
    )
    ON CONFLICT (model_family_id, version) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
)
INSERT INTO portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000dd11'::uuid, '00000000-0000-0000-0000-00000000dd01'::uuid, 'Initiative', 'IN', 10, NULL::uuid, 'star', 'Single portfolio layer; execution stack handles everything below.', TRUE, TRUE)
) AS v(id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
ON CONFLICT (model_id, tag) DO NOTHING;

INSERT INTO portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000dc11'::uuid, '00000000-0000-0000-0000-00000000dd01'::uuid, '00000000-0000-0000-0000-00000000dd11'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000dc12'::uuid, '00000000-0000-0000-0000-00000000dd01'::uuid, '00000000-0000-0000-0000-00000000dd11'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000dc13'::uuid, '00000000-0000-0000-0000-00000000dd01'::uuid, '00000000-0000-0000-0000-00000000dd11'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981')
) AS v(id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
ON CONFLICT (layer_id, state_key) DO NOTHING;

INSERT INTO portfolio_model_workflow_transitions (model_id, from_state_id, to_state_id) VALUES
    ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000dc11', '00000000-0000-0000-0000-00000000dc12'),
    ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000dc12', '00000000-0000-0000-0000-00000000dc13')
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

INSERT INTO portfolio_model_artifacts (model_id, artifact_key, enabled, config) VALUES
    ('00000000-0000-0000-0000-00000000dd01', 'board',  TRUE,  '{"default_columns":["draft","active","done"]}'::jsonb),
    ('00000000-0000-0000-0000-00000000dd01', 'sprint', FALSE, '{}'::jsonb),
    ('00000000-0000-0000-0000-00000000dd01', 'pi',     FALSE, '{}'::jsonb)
ON CONFLICT (model_id, artifact_key) DO NOTHING;

INSERT INTO portfolio_model_terminology (model_id, key, value) VALUES
    ('00000000-0000-0000-0000-00000000dd01', 'portfolio.initiative', 'Initiative')
ON CONFLICT (model_id, key) DO NOTHING;


-- ============================================================
-- SAFe: STH -> PBL -> PGB -> FE
-- ============================================================
WITH model_ins AS (
    INSERT INTO portfolio_models (
        id, model_family_id, key, name, description, instructions_md,
        scope, owner_subscription_id, visibility, feature_flags,
        default_view, icon, version, library_version
    ) VALUES (
        '00000000-0000-0000-0000-00000000ee01'::uuid,
        '00000000-0000-0000-0000-00000000e000'::uuid,
        'safe',
        'SAFe',
        $$**What**

The SAFe model follows the Scaled Agile Framework portfolio management structure. Four layers connect enterprise strategy to releasable features using terminology that SAFe-trained teams will already know. It suits organisations that have invested in SAFe and want MMFF to reflect that structure rather than requiring teams to translate between two different systems.

**How**

Strategic Themes represent the enterprise-level priorities that guide investment decisions, typically reviewed through a portfolio canvas or Business Agility Review. Portfolio Backlog holds Epics ready or approaching a funding decision. Programme Backlog contains approved work broken into PI-sized deliverables ready for Agile Release Train assignment. Features at the base are what teams pick up in PI planning and deliver across sprints.

**Why**

Use SAFe when your organisation runs PI planning, ART synchronisation, and portfolio Kanban and you want a model that fits that structure. The four-layer chain works well for programmes running multiple Agile Release Trains.$$,
        '# SAFe model

Four-layer SAFe portfolio chain connecting enterprise strategy to releasable features.

- **Strategic Theme** (STH): enterprise-level investment priority
- **Portfolio Backlog** (PBL): Epics approaching or at funding decision
- **Programme Backlog** (PGB): approved work ready for ART assignment
- **Feature** (FE): adoptable user-facing change',
        'system', NULL, 'public', '{}'::jsonb,
        'tree', 'sitemap', 1, '2026.04.0'
    )
    ON CONFLICT (model_family_id, version) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
)
INSERT INTO portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000ee11'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, 'Strategic Theme',    'STH', 10, NULL::uuid,                                          'route',   'Strategic theme.',                          TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ee12'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, 'Portfolio Backlog',  'PBL', 20, '00000000-0000-0000-0000-00000000ee11'::uuid,         'layers',  'Portfolio-level backlog.',                  TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ee13'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, 'Programme Backlog',  'PGB', 30, '00000000-0000-0000-0000-00000000ee12'::uuid,         'package', 'Programme-level backlog.',                  TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ee14'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, 'Feature',            'FE',  40, '00000000-0000-0000-0000-00000000ee13'::uuid,         'star',    'Adoptable user-facing change.',             TRUE, TRUE)
) AS v(id, model_id, name, tag, sort_order, parent_layer_id, icon, description_md, allows_children, is_leaf)
ON CONFLICT (model_id, tag) DO NOTHING;

INSERT INTO portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-00000000ec11'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee11'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ec12'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee11'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ec13'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee11'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000ec21'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee12'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ec22'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee12'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ec23'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee12'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000ec31'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee13'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ec32'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee13'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ec33'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee13'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981'),
    ('00000000-0000-0000-0000-00000000ec41'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee14'::uuid, 'draft',  'Draft',  10, TRUE,  FALSE, '#94a3b8'),
    ('00000000-0000-0000-0000-00000000ec42'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee14'::uuid, 'active', 'Active', 20, FALSE, FALSE, '#3b82f6'),
    ('00000000-0000-0000-0000-00000000ec43'::uuid, '00000000-0000-0000-0000-00000000ee01'::uuid, '00000000-0000-0000-0000-00000000ee14'::uuid, 'done',   'Done',   30, FALSE, TRUE,  '#10b981')
) AS v(id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour)
ON CONFLICT (layer_id, state_key) DO NOTHING;

INSERT INTO portfolio_model_workflow_transitions (model_id, from_state_id, to_state_id) VALUES
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec11', '00000000-0000-0000-0000-00000000ec12'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec12', '00000000-0000-0000-0000-00000000ec13'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec21', '00000000-0000-0000-0000-00000000ec22'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec22', '00000000-0000-0000-0000-00000000ec23'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec31', '00000000-0000-0000-0000-00000000ec32'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec32', '00000000-0000-0000-0000-00000000ec33'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec41', '00000000-0000-0000-0000-00000000ec42'),
    ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ec42', '00000000-0000-0000-0000-00000000ec43')
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

INSERT INTO portfolio_model_artifacts (model_id, artifact_key, enabled, config) VALUES
    ('00000000-0000-0000-0000-00000000ee01', 'board',  TRUE,  '{"default_columns":["draft","active","done"]}'::jsonb),
    ('00000000-0000-0000-0000-00000000ee01', 'sprint', FALSE, '{}'::jsonb),
    ('00000000-0000-0000-0000-00000000ee01', 'pi',     FALSE, '{}'::jsonb)
ON CONFLICT (model_id, artifact_key) DO NOTHING;

INSERT INTO portfolio_model_terminology (model_id, key, value) VALUES
    ('00000000-0000-0000-0000-00000000ee01', 'portfolio.strategic_theme',   'Strategic Theme'),
    ('00000000-0000-0000-0000-00000000ee01', 'portfolio.portfolio_backlog', 'Portfolio Backlog'),
    ('00000000-0000-0000-0000-00000000ee01', 'portfolio.programme_backlog', 'Programme Backlog'),
    ('00000000-0000-0000-0000-00000000ee01', 'portfolio.feature',           'Feature')
ON CONFLICT (model_id, key) DO NOTHING;

COMMIT;
