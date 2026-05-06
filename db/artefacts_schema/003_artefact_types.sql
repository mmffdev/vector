-- ============================================================
-- MMFFDev - vector_artefacts: artefact_types
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 003_artefact_types.sql
--
-- One registry for ALL artefact types in the system. Replaces the split
-- between mmff_vector.o_artefact_types_system / o_artefact_types_tenant
-- and mmff_vector.portfolio_item_types.
--
-- A row in this table answers: "What kind of artefact is it?"
--   scope  - 'work'     : Story, Defect, Task, Epic, ...    (sprint-tracked)
--          - 'strategy' : Theme, Business Objective, Feature, ... (hierarchy)
--   source - 'system'   : Seeded by Vector. Cannot be archived.
--          - 'tenant'   : Created by the tenant. Free to archive.
--
-- For 'strategy' scope, types form a hierarchy via parent_type_id - this is
-- the Rally pattern (a Feature lives under a Business Objective lives under
-- a Theme). Work scope is flat (parent_type_id is always NULL for work).
-- ============================================================

BEGIN;

CREATE TABLE artefact_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Soft FK -> mmff_vector.subscriptions(id). App enforced.
    subscription_id UUID NOT NULL,

    -- Discriminators
    scope           TEXT NOT NULL CHECK (scope  IN ('work', 'strategy')),
    source          TEXT NOT NULL CHECK (source IN ('system', 'tenant')),

    -- Identity
    name            TEXT NOT NULL,                     -- 'Story', 'Feature'
    prefix          TEXT NOT NULL,                     -- 'US', 'FE'
    description     TEXT,

    -- Strategy hierarchy (always NULL for scope='work')
    parent_type_id  UUID REFERENCES artefact_types(id) ON DELETE RESTRICT,
    allows_children BOOLEAN NOT NULL DEFAULT TRUE,
    layer_depth     INTEGER,                           -- 0..9 in 10-layer model

    -- Display order within (subscription, scope)
    sort_order      INTEGER NOT NULL DEFAULT 100,

    -- Lifecycle
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    -- A type's prefix is unique within (subscription, scope) among live rows.
    -- Enforced via partial unique index below (CHECK can't reference subqueries).
    CONSTRAINT artefact_types_layer_depth_range
        CHECK (layer_depth IS NULL OR layer_depth BETWEEN 0 AND 9),
    CONSTRAINT artefact_types_work_no_parent
        CHECK (scope <> 'work' OR parent_type_id IS NULL)
);

-- Live-row uniqueness on prefix per (subscription, scope).
CREATE UNIQUE INDEX artefact_types_prefix_unique_live
    ON artefact_types (subscription_id, scope, prefix)
    WHERE archived_at IS NULL;

-- Lookups by subscription / scope (the dominant query).
CREATE INDEX artefact_types_lookup
    ON artefact_types (subscription_id, scope, sort_order)
    WHERE archived_at IS NULL;

-- Hierarchy walks for strategy types.
CREATE INDEX artefact_types_parent
    ON artefact_types (parent_type_id)
    WHERE parent_type_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER artefact_types_set_updated_at
    BEFORE UPDATE ON artefact_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  artefact_types IS
    'Registry of every artefact type in the system. Both work types (Story, '
    'Defect, Task, ...) and strategy types (Theme, Business Objective, '
    'Feature, ...) live here, distinguished by scope. System rows are seeded '
    'per subscription and cannot be archived; tenant rows are user-created.';
COMMENT ON COLUMN artefact_types.subscription_id IS
    'Soft FK to mmff_vector.subscriptions(id). Enforced by application.';
COMMENT ON COLUMN artefact_types.scope IS
    '''work'' = sprint-tracked execution items; ''strategy'' = hierarchical portfolio items.';
COMMENT ON COLUMN artefact_types.source IS
    '''system'' = Vector-seeded, immutable; ''tenant'' = user-defined.';
COMMENT ON COLUMN artefact_types.parent_type_id IS
    'Strategy hierarchy parent. Always NULL for scope=''work''.';
COMMENT ON COLUMN artefact_types.layer_depth IS
    '0..9 in the 10-layer Rally model. Only set for scope=''strategy''.';

COMMIT;
