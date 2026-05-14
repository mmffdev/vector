-- ============================================================
-- 065_flows_family_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (7 of N).
--
-- Applies the §2.3 column-prefix convention to the entire flows_*
-- family (7 tables):
--   • flows
--   • flows_states
--   • flows_transitions
--   • flows_states_exit_rules
--   • flows_defaults
--   • flows_states_defaults
--   • flows_transitions_defaults
--
-- §2.4 FK shapes applied throughout. Index, constraint, and trigger
-- names normalised to the new column names. After this migration:
--   • `flows` package: 26 → 0 findings → OFF the ledger.
--   • cross-readers `portfoliomodels` (adopt_flows) and
--     `artefactitems` (flows_states JOINs on artefacts.flow_state_id)
--     rewritten in the same commit.
--
-- artefacts.flow_state_id (the FK column on the parent table) is NOT
-- renamed here — the artefacts table itself is deferred under
-- TD-NAME-001. The FK constraint targets flows_states.id which is
-- now flows_states_id; the constraint references by Postgres OID so
-- the rename is transparent.
-- ============================================================

BEGIN;

-- ═════════════════════════════════════════════════════════════
-- flows (9 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows RENAME COLUMN id               TO flows_id;
ALTER TABLE flows RENAME COLUMN artefact_type_id TO flows_id_artefact_type;
ALTER TABLE flows RENAME COLUMN name             TO flows_name;
ALTER TABLE flows RENAME COLUMN description      TO flows_description;
ALTER TABLE flows RENAME COLUMN is_default       TO flows_is_default;
ALTER TABLE flows RENAME COLUMN created_at       TO flows_created_at;
ALTER TABLE flows RENAME COLUMN updated_at       TO flows_updated_at;
ALTER TABLE flows RENAME COLUMN archived_at      TO flows_archived_at;
ALTER TABLE flows RENAME COLUMN library_layer_id TO flows_id_library_layer;

-- flows_pkey already correctly named; skip.
ALTER INDEX flows_by_type                RENAME TO idx_flows_id_artefact_type;
ALTER INDEX flows_one_default_per_type   RENAME TO uq_flows_one_default_per_type;
ALTER INDEX idx_flows_library_layer      RENAME TO idx_flows_id_library_layer;

ALTER TABLE flows
    RENAME CONSTRAINT flows_artefact_type_id_fkey TO flows_id_artefact_type_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_states (13 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_states RENAME COLUMN id                  TO flows_states_id;
ALTER TABLE flows_states RENAME COLUMN flow_id             TO flows_states_id_flow;
ALTER TABLE flows_states RENAME COLUMN name                TO flows_states_name;
ALTER TABLE flows_states RENAME COLUMN kind                TO flows_states_kind;
ALTER TABLE flows_states RENAME COLUMN colour              TO flows_states_colour;
ALTER TABLE flows_states RENAME COLUMN sort_order          TO flows_states_sort_order;
ALTER TABLE flows_states RENAME COLUMN is_initial          TO flows_states_is_initial;
ALTER TABLE flows_states RENAME COLUMN created_at          TO flows_states_created_at;
ALTER TABLE flows_states RENAME COLUMN updated_at          TO flows_states_updated_at;
ALTER TABLE flows_states RENAME COLUMN archived_at         TO flows_states_archived_at;
ALTER TABLE flows_states RENAME COLUMN library_workflow_id TO flows_states_id_library_workflow;
ALTER TABLE flows_states RENAME COLUMN is_pullable         TO flows_states_is_pullable;
ALTER TABLE flows_states RENAME COLUMN description         TO flows_states_description;

ALTER INDEX flow_states_pkey                   RENAME TO flows_states_pkey;
ALTER INDEX flow_states_by_flow                RENAME TO idx_flows_states_id_flow;
ALTER INDEX flow_states_one_initial_per_flow   RENAME TO uq_flows_states_one_initial_per_flow;
ALTER INDEX uq_flow_states_flow_lib_workflow   RENAME TO uq_flows_states_flow_id_library_workflow;

ALTER TABLE flows_states
    RENAME CONSTRAINT flow_states_kind_check    TO flows_states_kind_check;
ALTER TABLE flows_states
    RENAME CONSTRAINT flow_states_flow_id_fkey  TO flows_states_id_flow_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_transitions (6 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_transitions RENAME COLUMN id                  TO flows_transitions_id;
ALTER TABLE flows_transitions RENAME COLUMN flow_id             TO flows_transitions_id_flow;
ALTER TABLE flows_transitions RENAME COLUMN from_state_id       TO flows_transitions_id_state_from;
ALTER TABLE flows_transitions RENAME COLUMN to_state_id         TO flows_transitions_id_state_to;
ALTER TABLE flows_transitions RENAME COLUMN required_permission TO flows_transitions_required_permission;
ALTER TABLE flows_transitions RENAME COLUMN created_at          TO flows_transitions_created_at;

ALTER INDEX flow_transitions_pkey            RENAME TO flows_transitions_pkey;
ALTER INDEX flow_transitions_by_from_state   RENAME TO idx_flows_transitions_id_state_from;
ALTER INDEX flow_transitions_unique_edge     RENAME TO uq_flows_transitions_unique_edge;

ALTER TABLE flows_transitions
    RENAME CONSTRAINT flow_transitions_no_self            TO flows_transitions_no_self;
ALTER TABLE flows_transitions
    RENAME CONSTRAINT flow_transitions_flow_id_fkey       TO flows_transitions_id_flow_fkey;
ALTER TABLE flows_transitions
    RENAME CONSTRAINT flow_transitions_from_state_id_fkey TO flows_transitions_id_state_from_fkey;
ALTER TABLE flows_transitions
    RENAME CONSTRAINT flow_transitions_to_state_id_fkey   TO flows_transitions_id_state_to_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_states_exit_rules (8 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_states_exit_rules RENAME COLUMN id            TO flows_states_exit_rules_id;
ALTER TABLE flows_states_exit_rules RENAME COLUMN flow_state_id TO flows_states_exit_rules_id_flow_state;
ALTER TABLE flows_states_exit_rules RENAME COLUMN sort_order    TO flows_states_exit_rules_sort_order;
ALTER TABLE flows_states_exit_rules RENAME COLUMN name          TO flows_states_exit_rules_name;
ALTER TABLE flows_states_exit_rules RENAME COLUMN colour        TO flows_states_exit_rules_colour;
ALTER TABLE flows_states_exit_rules RENAME COLUMN created_at    TO flows_states_exit_rules_created_at;
ALTER TABLE flows_states_exit_rules RENAME COLUMN updated_at    TO flows_states_exit_rules_updated_at;
ALTER TABLE flows_states_exit_rules RENAME COLUMN archived_at   TO flows_states_exit_rules_archived_at;

ALTER INDEX flow_state_exit_rules_pkey      RENAME TO flows_states_exit_rules_pkey;
ALTER INDEX flow_state_exit_rules_state_idx RENAME TO idx_flows_states_exit_rules_id_flow_state;

ALTER TABLE flows_states_exit_rules
    RENAME CONSTRAINT flow_state_exit_rules_flow_state_id_fkey
                   TO flows_states_exit_rules_id_flow_state_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_defaults (5 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_defaults RENAME COLUMN id               TO flows_defaults_id;
ALTER TABLE flows_defaults RENAME COLUMN artefact_type_id TO flows_defaults_id_artefact_type;
ALTER TABLE flows_defaults RENAME COLUMN name             TO flows_defaults_name;
ALTER TABLE flows_defaults RENAME COLUMN description      TO flows_defaults_description;
ALTER TABLE flows_defaults RENAME COLUMN created_at       TO flows_defaults_created_at;

ALTER INDEX flow_defaults_pkey             RENAME TO flows_defaults_pkey;
ALTER INDEX flow_defaults_one_per_type     RENAME TO uq_flows_defaults_one_per_type;

ALTER TABLE flows_defaults
    RENAME CONSTRAINT flow_defaults_artefact_type_id_fkey TO flows_defaults_id_artefact_type_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_states_defaults (9 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_states_defaults RENAME COLUMN id              TO flows_states_defaults_id;
ALTER TABLE flows_states_defaults RENAME COLUMN flow_default_id TO flows_states_defaults_id_flow_default;
ALTER TABLE flows_states_defaults RENAME COLUMN name            TO flows_states_defaults_name;
ALTER TABLE flows_states_defaults RENAME COLUMN kind            TO flows_states_defaults_kind;
ALTER TABLE flows_states_defaults RENAME COLUMN colour          TO flows_states_defaults_colour;
ALTER TABLE flows_states_defaults RENAME COLUMN sort_order      TO flows_states_defaults_sort_order;
ALTER TABLE flows_states_defaults RENAME COLUMN is_initial      TO flows_states_defaults_is_initial;
ALTER TABLE flows_states_defaults RENAME COLUMN is_pullable     TO flows_states_defaults_is_pullable;
ALTER TABLE flows_states_defaults RENAME COLUMN created_at      TO flows_states_defaults_created_at;

ALTER INDEX flow_state_defaults_pkey                     RENAME TO flows_states_defaults_pkey;
ALTER INDEX flow_state_defaults_by_flow                  RENAME TO idx_flows_states_defaults_id_flow_default;
ALTER INDEX flow_state_defaults_one_initial_per_flow     RENAME TO uq_flows_states_defaults_one_initial_per_flow;

ALTER TABLE flows_states_defaults
    RENAME CONSTRAINT flow_state_defaults_kind_check
                   TO flows_states_defaults_kind_check;
ALTER TABLE flows_states_defaults
    RENAME CONSTRAINT flow_state_defaults_flow_default_id_fkey
                   TO flows_states_defaults_id_flow_default_fkey;

-- ═════════════════════════════════════════════════════════════
-- flows_transitions_defaults (5 columns)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE flows_transitions_defaults RENAME COLUMN id              TO flows_transitions_defaults_id;
ALTER TABLE flows_transitions_defaults RENAME COLUMN flow_default_id TO flows_transitions_defaults_id_flow_default;
ALTER TABLE flows_transitions_defaults RENAME COLUMN from_state_id   TO flows_transitions_defaults_id_state_from;
ALTER TABLE flows_transitions_defaults RENAME COLUMN to_state_id     TO flows_transitions_defaults_id_state_to;
ALTER TABLE flows_transitions_defaults RENAME COLUMN created_at      TO flows_transitions_defaults_created_at;

ALTER INDEX flow_transition_defaults_pkey         RENAME TO flows_transitions_defaults_pkey;
ALTER INDEX flow_transition_defaults_by_from      RENAME TO idx_flows_transitions_defaults_id_state_from;
ALTER INDEX flow_transition_defaults_unique_edge  RENAME TO uq_flows_transitions_defaults_unique_edge;

ALTER TABLE flows_transitions_defaults
    RENAME CONSTRAINT flow_transition_defaults_no_self                TO flows_transitions_defaults_no_self;
ALTER TABLE flows_transitions_defaults
    RENAME CONSTRAINT flow_transition_defaults_flow_default_id_fkey   TO flows_transitions_defaults_id_flow_default_fkey;
ALTER TABLE flows_transitions_defaults
    RENAME CONSTRAINT flow_transition_defaults_from_state_id_fkey     TO flows_transitions_defaults_id_state_from_fkey;
ALTER TABLE flows_transitions_defaults
    RENAME CONSTRAINT flow_transition_defaults_to_state_id_fkey       TO flows_transitions_defaults_id_state_to_fkey;

-- ═════════════════════════════════════════════════════════════
-- Trigger rewrites — three tables use generic set_updated_at()
-- which now can't find NEW.updated_at.
-- ═════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS flows_set_updated_at                   ON flows;
DROP TRIGGER IF EXISTS flow_states_set_updated_at             ON flows_states;
DROP TRIGGER IF EXISTS flow_state_exit_rules_set_updated_at   ON flows_states_exit_rules;

CREATE OR REPLACE FUNCTION fn_flows_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.flows_updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION fn_flows_states_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.flows_states_updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION fn_flows_states_exit_rules_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.flows_states_exit_rules_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_flows_touch_updated_at
BEFORE UPDATE ON flows FOR EACH ROW
EXECUTE FUNCTION fn_flows_touch_updated_at();

CREATE TRIGGER trg_flows_states_touch_updated_at
BEFORE UPDATE ON flows_states FOR EACH ROW
EXECUTE FUNCTION fn_flows_states_touch_updated_at();

CREATE TRIGGER trg_flows_states_exit_rules_touch_updated_at
BEFORE UPDATE ON flows_states_exit_rules FOR EACH ROW
EXECUTE FUNCTION fn_flows_states_exit_rules_touch_updated_at();

COMMIT;
