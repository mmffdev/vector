-- DOWN for migration 137: restore obj_work_items and obj_work_items_field_values
--
-- WARNING: This restores the empty table shell only. Data is NOT restored —
-- the source of truth is now vector_artefacts.artefacts. Only apply this
-- DOWN if you need to temporarily un-drop the tables for a hotfix; data
-- must be re-backfilled separately if needed.

BEGIN;

CREATE TABLE IF NOT EXISTS obj_work_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL,
    kind                TEXT        NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT,
    status              TEXT        NOT NULL DEFAULT 'open',
    priority            TEXT,
    story_points        INTEGER,
    sprint_id           UUID,
    backlog_position    INTEGER,
    sprint_position     INTEGER,
    parent_id           UUID,
    key_num             BIGINT,
    due_date            DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS obj_work_items_field_values (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id        UUID        NOT NULL REFERENCES obj_work_items(id) ON DELETE CASCADE,
    field_library_id    UUID        NOT NULL,
    value_text          TEXT,
    value_int           INTEGER,
    value_bool          BOOLEAN,
    value_date          DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
