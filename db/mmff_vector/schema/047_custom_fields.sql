-- Migration 047: Custom field system with entity_kind polymorphic support.
-- Creates item_field_definitions and item_field_values tables for padmin-controlled
-- custom field schemas across portfolio items, user stories, and defects.

-- item_field_definitions: schema catalogue per subscription × entity_kind × item_type
CREATE TABLE item_field_definitions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    entity_kind         TEXT            NOT NULL,  -- 'portfolio_item' | 'user_story' | 'defect'
    item_type_id        UUID,           -- FK scope varies by entity_kind
    custom_field_type   TEXT            NOT NULL,  -- 'text' | 'number' | 'boolean' | 'date' | 'json'
    label               TEXT            NOT NULL,  -- user-facing field name
    description         TEXT,
    required            BOOLEAN         NOT NULL DEFAULT FALSE,
    position            INTEGER,        -- sort order within entity_kind + item_type
    creator_id          UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Constraint: entity_kind must be one of the known artefact types
    CONSTRAINT item_field_definitions_entity_kind_enum CHECK (
        entity_kind IN ('portfolio_item', 'user_story', 'defect')
    ),

    -- Constraint: custom_field_type must be one of the supported types
    CONSTRAINT item_field_definitions_field_type_enum CHECK (
        custom_field_type IN ('text', 'number', 'boolean', 'date', 'json')
    ),

    -- Unique: one custom field label per subscription × entity_kind × item_type (combo)
    CONSTRAINT item_field_definitions_label_unique UNIQUE (subscription_id, entity_kind, item_type_id, label)
);

CREATE INDEX idx_item_field_definitions_subscription
    ON item_field_definitions(subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_item_field_definitions_entity_kind
    ON item_field_definitions(subscription_id, entity_kind)
    WHERE archived_at IS NULL;

CREATE INDEX idx_item_field_definitions_item_type
    ON item_field_definitions(item_type_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_item_field_definitions_updated_at
    BEFORE UPDATE ON item_field_definitions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- item_field_values: per-artefact custom field data with polymorphic entity_id
CREATE TABLE item_field_values (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id         UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    entity_kind             TEXT            NOT NULL,  -- 'portfolio_item' | 'user_story' | 'defect'
    entity_id               UUID            NOT NULL,  -- polymorphic FK: portfolio_items.id | user_stories.id | defects.id
    field_definition_id     UUID            NOT NULL REFERENCES item_field_definitions(id) ON DELETE RESTRICT,

    -- Typed value columns; exactly one will be non-NULL per row
    value_text              TEXT,
    value_number            NUMERIC(19, 4),
    value_boolean           BOOLEAN,
    value_date              DATE,
    value_jsonb             JSONB,

    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Constraint: entity_kind must match field_definition entity_kind
    CONSTRAINT item_field_values_entity_kind_enum CHECK (
        entity_kind IN ('portfolio_item', 'user_story', 'defect')
    ),

    -- Constraint: exactly one typed value is non-NULL
    CONSTRAINT item_field_values_single_value CHECK (
        (value_text IS NOT NULL)::int +
        (value_number IS NOT NULL)::int +
        (value_boolean IS NOT NULL)::int +
        (value_date IS NOT NULL)::int +
        (value_jsonb IS NOT NULL)::int = 1
    )
);

CREATE INDEX idx_item_field_values_subscription
    ON item_field_values(subscription_id);

CREATE INDEX idx_item_field_values_entity_kind
    ON item_field_values(subscription_id, entity_kind);

CREATE INDEX idx_item_field_values_entity_id
    ON item_field_values(entity_kind, entity_id);

CREATE INDEX idx_item_field_values_field_definition
    ON item_field_values(field_definition_id);

CREATE TRIGGER trg_item_field_values_updated_at
    BEFORE UPDATE ON item_field_values
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Comments
COMMENT ON TABLE item_field_definitions IS
    'Padmin-controlled custom field schema catalogue per subscription × entity_kind × item_type. entity_kind discriminator enables single table for portfolio_item, user_story, defect custom fields.';

COMMENT ON TABLE item_field_values IS
    'Per-artefact custom field data with typed value columns (value_text, value_number, value_boolean, value_date, value_jsonb). entity_kind + entity_id form a polymorphic FK to the correct artefact table. Exactly one value column is non-NULL per row (enforced by constraint).';
