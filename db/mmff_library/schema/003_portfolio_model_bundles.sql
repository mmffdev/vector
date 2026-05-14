-- ============================================================
-- MMFFDev - mmff_library: Portfolio model bundle tables (Phase 1)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 003_portfolio_model_bundles.sql
--
-- Implements plan §6.1–6.6: portfolio_models spine + 5 bundle children.
-- Adoption identity is (model_family_id, version) — see plan §5.
-- All tables get archived_at, created_at, updated_at + trigger.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger function. Mirrors mmff_vector convention.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 6.1 portfolio_models — spine ────────────────────────────────────
CREATE TABLE portfolio_models (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_family_id       UUID        NOT NULL,
    key                   TEXT        NOT NULL,
    name                  TEXT        NOT NULL,
    description           TEXT,
    instructions_md       TEXT,
    scope                 TEXT        NOT NULL CHECK (scope IN ('system','tenant','shared')),
    owner_subscription_id UUID,                                         -- app-enforced FK to mmff_vector.subscriptions
    visibility            TEXT        NOT NULL DEFAULT 'private'
                          CHECK (visibility IN ('private','public','invite')),
    feature_flags         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    default_view          TEXT,
    icon                  TEXT,
    version               INT         NOT NULL DEFAULT 1 CHECK (version > 0),
    library_version       TEXT,
    archived_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_family_id, version),
    UNIQUE (owner_subscription_id, key, version),
    CONSTRAINT scope_owner_consistency CHECK (
        (scope = 'system' AND owner_subscription_id IS NULL)
        OR (scope <> 'system' AND owner_subscription_id IS NOT NULL)
    )
);
CREATE INDEX idx_portfolio_models_family ON portfolio_models(model_family_id);
CREATE INDEX idx_portfolio_models_owner  ON portfolio_models(owner_subscription_id)
    WHERE owner_subscription_id IS NOT NULL;
CREATE INDEX idx_portfolio_models_active ON portfolio_models(scope, visibility)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_portfolio_models_updated_at
    BEFORE UPDATE ON portfolio_models
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE portfolio_models IS
    'Spine of a portfolio model bundle. (model_family_id, version) is the stable identity tenants adopt against. '
    'See plan §5 (identity model) and §6.1.';
COMMENT ON COLUMN portfolio_models.owner_subscription_id IS
    'App-enforced FK to mmff_vector.subscriptions. NULL iff scope=''system''.';

-- ─── 6.2 portfolio_model_layers ─────────────────────────────────────
CREATE TABLE portfolio_model_layers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    tag             TEXT        NOT NULL CHECK (length(tag) BETWEEN 2 AND 4),
    sort_order      INT         NOT NULL DEFAULT 0,
    parent_layer_id UUID        REFERENCES portfolio_model_layers(id) ON DELETE RESTRICT,
    icon            TEXT,
    colour          TEXT,
    description_md  TEXT,
    help_md         TEXT,
    allows_children BOOLEAN     NOT NULL DEFAULT TRUE,
    is_leaf         BOOLEAN     NOT NULL DEFAULT FALSE,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, name),
    UNIQUE (model_id, tag)
);
CREATE INDEX idx_portfolio_model_layers_model  ON portfolio_model_layers(model_id);
CREATE INDEX idx_portfolio_model_layers_parent ON portfolio_model_layers(parent_layer_id)
    WHERE parent_layer_id IS NOT NULL;

CREATE TRIGGER trg_portfolio_model_layers_updated_at
    BEFORE UPDATE ON portfolio_model_layers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6.3 portfolio_model_workflows (states per layer) ───────────────
CREATE TABLE portfolio_model_workflows (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id    UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    layer_id    UUID        NOT NULL REFERENCES portfolio_model_layers(id) ON DELETE CASCADE,
    state_key   TEXT        NOT NULL,
    state_label TEXT        NOT NULL,
    sort_order  INT         NOT NULL DEFAULT 0,
    is_initial  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal BOOLEAN     NOT NULL DEFAULT FALSE,
    colour      TEXT,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (layer_id, state_key)
);
CREATE INDEX idx_portfolio_model_workflows_model ON portfolio_model_workflows(model_id);
CREATE INDEX idx_portfolio_model_workflows_layer ON portfolio_model_workflows(layer_id);

CREATE TRIGGER trg_portfolio_model_workflows_updated_at
    BEFORE UPDATE ON portfolio_model_workflows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6.4 portfolio_model_workflow_transitions ───────────────────────
-- Mirrors tenant DB's item_type_transition_edges (migration 006).
CREATE TABLE portfolio_model_workflow_transitions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id      UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    from_state_id UUID        NOT NULL REFERENCES portfolio_model_workflows(id) ON DELETE CASCADE,
    to_state_id   UUID        NOT NULL REFERENCES portfolio_model_workflows(id) ON DELETE CASCADE,
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_state_id, to_state_id),
    CHECK (from_state_id <> to_state_id)
);
CREATE INDEX idx_portfolio_model_transitions_model ON portfolio_model_workflow_transitions(model_id);

CREATE TRIGGER trg_portfolio_model_transitions_updated_at
    BEFORE UPDATE ON portfolio_model_workflow_transitions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6.5 portfolio_model_artifacts ──────────────────────────────────
CREATE TABLE portfolio_model_artifacts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id     UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    artifact_key TEXT        NOT NULL,
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    config       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, artifact_key)
);
CREATE INDEX idx_portfolio_model_artifacts_model ON portfolio_model_artifacts(model_id);

CREATE TRIGGER trg_portfolio_model_artifacts_updated_at
    BEFORE UPDATE ON portfolio_model_artifacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6.6 portfolio_model_terminology ────────────────────────────────
CREATE TABLE portfolio_model_terminology (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id    UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL,
    value       TEXT        NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, key)
);
CREATE INDEX idx_portfolio_model_terminology_model ON portfolio_model_terminology(model_id);

CREATE TRIGGER trg_portfolio_model_terminology_updated_at
    BEFORE UPDATE ON portfolio_model_terminology
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
