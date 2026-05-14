-- ============================================================
-- MMFFDev - vector_artefacts: artefacts (the core storage table)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 005_artefacts.sql
--
-- ONE table for ALL tracked records in the system. Replaces the entire
-- mmff_vector.o_artefacts_execution_*  family AND mmff_vector.portfolio_items.
--
-- The type drives behaviour: a row's artefact_type_id tells you whether it
-- is a Story (work scope, sprint-tracked) or a Feature (strategy scope,
-- hierarchical). Type-specific data that doesn't fit the small "core"
-- column set lives in artefact_field_values via the field_library /
-- artefact_type_fields plumbing (Jira pattern).
--
-- Core columns (kept tight on purpose):
--   - identity        : title, description
--   - relationships   : parent_artefact_id (hierarchy), workspace, subscription
--   - state           : flow_state_id (current state in its flow)
--   - ownership       : created_by, assigned_to, owned_by
--   - ordering        : position (within parent / backlog)
--   - lifecycle       : created_at, updated_at, archived_at
--
-- EVERYTHING ELSE - story_points, sprint, priority, risk, t-shirt size,
-- environment, target_release, etc. - is a custom field. This is the Jira
-- model: a small core + a large flexible-field surface.
-- ============================================================

BEGIN;

CREATE TABLE artefacts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Soft FKs to mmff_vector. App enforced.
    subscription_id   UUID NOT NULL,
    workspace_id      UUID NOT NULL,

    -- Type registry FK (intra-DB, hard-enforced).
    artefact_type_id  UUID NOT NULL REFERENCES artefact_types(id) ON DELETE RESTRICT,

    -- Sequential per-subscription number used to render the public ID
    -- (e.g. prefix='US' + number=42  ->  'US-42'). Unique within
    -- (subscription, type) so each type has its own counter.
    number            BIGINT NOT NULL,

    -- Identity
    title             TEXT NOT NULL,
    description       TEXT,

    -- Hierarchy: a strategy artefact may have a strategy parent (Theme >
    -- Business Objective > Feature). A work artefact may have a strategy
    -- parent (story rolling up to a feature) or another work parent (epic >
    -- story). Self-referencing FK; cycle prevention is app-enforced.
    parent_artefact_id UUID REFERENCES artefacts(id) ON DELETE SET NULL,

    -- Current state in the workflow. NULL = no flow assigned (e.g. brand
    -- new tenant type with no flow yet). flow_state_id implicitly carries
    -- the flow_id and kind via a join.
    flow_state_id     UUID REFERENCES flow_states(id) ON DELETE RESTRICT,

    -- Ownership (soft FKs to mmff_vector.users).
    created_by_user_id UUID,
    assigned_to_user_id UUID,
    owned_by_user_id   UUID,

    -- Ordering within siblings under parent_artefact_id (or under the
    -- (workspace, type) backlog when parent is NULL).
    position          INTEGER NOT NULL DEFAULT 0,

    -- Lifecycle
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at       TIMESTAMPTZ
);

-- Per-type counter uniqueness: every (subscription, type) issues a fresh
-- 1, 2, 3... sequence. App layer reserves the next number atomically.
CREATE UNIQUE INDEX artefacts_number_unique_per_type
    ON artefacts (subscription_id, artefact_type_id, number);

-- Hot-path lookups -----------------------------------------------------------

-- List view: workspace + type + position.
CREATE INDEX artefacts_workspace_type_position
    ON artefacts (workspace_id, artefact_type_id, position)
    WHERE archived_at IS NULL;

-- Hierarchy walks (children of a parent).
CREATE INDEX artefacts_parent
    ON artefacts (parent_artefact_id, position)
    WHERE parent_artefact_id IS NOT NULL AND archived_at IS NULL;

-- "What's assigned to me?"
CREATE INDEX artefacts_assignee
    ON artefacts (assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL AND archived_at IS NULL;

-- Subscription-wide scans (admin / search reindex).
CREATE INDEX artefacts_subscription
    ON artefacts (subscription_id)
    WHERE archived_at IS NULL;

-- Current state column - feeds board / kanban views.
CREATE INDEX artefacts_flow_state
    ON artefacts (flow_state_id)
    WHERE flow_state_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER artefacts_set_updated_at
    BEFORE UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE artefacts IS
    'The single storage table for every tracked record - work items '
    '(stories, defects, tasks, epics) AND strategy items (themes, business '
    'objectives, features). The artefact_type_id determines scope and '
    'behaviour. Type-specific attributes live in artefact_field_values, '
    'not as columns here.';
COMMENT ON COLUMN artefacts.number IS
    'Per-(subscription, type) sequential counter. Combined with the type''s '
    'prefix this produces the public ID (e.g. ''US-42'').';
COMMENT ON COLUMN artefacts.parent_artefact_id IS
    'Hierarchy parent. Strategy items: their layer parent. Work items: '
    'optional rollup target (story under feature, etc.). Cycle prevention '
    'is app-enforced.';
COMMENT ON COLUMN artefacts.flow_state_id IS
    'Current state in the flow assigned to this artefact''s type. NULL = '
    'unassigned (e.g. brand-new tenant type without a flow yet).';

COMMIT;
