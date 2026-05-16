-- ============================================================
-- MMFFDev - Vector: Adoption mirror tables for portfolio-model bundles
-- Migration 029 — applied on top of 026_subscription_portfolio_model_state.sql
-- (027/028 reserved for in-flight library reconciler + page-registry work)
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 029_adoption_mirror_tables.sql
--
-- Creates the 5 destination tables that the adoption orchestrator (card 00008)
-- populates when a subscription adopts an mmff_library portfolio-model bundle.
-- After adoption these tables are the subscription's editable copy — the
-- library row is the snapshot source, this is the live working version.
--
-- Mirrored library tables (source: db/library_schema/003_portfolio_model_bundles.sql):
--   portfolio_model_layers                 -> subscription_layers
--   portfolio_model_workflows              -> subscription_workflows
--   portfolio_model_workflow_transitions   -> subscription_workflow_transitions
--   portfolio_model_artifacts              -> subscription_artifacts
--   portfolio_model_terminology            -> subscription_terminology
--
-- Per-subscription wrappings added to every mirror table:
--   id                       UUID PK DEFAULT gen_random_uuid()
--   subscription_id          UUID NOT NULL REFERENCES subscriptions(id) RESTRICT
--   source_library_id        UUID NOT NULL  -- library row id; APP-ENFORCED cross-DB
--   source_library_version   INT  NOT NULL  -- portfolio_models.version at adopt time
--   archived_at, created_at, updated_at + set_updated_at() trigger
--
-- Cross-table FKs INSIDE the mirror set use the new mirror UUID PKs (NOT
-- library UUIDs). The orchestrator translates library_id → mirror_id row
-- by row during adopt. ON DELETE rules match the library:
--   subscription_layers.parent_layer_id            RESTRICT (library: RESTRICT)
--   subscription_workflows.layer_id                CASCADE  (library: CASCADE)
--   subscription_workflow_transitions.from_state_id CASCADE (library: CASCADE)
--   subscription_workflow_transitions.to_state_id   CASCADE (library: CASCADE)
-- All mirror tables also keep a CASCADE chain via subscription_id→subscriptions
-- replaced by RESTRICT (per c_schema.md invariant: portfolio data is RESTRICT
-- so subscription deletion never silently drops business rows).
--
-- Cross-DB references (`source_library_id`, `source_library_version`):
-- Postgres has no cross-DB foreign keys, so the adoption handler is the only
-- writer and validates against mmff_library before INSERT (same pattern as
-- migration 026's `adopted_model_id`). The reconciler in
-- feature_library_db_and_portfolio_presets_v3.md §8 sweeps for orphans.
--
-- Indexes per mirror table:
--   idx_<table>_subscription_id   (subscription_id)               WHERE archived_at IS NULL
--   idx_<table>_source            (subscription_id, source_library_id) WHERE archived_at IS NULL
--   plus library-derived uniques re-shaped to (subscription_id, …)
-- ============================================================

BEGIN;

-- ─── 1. subscription_layers ─────────────────────────────────────────
-- Mirrors mmff_library.portfolio_model_layers.
-- Library uniques: (model_id, name), (model_id, tag).
-- Mirror equivalents key on subscription_id since model_id has no mirror form
-- (the model spine is referenced via subscription_portfolio_model_state).
CREATE TABLE subscription_layers (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id        UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    source_library_id      UUID        NOT NULL,
    source_library_version INT         NOT NULL CHECK (source_library_version > 0),

    -- Payload columns from portfolio_model_layers (verbatim):
    name                   TEXT        NOT NULL,
    tag                    TEXT        NOT NULL CHECK (length(tag) BETWEEN 2 AND 4),
    sort_order             INT         NOT NULL DEFAULT 0,
    parent_layer_id        UUID        REFERENCES subscription_layers(id) ON DELETE RESTRICT,
    icon                   TEXT,
    colour                 TEXT,
    description_md         TEXT,
    help_md                TEXT,
    allows_children        BOOLEAN     NOT NULL DEFAULT TRUE,
    is_leaf                BOOLEAN     NOT NULL DEFAULT FALSE,

    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_layers_subscription_id
    ON subscription_layers (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_layers_source
    ON subscription_layers (subscription_id, source_library_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_layers_parent
    ON subscription_layers (parent_layer_id)
    WHERE parent_layer_id IS NOT NULL AND archived_at IS NULL;

-- Library uniques re-shaped per-subscription (live rows only; archived names
-- can be re-used after archive).
CREATE UNIQUE INDEX idx_subscription_layers_name_unique
    ON subscription_layers (subscription_id, name)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_subscription_layers_tag_unique
    ON subscription_layers (subscription_id, tag)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_subscription_layers_updated_at
    BEFORE UPDATE ON subscription_layers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_layers IS
    'Per-subscription mirror of mmff_library.portfolio_model_layers, populated '
    'by the adoption orchestrator. Source row identified by (source_library_id, '
    'source_library_version) — APP-ENFORCED cross-DB reference. See '
    'feature_library_db_and_portfolio_presets_v3.md §11 (adoption saga) and '
    'c_polymorphic_writes.md (writer-rules pattern).';
COMMENT ON COLUMN subscription_layers.source_library_id IS
    'mmff_library.portfolio_model_layers.id at adopt time. Cross-DB; '
    'validated by the adoption handler, swept by nightly reconciler.';
COMMENT ON COLUMN subscription_layers.source_library_version IS
    'Snapshot of mmff_library.portfolio_models.version at adopt time. '
    'Used by the reconciler to detect upstream bundle upgrades.';

-- ─── 2. subscription_workflows ──────────────────────────────────────
-- Mirrors mmff_library.portfolio_model_workflows (states-per-layer).
-- Library unique: (layer_id, state_key).
CREATE TABLE subscription_workflows (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id        UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    source_library_id      UUID        NOT NULL,
    source_library_version INT         NOT NULL CHECK (source_library_version > 0),

    -- Payload columns from portfolio_model_workflows (verbatim):
    layer_id               UUID        NOT NULL REFERENCES subscription_layers(id) ON DELETE CASCADE,
    state_key              TEXT        NOT NULL,
    state_label            TEXT        NOT NULL,
    sort_order             INT         NOT NULL DEFAULT 0,
    is_initial             BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal            BOOLEAN     NOT NULL DEFAULT FALSE,
    colour                 TEXT,

    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_workflows_subscription_id
    ON subscription_workflows (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_workflows_source
    ON subscription_workflows (subscription_id, source_library_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_workflows_layer
    ON subscription_workflows (layer_id)
    WHERE archived_at IS NULL;

-- Library unique (layer_id, state_key) re-shaped per-subscription. Layer
-- itself is per-subscription so layer_id alone provides isolation, but we
-- include subscription_id for index symmetry with the rest.
CREATE UNIQUE INDEX idx_subscription_workflows_state_unique
    ON subscription_workflows (subscription_id, layer_id, state_key)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_subscription_workflows_updated_at
    BEFORE UPDATE ON subscription_workflows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_workflows IS
    'Per-subscription mirror of mmff_library.portfolio_model_workflows '
    '(workflow states per layer). layer_id references the mirror layer row '
    '(NOT the library layer). See migration header.';

-- ─── 3. subscription_workflow_transitions ───────────────────────────
-- Mirrors mmff_library.portfolio_model_workflow_transitions.
-- Library unique: (from_state_id, to_state_id) + CHECK from <> to.
CREATE TABLE subscription_workflow_transitions (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id        UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    source_library_id      UUID        NOT NULL,
    source_library_version INT         NOT NULL CHECK (source_library_version > 0),

    -- Payload columns from portfolio_model_workflow_transitions (verbatim):
    from_state_id          UUID        NOT NULL REFERENCES subscription_workflows(id) ON DELETE CASCADE,
    to_state_id            UUID        NOT NULL REFERENCES subscription_workflows(id) ON DELETE CASCADE,

    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (from_state_id <> to_state_id)
);

CREATE INDEX idx_subscription_workflow_transitions_subscription_id
    ON subscription_workflow_transitions (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_workflow_transitions_source
    ON subscription_workflow_transitions (subscription_id, source_library_id)
    WHERE archived_at IS NULL;

-- Library uniqueness (from_state_id, to_state_id) — the mirror state ids
-- are subscription-scoped already, so no extra subscription_id column needed
-- in the unique; include it for index-shape consistency.
CREATE UNIQUE INDEX idx_subscription_workflow_transitions_pair_unique
    ON subscription_workflow_transitions (subscription_id, from_state_id, to_state_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_subscription_workflow_transitions_updated_at
    BEFORE UPDATE ON subscription_workflow_transitions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_workflow_transitions IS
    'Per-subscription mirror of mmff_library.portfolio_model_workflow_transitions. '
    'from_state_id/to_state_id reference subscription_workflows (mirror) rows, '
    'NOT library rows. The orchestrator translates library_id -> mirror_id at '
    'adopt time. See migration header.';

-- ─── 4. subscription_artifacts ──────────────────────────────────────
-- Mirrors mmff_library.portfolio_model_artifacts.
-- Library unique: (model_id, artifact_key).
CREATE TABLE subscription_artifacts (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id        UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    source_library_id      UUID        NOT NULL,
    source_library_version INT         NOT NULL CHECK (source_library_version > 0),

    -- Payload columns from portfolio_model_artifacts (verbatim):
    artifact_key           TEXT        NOT NULL,
    enabled                BOOLEAN     NOT NULL DEFAULT TRUE,
    config                 JSONB       NOT NULL DEFAULT '{}'::jsonb,

    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_artifacts_subscription_id
    ON subscription_artifacts (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_artifacts_source
    ON subscription_artifacts (subscription_id, source_library_id)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_subscription_artifacts_key_unique
    ON subscription_artifacts (subscription_id, artifact_key)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_subscription_artifacts_updated_at
    BEFORE UPDATE ON subscription_artifacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_artifacts IS
    'Per-subscription mirror of mmff_library.portfolio_model_artifacts. '
    'artifact_key is unique per-subscription (live rows). See migration header.';

-- ─── 5. subscription_terminology ────────────────────────────────────
-- Mirrors mmff_library.portfolio_model_terminology.
-- Library unique: (model_id, key).
CREATE TABLE subscription_terminology (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id        UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    source_library_id      UUID        NOT NULL,
    source_library_version INT         NOT NULL CHECK (source_library_version > 0),

    -- Payload columns from portfolio_model_terminology (verbatim):
    key                    TEXT        NOT NULL,
    value                  TEXT        NOT NULL,

    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_terminology_subscription_id
    ON subscription_terminology (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subscription_terminology_source
    ON subscription_terminology (subscription_id, source_library_id)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_subscription_terminology_key_unique
    ON subscription_terminology (subscription_id, key)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_subscription_terminology_updated_at
    BEFORE UPDATE ON subscription_terminology
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_terminology IS
    'Per-subscription mirror of mmff_library.portfolio_model_terminology '
    '(label overrides). key is unique per-subscription (live rows). See '
    'migration header.';

COMMIT;
