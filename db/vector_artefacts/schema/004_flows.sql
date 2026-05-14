-- ============================================================
-- MMFFDev - vector_artefacts: flows + flow_states + flow_transitions
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 004_flows.sql
--
-- Each artefact_type has zero or more flows defined for it. Exactly one is
-- marked default (is_default = true) and is used when an artefact of that
-- type is created without an explicit flow choice.
--
-- A flow is just a labelled bag of states + allowed transitions:
--   flows               - "Story default flow"
--   flow_states         - To Do | In Progress | In Review | Done | Cancelled
--   flow_transitions    - allowed (from_state, to_state) edges
--
-- Each artefact stores its current flow_state_id directly (see migration 005).
-- ============================================================

BEGIN;

-- ---------- flows ----------------------------------------------------------

CREATE TABLE flows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    artefact_type_id UUID NOT NULL REFERENCES artefact_types(id) ON DELETE RESTRICT,

    name            TEXT NOT NULL,
    description     TEXT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

-- A type has at most one default flow at a time.
CREATE UNIQUE INDEX flows_one_default_per_type
    ON flows (artefact_type_id)
    WHERE is_default = TRUE AND archived_at IS NULL;

CREATE INDEX flows_by_type
    ON flows (artefact_type_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER flows_set_updated_at
    BEFORE UPDATE ON flows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE flows IS
    'A workflow definition for one artefact_type. Bag of states + transitions. '
    'Exactly one flow per type may be is_default=true at a time.';

-- ---------- flow_states ---------------------------------------------------

CREATE TABLE flow_states (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    flow_id         UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,                     -- 'To Do', 'In Progress'

    -- Semantic bucket - drives swimlane positioning, burndown counting, and
    -- "is this artefact done?" without parsing names.
    kind            TEXT NOT NULL CHECK (kind IN ('todo', 'in_progress', 'done', 'cancelled')),

    -- Display
    colour          TEXT,                              -- '#5B8DEF' or token name
    sort_order      INTEGER NOT NULL DEFAULT 100,

    -- Marks the state newly created artefacts default to. Exactly one per
    -- flow may be is_initial=true (enforced by partial unique index below).
    is_initial      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX flow_states_one_initial_per_flow
    ON flow_states (flow_id)
    WHERE is_initial = TRUE AND archived_at IS NULL;

CREATE INDEX flow_states_by_flow
    ON flow_states (flow_id, sort_order)
    WHERE archived_at IS NULL;

CREATE TRIGGER flow_states_set_updated_at
    BEFORE UPDATE ON flow_states
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE flow_states IS
    'States within a flow. ''kind'' is the semantic bucket the state belongs '
    'to (todo / in_progress / done / cancelled), independent of display name.';
COMMENT ON COLUMN flow_states.is_initial IS
    'Default state for newly created artefacts on this flow. Exactly one per flow.';

-- ---------- flow_transitions ----------------------------------------------

CREATE TABLE flow_transitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    flow_id         UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    from_state_id   UUID NOT NULL REFERENCES flow_states(id) ON DELETE CASCADE,
    to_state_id     UUID NOT NULL REFERENCES flow_states(id) ON DELETE CASCADE,

    -- Optional permission code required to execute this transition.
    -- NULL = anyone with edit on the artefact may move it.
    required_permission TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT flow_transitions_no_self
        CHECK (from_state_id <> to_state_id)
);

CREATE UNIQUE INDEX flow_transitions_unique_edge
    ON flow_transitions (flow_id, from_state_id, to_state_id);

CREATE INDEX flow_transitions_by_from_state
    ON flow_transitions (from_state_id);

COMMENT ON TABLE flow_transitions IS
    'Allowed (from_state -> to_state) edges within a flow. Absence of a row '
    'means the transition is not permitted.';

COMMIT;
