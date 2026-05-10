-- ============================================================
-- FLOW1.5 — Flow defaults snapshot tables
--
-- Frozen "factory default" flows baked into vector_artefacts at seed time
-- so a tenant's "Reset to defaults" button has a local source of truth
-- and does NOT need a runtime cross-DB hop to mmff_library.
--
-- The snapshot mirrors the live triple (flows / flow_states /
-- flow_transitions) but write-once at seed:
--   flow_defaults             — one row per (artefact_type, default flow)
--   flow_state_defaults       — pills the default flow ships with
--   flow_transition_defaults  — allowed edges in the default flow
--
-- Reset semantics: a tenant who edits/removes their live flow can press
-- Reset on a type and the backend reads the matching flow_defaults row
-- + its children, then rewrites the live flow to match (preserving
-- artefact bindings via deterministic walk-back rebinding by sort_order).
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 043_flow_defaults_snapshot.sql
-- ============================================================

BEGIN;

-- ---------- flow_defaults --------------------------------------------------

CREATE TABLE flow_defaults (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    artefact_type_id    UUID NOT NULL REFERENCES artefact_types(id) ON DELETE CASCADE,

    name                TEXT NOT NULL,
    description         TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One default snapshot per artefact type.
CREATE UNIQUE INDEX flow_defaults_one_per_type
    ON flow_defaults (artefact_type_id);

COMMENT ON TABLE flow_defaults IS
    'Frozen factory-default flow per artefact_type, written at seed time. '
    'Read by the Reset path; never mutated at runtime by users.';

-- ---------- flow_state_defaults -------------------------------------------

CREATE TABLE flow_state_defaults (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    flow_default_id     UUID NOT NULL REFERENCES flow_defaults(id) ON DELETE CASCADE,

    name                TEXT NOT NULL,

    -- Same 6-kind primitive as the live flow_states column.
    kind                TEXT NOT NULL CHECK (kind IN
        ('backlog', 'todo', 'in_progress', 'done', 'accepted', 'cancelled')),

    -- Optional display hint; null means "use kind default colour".
    colour              TEXT,

    sort_order          INTEGER NOT NULL DEFAULT 100,

    is_initial          BOOLEAN NOT NULL DEFAULT FALSE,
    is_pullable         BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX flow_state_defaults_one_initial_per_flow
    ON flow_state_defaults (flow_default_id)
    WHERE is_initial = TRUE;

CREATE INDEX flow_state_defaults_by_flow
    ON flow_state_defaults (flow_default_id, sort_order);

COMMENT ON TABLE flow_state_defaults IS
    'Frozen pills for a flow_default. Reset rewrites live flow_states to '
    'match these rows; sort_order is the deterministic key for walk-back '
    'rebinding when a tenant has removed pills since adoption.';

-- ---------- flow_transition_defaults --------------------------------------

CREATE TABLE flow_transition_defaults (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    flow_default_id     UUID NOT NULL REFERENCES flow_defaults(id) ON DELETE CASCADE,
    from_state_id       UUID NOT NULL REFERENCES flow_state_defaults(id) ON DELETE CASCADE,
    to_state_id         UUID NOT NULL REFERENCES flow_state_defaults(id) ON DELETE CASCADE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT flow_transition_defaults_no_self
        CHECK (from_state_id <> to_state_id)
);

CREATE UNIQUE INDEX flow_transition_defaults_unique_edge
    ON flow_transition_defaults (flow_default_id, from_state_id, to_state_id);

CREATE INDEX flow_transition_defaults_by_from
    ON flow_transition_defaults (from_state_id);

COMMENT ON TABLE flow_transition_defaults IS
    'Allowed edges in a flow_default. Reset rewrites flow_transitions to '
    'match these rows.';

COMMIT;
