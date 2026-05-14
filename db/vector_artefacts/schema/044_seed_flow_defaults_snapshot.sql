-- ============================================================
-- FLOW1.5.1 — Canonical "factory default" flow snapshot per artefact type.
--
-- Rewritten 2026-05-10: previous version copied live flows, which
-- captured tenant-added pills (UI Review / UX Review / DBA Review on
-- Defect; UI UX Review on Epic; Funding Gate 1 on Portfolio Objective).
-- That made Reset a no-op for any flow whose snapshot was polluted.
--
-- The snapshot is now hardcoded: 5-pill canonical for every type, with
-- Task as the 3-pill exception (no Backlog, no Accepted) per 042 step 6.
--
-- Canonical 5-pill shape:
--   Backlog (backlog, sort 10, initial)
--   To Do   (todo,    sort 20, pullable)
--   Doing   (in_progress, sort 30)
--   Completed (done,  sort 40)
--   Accepted  (accepted, sort 50)
-- + 8 transitions (forward + backward).
--
-- Canonical 3-pill Task shape:
--   To Do (todo, sort 10, initial + pullable)
--   Doing (in_progress, sort 20)
--   Completed (done, sort 30)
-- + 4 transitions (forward + backward).
--
-- Idempotent: TRUNCATE first, then rebuild. flow_defaults.id is taken
-- from the live default flow row so reset_load.go's join on flow id
-- still resolves without an extra mapping table.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 044_seed_flow_defaults_snapshot.sql
-- ============================================================

BEGIN;

TRUNCATE flow_defaults CASCADE;

-- ---------- 1. flow_defaults — one row per artefact type, id = live default flow id

INSERT INTO flow_defaults (id, artefact_type_id, name, description)
SELECT f.id, f.artefact_type_id, f.name, f.description
FROM   flows f
JOIN   artefact_types at ON at.id = f.artefact_type_id
WHERE  f.is_default = TRUE
  AND  f.archived_at IS NULL
  AND  at.prefix <> '__P';  -- skip the Pending re-classification placeholder

-- ---------- 2. Canonical 5-pill set — every type EXCEPT Task

WITH five_pill_types AS (
    SELECT fd.id AS flow_default_id
    FROM   flow_defaults fd
    JOIN   artefact_types at ON at.id = fd.artefact_type_id
    WHERE  at.prefix IN ('BC','BE','DE','EP','FE','PO','SO','US')
), inserted AS (
    INSERT INTO flow_state_defaults (flow_default_id, name, kind, sort_order, is_initial, is_pullable)
    SELECT flow_default_id, p.name, p.kind, p.sort_order, p.is_initial, p.is_pullable
    FROM   five_pill_types
    CROSS JOIN (VALUES
        ('Backlog',   'backlog',     10, TRUE,  FALSE),
        ('To Do',     'todo',        20, FALSE, TRUE),
        ('Doing',     'in_progress', 30, FALSE, FALSE),
        ('Completed', 'done',        40, FALSE, FALSE),
        ('Accepted',  'accepted',    50, FALSE, FALSE)
    ) AS p(name, kind, sort_order, is_initial, is_pullable)
    RETURNING id, flow_default_id, name
)
INSERT INTO flow_transition_defaults (flow_default_id, from_state_id, to_state_id)
SELECT i_from.flow_default_id, i_from.id, i_to.id
FROM   inserted i_from
JOIN   inserted i_to ON i_to.flow_default_id = i_from.flow_default_id
JOIN   (VALUES
    ('Backlog',   'To Do'),
    ('To Do',     'Doing'),
    ('Doing',     'Completed'),
    ('Completed', 'Accepted'),
    ('To Do',     'Backlog'),
    ('Doing',     'To Do'),
    ('Completed', 'Doing'),
    ('Accepted',  'Completed')
) AS edges(from_name, to_name)
    ON edges.from_name = i_from.name
   AND edges.to_name   = i_to.name;

-- ---------- 3. Task — 3-pill set (no Backlog, no Accepted)

WITH task_type AS (
    SELECT fd.id AS flow_default_id
    FROM   flow_defaults fd
    JOIN   artefact_types at ON at.id = fd.artefact_type_id
    WHERE  at.prefix = 'TA'
), inserted AS (
    INSERT INTO flow_state_defaults (flow_default_id, name, kind, sort_order, is_initial, is_pullable)
    SELECT flow_default_id, p.name, p.kind, p.sort_order, p.is_initial, p.is_pullable
    FROM   task_type
    CROSS JOIN (VALUES
        ('To Do',     'todo',        10, TRUE,  TRUE),
        ('Doing',     'in_progress', 20, FALSE, FALSE),
        ('Completed', 'done',        30, FALSE, FALSE)
    ) AS p(name, kind, sort_order, is_initial, is_pullable)
    RETURNING id, flow_default_id, name
)
INSERT INTO flow_transition_defaults (flow_default_id, from_state_id, to_state_id)
SELECT i_from.flow_default_id, i_from.id, i_to.id
FROM   inserted i_from
JOIN   inserted i_to ON i_to.flow_default_id = i_from.flow_default_id
JOIN   (VALUES
    ('To Do',     'Doing'),
    ('Doing',     'Completed'),
    ('Doing',     'To Do'),
    ('Completed', 'Doing')
) AS edges(from_name, to_name)
    ON edges.from_name = i_from.name
   AND edges.to_name   = i_to.name;

COMMIT;
