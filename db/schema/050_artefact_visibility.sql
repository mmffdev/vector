-- ============================================================
-- MMFFDev - Vector: Artefact visibility constants
-- Migration 050 — applied on top of 049_artefact_type_registry.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 050_artefact_visibility.sql
--
-- Lookup table locking in the four visibility levels used on every
-- artefact core table and every _field_values row.
--
--   0 = private    — creator only
--   1 = product    — all members of the scoped product
--   2 = workspace  — all members of the scoped workspace
--   3 = tenant     — all subscription members
--
-- visibility_scope_id on artefact rows carries the product/workspace
-- UUID when level is 1 or 2. At level 0 or 3 it is ignored.
-- ============================================================

BEGIN;

CREATE TABLE o_artefact_visibility_levels (
    level             SMALLINT    PRIMARY KEY,
    name              TEXT        NOT NULL UNIQUE,
    label             TEXT        NOT NULL,
    description       TEXT        NOT NULL,
    requires_scope_id BOOLEAN     NOT NULL,

    CONSTRAINT o_avl_range CHECK (level BETWEEN 0 AND 3)
);

INSERT INTO o_artefact_visibility_levels (level, name, label, description, requires_scope_id) VALUES
    (0, 'private',   'Private',   'Visible to the creator only.',                    FALSE),
    (1, 'product',   'Product',   'Visible to all members of the scoped product.',   TRUE),
    (2, 'workspace', 'Workspace', 'Visible to all members of the scoped workspace.', TRUE),
    (3, 'tenant',    'Tenant',    'Visible to all members of the subscription.',     FALSE);

COMMIT;
