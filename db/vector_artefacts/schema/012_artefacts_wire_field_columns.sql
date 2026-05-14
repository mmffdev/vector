-- ============================================================
-- MMFFDev - vector_artefacts: wire-field columns on artefacts
-- Migration 012 — applied on top of 011_seed_system_strategy_types.sql
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 012_artefacts_wire_field_columns.sql
--
-- Adds four first-class columns required to project the production
-- wire shape for work-item list responses (PLA-0023/00461).
--
-- sprint_id is added here as nullable with no FK (the sprints table
-- does not exist yet). Migration 013 adds the sprints table and
-- converts sprint_id into a hard FK.
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN priority      TEXT,
    ADD COLUMN story_points  INTEGER,
    ADD COLUMN due_date      DATE,
    ADD COLUMN sprint_id     UUID;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_priority_valid CHECK (
        priority IS NULL OR priority IN ('critical','high','medium','low')
    ),
    ADD CONSTRAINT artefacts_story_points_nonneg CHECK (
        story_points IS NULL OR story_points >= 0
    );

-- Partial indexes for the three new filterable/sortable columns.
-- (sprint index belongs in 013 after the FK lands.)

CREATE INDEX artefacts_priority
    ON artefacts (priority)
    WHERE archived_at IS NULL;

CREATE INDEX artefacts_due_date
    ON artefacts (due_date)
    WHERE archived_at IS NULL AND due_date IS NOT NULL;

COMMIT;
