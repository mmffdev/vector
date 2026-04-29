-- ============================================================
-- MMFFDev - Vector: user_stories table
-- Migration 043 — applied on top of 042_theme_pack_drop_check.sql
--
-- Stores user story artefacts. One row per user story per tenant.
-- Tenant isolation: subscription_id on every row.
-- Human-readable ID: rendered at display time as <tag>-<key_num>
--   (e.g. US-00000001) using key_num from subscription_sequence.
--
-- Fields derived from R008 field catalogue.
-- ============================================================

BEGIN;

CREATE TABLE user_stories (
    -- Identity
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id             UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num                     BIGINT      NOT NULL CHECK (key_num > 0),
    type_id                     UUID        NOT NULL REFERENCES execution_item_types(id) ON DELETE RESTRICT,

    -- Hierarchy — FK to portfolio_items added in migration 043b once that table exists
    hierarchy_parent            UUID,

    -- Core fields
    name                        TEXT        NOT NULL,
    description                 TEXT,
    acceptance_criteria         TEXT,
    notes                       TEXT,

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
    affects_doc                 BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Planning
    sprint                      UUID,       -- FK to iterations (table not yet built)
    release                     UUID,       -- FK to releases (table not yet built)
    estimate_points             NUMERIC(6,1),
    estimate_hours              NUMERIC(8,2),
    estimate_remaining          NUMERIC(8,2),
    rank                        TEXT        NOT NULL DEFAULT '',

    -- Risk
    risk_score                  NUMERIC(5,2),
    risk_impact                 TEXT        CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
    risk_probability            TEXT        CHECK (risk_probability IN ('low', 'medium', 'high')),

    -- Visual identifier (lidentifier system)
    lidentifier_colour          TEXT,
    lidentifier_type            TEXT,

    -- Rollup counts (materialised via event-driven increment/decrement)
    count_child_tasks           INTEGER     NOT NULL DEFAULT 0 CHECK (count_child_tasks >= 0),
    count_child_defects         INTEGER     NOT NULL DEFAULT 0 CHECK (count_child_defects >= 0),
    count_child_test_cases      INTEGER     NOT NULL DEFAULT 0 CHECK (count_child_test_cases >= 0),

    -- Computed status summaries (materialised)
    test_case_status            TEXT        CHECK (test_case_status IN ('none', 'passed', 'failed', 'mixed')),
    defect_status               TEXT        CHECK (defect_status IN ('none', 'open', 'fixed', 'mixed')),

    -- Timestamps
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at                 TIMESTAMPTZ,

    CONSTRAINT user_stories_key_unique UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_user_stories_subscription_id  ON user_stories(subscription_id);
CREATE INDEX idx_user_stories_type_id          ON user_stories(subscription_id, type_id);
CREATE INDEX idx_user_stories_hierarchy_parent ON user_stories(hierarchy_parent) WHERE hierarchy_parent IS NOT NULL;
CREATE INDEX idx_user_stories_active           ON user_stories(subscription_id) WHERE archived_at IS NULL;
CREATE INDEX idx_user_stories_schedule_state   ON user_stories(subscription_id, schedule_state) WHERE archived_at IS NULL;
CREATE INDEX idx_user_stories_sprint           ON user_stories(sprint) WHERE sprint IS NOT NULL;

CREATE TRIGGER trg_user_stories_updated_at
    BEFORE UPDATE ON user_stories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
