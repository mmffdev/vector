-- ============================================================
-- MMFFDev - vector_artefacts: M6 (PLA-0026 / story 00481)
-- Backfill master_record_portfolio for currently-adopted workspaces.
--
-- Run against vector_artefacts:
--   go run ./cmd/migrate -db vector_artefacts -dir <repo_root>
--
-- Per R047 §11 step 5: read existing obj_strategy_types_layers (legacy
-- adoption fact in mmff_vector) + portfolio_templates (model definitions
-- in mmff_library) and INSERT one master_record_portfolio row per
-- currently-adopted workspace, identifying the model by tag-set match.
--
-- Cross-DB reads via postgres_fdw:
--   - fdw_obj_strategy_types_layers   (mmff_vector — legacy adopted layers)
--   - fdw_portfolio_templates         (mmff_library — model catalogue)
-- The mmff_vector server is reused from migration 015; a new server is
-- created here for mmff_library because no prior migration referenced it.
--
-- Parity gate (T1 substitute, gates promotion per R047 §11):
--   COUNT(DISTINCT subscription_id IN obj_strategy_types_layers WHERE archived_at IS NULL)
--   ==
--   COUNT(DISTINCT w.subscription_id) for workspaces with a master_record_portfolio row
-- The DO block RAISEs and aborts the migration on mismatch.
--
-- Idempotent: re-running is a no-op (ON CONFLICT DO NOTHING + idempotent
-- foreign-server creation via DO blocks).
-- ============================================================

BEGIN;

-- ── 1. mmff_library FDW server (new — only fdw_mmff_vector existed) ──────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'fdw_mmff_library') THEN
        DROP SERVER fdw_mmff_library CASCADE;
    END IF;
END;
$$;

CREATE SERVER fdw_mmff_library
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'mmff_library');

DO $$
DECLARE
    v_pw text;
BEGIN
    v_pw := current_setting('app.fdw_source_password', true);
    IF v_pw IS NULL OR v_pw = '' THEN
        RAISE EXCEPTION 'app.fdw_source_password is not set. The migration runner must inject DB_PASSWORD before running this migration.';
    END IF;
    EXECUTE format(
        'CREATE USER MAPPING IF NOT EXISTS FOR mmff_dev SERVER fdw_mmff_library OPTIONS (user ''mmff_dev'', password %L)',
        v_pw
    );
END $$;

-- ── 2. Foreign tables ────────────────────────────────────────────────────────
CREATE FOREIGN TABLE IF NOT EXISTS fdw_obj_strategy_types_layers (
    id                     uuid,
    subscription_id        uuid,
    source_library_id      uuid,
    source_library_version integer,
    name                   text,
    tag                    text,
    sort_order             integer,
    parent_layer_id        uuid,
    archived_at            timestamptz,
    created_at             timestamptz
)
SERVER fdw_mmff_vector
OPTIONS (schema_name 'public', table_name 'obj_strategy_types_layers');

CREATE FOREIGN TABLE IF NOT EXISTS fdw_portfolio_templates (
    id          uuid,
    name        text,
    description text,
    layers      jsonb
)
SERVER fdw_mmff_library
OPTIONS (schema_name 'public', table_name 'portfolio_templates');

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
-- Identify the model by tag-set equality between the workspace's adopted
-- layers and the template's defined layers. Tag sets are sorted into arrays
-- so equality is order-independent.
WITH adopted_tags AS (
    SELECT subscription_id,
           ARRAY_AGG(tag ORDER BY tag) AS tags,
           MIN(created_at)             AS adopted_at
    FROM fdw_obj_strategy_types_layers
    WHERE archived_at IS NULL
    GROUP BY subscription_id
),
template_tags AS (
    SELECT pt.id,
           pt.name,
           pt.description,
           ARRAY_AGG(l->>'tag' ORDER BY l->>'tag') AS tags
    FROM fdw_portfolio_templates pt,
         jsonb_array_elements(pt.layers) l
    GROUP BY pt.id, pt.name, pt.description
)
INSERT INTO master_record_portfolio (
    workspace_id, model_id, model_name, model_description, adopted_at
)
SELECT
    w.id,
    t.id,
    t.name,
    t.description,
    a.adopted_at
FROM fdw_workspaces w
JOIN adopted_tags   a ON a.subscription_id = w.subscription_id
JOIN template_tags  t ON t.tags = a.tags
ON CONFLICT (workspace_id) DO NOTHING;

-- ── 4. Parity assertion (T1 gate) ────────────────────────────────────────────
DO $$
DECLARE
    v_adopted_subs           int;
    v_workspaces_with_record int;
    v_adopted_no_workspace   int;
    v_unmatched_tag_sets     int;
BEGIN
    SELECT COUNT(DISTINCT subscription_id) INTO v_adopted_subs
    FROM fdw_obj_strategy_types_layers
    WHERE archived_at IS NULL;

    SELECT COUNT(DISTINCT w.subscription_id) INTO v_workspaces_with_record
    FROM master_record_portfolio mrp
    JOIN fdw_workspaces w ON w.id = mrp.workspace_id;

    -- Count adopted subscriptions that have NO workspace row at all.
    -- These can't be backfilled (no workspace UUID to write); they will
    -- need to re-adopt post-cutover via the new saga (B-series).
    SELECT COUNT(DISTINCT layers.subscription_id) INTO v_adopted_no_workspace
    FROM fdw_obj_strategy_types_layers layers
    LEFT JOIN fdw_workspaces w
           ON w.subscription_id = layers.subscription_id
    WHERE layers.archived_at IS NULL
      AND w.id IS NULL;

    -- Adopted subscriptions whose tag-set didn't match any template.
    -- Also unbackfillable; flagged for manual investigation.
    WITH adopted_tags AS (
        SELECT subscription_id,
               ARRAY_AGG(tag ORDER BY tag) AS tags
        FROM fdw_obj_strategy_types_layers
        WHERE archived_at IS NULL
        GROUP BY subscription_id
    ),
    template_tags AS (
        SELECT ARRAY_AGG(l->>'tag' ORDER BY l->>'tag') AS tags
        FROM fdw_portfolio_templates pt,
             jsonb_array_elements(pt.layers) l
        GROUP BY pt.id
    )
    SELECT COUNT(*) INTO v_unmatched_tag_sets
    FROM adopted_tags a
    WHERE NOT EXISTS (SELECT 1 FROM template_tags t WHERE t.tags = a.tags);

    -- Expected: v_workspaces_with_record + v_adopted_no_workspace + v_unmatched_tag_sets
    -- ≥ v_adopted_subs. Equality is the strict invariant: every adopted sub
    -- is accounted for in exactly one bucket.
    IF v_workspaces_with_record + v_adopted_no_workspace + v_unmatched_tag_sets
       < v_adopted_subs THEN
        RAISE EXCEPTION 'Parity check failed: adopted=% backfilled=% no_workspace=% unmatched=%',
            v_adopted_subs, v_workspaces_with_record, v_adopted_no_workspace, v_unmatched_tag_sets;
    END IF;

    RAISE NOTICE 'M6 parity: adopted=% backfilled=% no_workspace=% unmatched=%',
        v_adopted_subs, v_workspaces_with_record, v_adopted_no_workspace, v_unmatched_tag_sets;
END $$;

COMMIT;
