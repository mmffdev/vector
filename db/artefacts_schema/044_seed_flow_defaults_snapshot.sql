-- ============================================================
-- FLOW1.5.1 — Populate flow_defaults snapshot from live default flows
--
-- The snapshot tables (043) are the canonical "factory default" for
-- the Reset feature. We populate them by copying the current live
-- default flow + its states + its transitions for every artefact_type.
--
-- This must run AFTER all flow corrections (041, 042) so the snapshot
-- captures the right shape.
--
-- Idempotent: clears the snapshot first, then rebuilds.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 044_seed_flow_defaults_snapshot.sql
-- ============================================================

BEGIN;

-- Wipe and rebuild — cascade deletes children.
TRUNCATE flow_defaults CASCADE;

-- ---------- 1. Snapshot the default flow per artefact type ---------------

INSERT INTO flow_defaults (id, artefact_type_id, name, description)
SELECT f.id, f.artefact_type_id, f.name, f.description
FROM   flows f
WHERE  f.is_default = TRUE
  AND  f.archived_at IS NULL;

-- ---------- 2. Snapshot the states for those flows -----------------------
-- Snapshot pk = live pk so transition_defaults can reference them.

INSERT INTO flow_state_defaults (
    id, flow_default_id, name, kind, colour, sort_order, is_initial, is_pullable
)
SELECT  fs.id, fs.flow_id, fs.name, fs.kind, fs.colour, fs.sort_order,
        fs.is_initial, fs.is_pullable
FROM    flow_states fs
JOIN    flow_defaults fd ON fd.id = fs.flow_id
WHERE   fs.archived_at IS NULL;

-- ---------- 3. Snapshot the transitions ----------------------------------

INSERT INTO flow_transition_defaults (
    flow_default_id, from_state_id, to_state_id
)
SELECT  ft.flow_id, ft.from_state_id, ft.to_state_id
FROM    flow_transitions ft
JOIN    flow_defaults fd ON fd.id = ft.flow_id
ON CONFLICT (flow_default_id, from_state_id, to_state_id) DO NOTHING;

COMMIT;
