-- Migration 048: item_field_options table for select/multiselect custom field vocabularies.
-- Scoped to item_field_definitions with entity_kind + position ordering.

CREATE TABLE item_field_options (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    entity_kind         TEXT            NOT NULL,  -- 'portfolio_item' | 'user_story' | 'defect'
    field_definition_id UUID            NOT NULL REFERENCES item_field_definitions(id) ON DELETE RESTRICT,
    label               TEXT            NOT NULL,  -- display text
    value               TEXT            NOT NULL,  -- stored value
    position            INTEGER,        -- sort order within field_definition
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Constraint: entity_kind must match field_definition entity_kind
    CONSTRAINT item_field_options_entity_kind_enum CHECK (
        entity_kind IN ('portfolio_item', 'user_story', 'defect')
    ),

    -- Unique: one option per field definition per value
    CONSTRAINT item_field_options_value_unique UNIQUE (field_definition_id, value)
);

CREATE INDEX idx_item_field_options_subscription
    ON item_field_options(subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_item_field_options_field_definition
    ON item_field_options(field_definition_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_item_field_options_entity_kind
    ON item_field_options(subscription_id, entity_kind)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_item_field_options_updated_at
    BEFORE UPDATE ON item_field_options
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE item_field_options IS
    'Vocabulary of valid options for select and multiselect custom field types. Scoped to a field_definition with position-based ordering. Soft-archived via archived_at (NULL = live).';
