-- ============================================================
-- MMFFDev - Vector: defects table
-- Migration 044 — applied on top of 043_user_stories.sql
--
-- Stores defect artefacts. Separate from user_stories because
-- defects carry distinct fields (severity, steps_to_reproduce,
-- environment, browser, regression) and separate counters.
-- Shared fields (name, description, status, etc.) are reproduced
-- rather than joined to avoid cross-type coupling.
--
-- Tenant isolation: subscription_id on every row.
-- Human-readable ID: <tag>-<key_num> rendered at display time.
-- ============================================================

BEGIN;

CREATE TYPE defect_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE defects (
    -- Identity
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id             UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num                     BIGINT      NOT NULL CHECK (key_num > 0),
    type_id                     UUID        NOT NULL REFERENCES execution_item_types(id) ON DELETE RESTRICT,

    -- Hierarchy — FK to portfolio_items / user_stories added when those tables are built
    hierarchy_parent            UUID,
    linked_story                UUID        REFERENCES user_stories(id) ON DELETE SET NULL,

    -- Core fields
    name                        TEXT        NOT NULL,
    description                 TEXT,
    acceptance_criteria         TEXT,
    notes                       TEXT,

    -- Defect-specific fields
    severity                    defect_severity NOT NULL,
    steps_to_reproduce          TEXT,
    environment                 TEXT,
    browser                     TEXT,
    regression                  BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Ownership
    name_author                 UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name_owner                  UUID        REFERENCES users(id) ON DELETE SET NULL,

    -- State
    schedule_state              TEXT        NOT NULL DEFAULT 'defined'
                                    CHECK (schedule_state IN ('defined', 'in_progress', 'completed', 'accepted')),
    flow_state                  UUID,       -- FK to item_type_states added when that table exists
    flow_state_change_update_date TIMESTAMPTZ,
    flow_state_change_owner     UUID        REFERENCES users(id) ON DELETE SET NULL,
    date_work_accepted          TIMESTAMPTZ,

    -- Flags
    blocked                     BOOLEAN     NOT NULL DEFAULT FALSE,
    blocked_reason              TEXT,
    ready                       BOOLEAN     NOT NULL DEFAULT FALSE,
    expedite                    BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Planning
    sprint                      UUID,       -- FK to iterations (table not yet built)
    release                     UUID,       -- FK to releases (table not yet built)
    estimate_hours              NUMERIC(8,2),
    estimate_remaining          NUMERIC(8,2),
    rank                        TEXT        NOT NULL DEFAULT '',

    -- Risk
    risk_score                  NUMERIC(5,2),
    risk_impact                 TEXT        CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),

    -- Visual identifier
    lidentifier_colour          TEXT,
    lidentifier_type            TEXT,

    -- Timestamps
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at                 TIMESTAMPTZ,

    CONSTRAINT defects_key_unique UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_defects_subscription_id   ON defects(subscription_id);
CREATE INDEX idx_defects_type_id           ON defects(subscription_id, type_id);
CREATE INDEX idx_defects_linked_story      ON defects(linked_story) WHERE linked_story IS NOT NULL;
CREATE INDEX idx_defects_severity          ON defects(subscription_id, severity) WHERE archived_at IS NULL;
CREATE INDEX idx_defects_active            ON defects(subscription_id) WHERE archived_at IS NULL;
CREATE INDEX idx_defects_schedule_state    ON defects(subscription_id, schedule_state) WHERE archived_at IS NULL;

CREATE TRIGGER trg_defects_updated_at
    BEFORE UPDATE ON defects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
