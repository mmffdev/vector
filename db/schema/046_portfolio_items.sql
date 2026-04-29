-- Migration 046: portfolio_items unified table with R007 scalar fields.
-- First creates portfolio_item_types catalogue (prerequisite for type_id FK).
-- Then consolidates portfolio and product hierarchy into a single portfolio_items table
-- with self-referencing parent_id and comprehensive metadata fields per R007.

-- portfolio_item_types: per-subscription catalogue of portfolio item types
-- (e.g., Feature, Initiative, Theme). Similar to execution_item_types pattern.
CREATE TABLE portfolio_item_types (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    name            TEXT            NOT NULL CHECK (length(trim(name)) > 0),
    description     TEXT,
    icon            TEXT,
    colour          TEXT,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT portfolio_item_types_name_unique UNIQUE (subscription_id, name)
);

CREATE INDEX idx_portfolio_item_types_subscription ON portfolio_item_types(subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_portfolio_item_types_updated_at
    BEFORE UPDATE ON portfolio_item_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- portfolio_items: unified portfolio item artefact table
CREATE TABLE portfolio_items (
    id                              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id                 UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num                         BIGINT          NOT NULL,
    type_id                         UUID            NOT NULL REFERENCES portfolio_item_types(id) ON DELETE RESTRICT,

    -- Hierarchy
    hierarchy_parent                UUID            REFERENCES portfolio_items(id) ON DELETE RESTRICT,

    -- Core metadata
    name                            TEXT            NOT NULL CHECK (length(trim(name)) > 0),
    description                     TEXT,
    acceptance_criteria             TEXT,
    notes                           TEXT,

    -- Ownership & authorship
    name_author                     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name_owner                      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Flow state & blocking
    flow_state                      UUID,            -- FK to item_type_states (not yet created; will be added later)
    flow_state_change_update_date   TIMESTAMPTZ,
    flow_state_change_owner         UUID            REFERENCES users(id) ON DELETE SET NULL,
    blocked                         BOOLEAN         NOT NULL DEFAULT FALSE,
    blocked_reason                  TEXT,

    -- Planning dates
    date_work_planned_start         DATE,
    date_work_planned_finish        DATE,
    date_work_started               TIMESTAMPTZ,
    date_work_accepted              TIMESTAMPTZ,

    -- Estimation
    estimate_initial                TEXT,
    estimate_updated                NUMERIC(10, 2),

    -- Risk assessment
    risk_impact                     TEXT,
    risk_probability                TEXT,
    risk_score                      NUMERIC(5, 2),

    -- Strategic classification
    strategic_investment_group      TEXT,
    strategic_investment_weight     TEXT,
    strategic_item_type             TEXT,
    value_stream_identifier         TEXT,

    -- Visual identifier (lidentifier) system
    lidentifier_colour              TEXT,
    lidentifier_labels              TEXT[],
    lidentifier_tags                TEXT[],

    -- Rollup counts (computed/materialised; nullable until first compute)
    count_child_defects             INTEGER,
    count_child_user_stories        INTEGER,
    count_dependants                INTEGER,
    count_rollup_defect             INTEGER,
    count_rollup_defects            INTEGER,
    count_rollup_estimation         NUMERIC(10, 2),
    count_rollup_risks              INTEGER,
    done_by_story_count             NUMERIC(5, 2),

    -- Soft archive
    archived_at                     TIMESTAMPTZ,

    -- Timestamps
    created_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT portfolio_items_key_num_unique UNIQUE (subscription_id, key_num),
    CONSTRAINT portfolio_items_planned_dates_order CHECK (
        date_work_planned_start IS NULL OR
        date_work_planned_finish IS NULL OR
        date_work_planned_start <= date_work_planned_finish
    ),
    CONSTRAINT portfolio_items_blocked_reason_requires_blocked CHECK (
        blocked = TRUE OR blocked_reason IS NULL
    ),
    CONSTRAINT portfolio_items_lidentifier_colour_hex CHECK (
        lidentifier_colour IS NULL OR
        lidentifier_colour ~ '^#[0-9a-fA-F]{6}$'
    ),
    CONSTRAINT portfolio_items_strategic_weight_enum CHECK (
        strategic_investment_weight IS NULL OR
        strategic_investment_weight IN ('low', 'medium', 'high')
    )
);

-- Indexes
CREATE INDEX idx_portfolio_items_subscription ON portfolio_items(subscription_id) WHERE archived_at IS NULL;
CREATE INDEX idx_portfolio_items_type ON portfolio_items(type_id) WHERE archived_at IS NULL;
CREATE INDEX idx_portfolio_items_parent ON portfolio_items(hierarchy_parent) WHERE archived_at IS NULL;
CREATE INDEX idx_portfolio_items_owner ON portfolio_items(name_owner) WHERE archived_at IS NULL;
CREATE INDEX idx_portfolio_items_flow_state ON portfolio_items(flow_state) WHERE archived_at IS NULL;
CREATE INDEX idx_portfolio_items_created_at ON portfolio_items(subscription_id, created_at DESC) WHERE archived_at IS NULL;

-- Unique index for key_num already covered by constraint above.

-- Trigger for updated_at
CREATE TRIGGER trg_portfolio_items_updated_at
    BEFORE UPDATE ON portfolio_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Comments documenting design
COMMENT ON TABLE portfolio_item_types IS
    'Per-subscription catalogue of portfolio item type definitions. Similar to execution_item_types pattern. Types control flow_state workflows and custom field availability.';

COMMENT ON TABLE portfolio_items IS
    'Unified portfolio item artefact table per R007. Hierarchy via self-referencing parent_id (hierarchy_parent). Key_num allocated atomically from subscription_sequence(scope=POR). Soft-archived via archived_at (NULL = live). Rollup counts (count_*) computed/materialised on child work-item writes. flow_state_change_owner and flow_state_change_update_date are maintained by state-change handlers (not triggers). Future: item-level discussions (discussion_threads entity_kind=portfolio_item); custom field values (item_field_values portfolio_item_id FK).';
