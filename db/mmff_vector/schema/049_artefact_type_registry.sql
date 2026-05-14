-- ============================================================
-- MMFFDev - Vector: Artefact type registry + subscription overrides
-- Migration 049 — applied on top of 048_item_field_options.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 049_artefact_type_registry.sql
--
-- Two-table sequence-scope pattern (R010 Q8 = Option C):
--   o_artefact_type_registry             — system-owned, seeded by migrations.
--                                          scope_key is stable forever (code references this).
--   o_subscription_artefact_type_overrides — padmin-mutable display prefix per tenant.
--                                          Renaming 'US' → 'STORY' is a row update here,
--                                          never a schema or sequence change.
--
-- The underlying data stores (scope_key, key_num) only — never the
-- rendered tag string — so renames are instant and zero-migration.
--
-- o_ prefix marks all Vector object tables, distinguishing them from
-- system/extension tables and lookup/config tables.
-- ============================================================

BEGIN;

CREATE TABLE o_artefact_type_registry (
    scope_key            TEXT        PRIMARY KEY,
    artefact_table       TEXT        NOT NULL,
    default_prefix       TEXT        NOT NULL,
    display_label        TEXT        NOT NULL,
    display_label_plural TEXT        NOT NULL,
    description          TEXT,
    phase                TEXT        NOT NULL DEFAULT 'PH-0005',
    is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT o_atr_scope_key_fmt
        CHECK (scope_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT o_atr_prefix_fmt
        CHECK (default_prefix ~ '^[A-Z][A-Z0-9]{0,7}$')
);

CREATE TABLE o_subscription_artefact_type_overrides (
    subscription_id      UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    scope_key            TEXT        NOT NULL REFERENCES o_artefact_type_registry(scope_key) ON DELETE CASCADE,
    display_prefix       TEXT        NOT NULL,
    display_label        TEXT        NOT NULL,
    display_label_plural TEXT        NOT NULL,
    updated_by           UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (subscription_id, scope_key),

    CONSTRAINT o_sato_prefix_fmt
        CHECK (display_prefix ~ '^[A-Z][A-Z0-9]{0,7}$')
);

CREATE INDEX idx_o_sato_sub
    ON o_subscription_artefact_type_overrides (subscription_id);

COMMIT;
