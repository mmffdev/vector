-- RF1.4.2.flows — pluralise flow_* root family.
-- Table rename only; column-prefix on these tables deferred (column
-- names like flow_id / state_key / kind / colour are referenced
-- across the flows package, portfoliomodels saga, artefactitemsv2 work
-- items, and frontend — out of scope for this commit).
BEGIN;

ALTER TABLE flow_states              RENAME TO flows_states;
ALTER TABLE flow_transitions         RENAME TO flows_transitions;
ALTER TABLE flow_state_exit_rules    RENAME TO flows_states_exit_rules;
ALTER TABLE flow_defaults            RENAME TO flows_defaults;
ALTER TABLE flow_state_defaults      RENAME TO flows_states_defaults;
ALTER TABLE flow_transition_defaults RENAME TO flows_transitions_defaults;

COMMIT;
