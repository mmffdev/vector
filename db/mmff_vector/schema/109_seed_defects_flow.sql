-- ============================================================
-- MMFFDev - Vector: Seed default flow for execution_defects
-- Migration 109 — applied on top of 108_canonical_states_rename.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 109_seed_defects_flow.sql
--
-- WHY ----------------------------------------------------------
-- Out of the box, defects share the same 5-state flow as
-- execution_work_items: Backlog → Ready → Doing → Completed → Accepted.
-- (Tenants can later customise per-subscription via o_flow_tenant.)
-- ============================================================

BEGIN;

INSERT INTO o_flow_system
    (system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT t.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   o_artefact_types_system t
CROSS  JOIN (VALUES
    (1, 'Backlog',   'backlog',   'Captured but not yet ready to start.'),
    (2, 'Ready',     'ready',     'Acceptance criteria met; ready for someone to pick up.'),
    (3, 'Doing',     'doing',     'Actively being worked on.'),
    (4, 'Completed', 'completed', 'Work finished; awaiting acceptance.'),
    (5, 'Accepted',  'accepted',  'Reviewed and accepted by the requester.')
) AS v(flow_position, name, canonical_code, description)
WHERE  t.scope_key = 'execution_defects'
ON CONFLICT (system_artefact_type_id, flow_position) DO NOTHING;

COMMIT;
