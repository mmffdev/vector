-- ============================================================
-- MMFFDev - vector_artefacts: flow-state descriptions + per-state exit rules
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 045_flow_state_description_and_exit_rules.sql
--
-- Adds two governance artefacts to each flow_state:
--   1. description (TEXT on flow_states) - long-form prose explaining the state
--   2. exit_rules  (new table)            - ordered named checklist users
--                                           self-attest to before leaving the state.
--                                           System never enforces - this is policy,
--                                           not validation.
-- ============================================================

BEGIN;

-- ---------- flow_states.description ---------------------------------------

ALTER TABLE flow_states
    ADD COLUMN description TEXT;

COMMENT ON COLUMN flow_states.description IS
    'Long-form prose explaining what this state means in this workspace. '
    'Surfaced read-only on the Work Items page and editable on the Flow States page.';

-- ---------- flow_state_exit_rules -----------------------------------------

CREATE TABLE flow_state_exit_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    flow_state_id   UUID NOT NULL REFERENCES flow_states(id) ON DELETE CASCADE,

    sort_order      INTEGER NOT NULL DEFAULT 100,
    name            TEXT    NOT NULL,
    colour          TEXT,   -- hex like '#5B8DEF' or token; NULL inherits state colour at read time

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

CREATE INDEX flow_state_exit_rules_state_idx
    ON flow_state_exit_rules (flow_state_id, sort_order)
    WHERE archived_at IS NULL;

CREATE TRIGGER flow_state_exit_rules_set_updated_at
    BEFORE UPDATE ON flow_state_exit_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE flow_state_exit_rules IS
    'Ordered, named checklist of conditions a user must self-attest to before '
    'moving an artefact out of the parent flow_state. Soft-archivable. '
    'The system does not enforce these rules - they are surfaced for in-band '
    'confirmation only.';

COMMIT;
