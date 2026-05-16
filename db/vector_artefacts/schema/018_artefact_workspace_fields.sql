-- ============================================================
-- MMFFDev - vector_artefacts: M3 (PLA-0026 / story 00478)
-- artefact_workspace_fields — workspace whitelist for scope='workspace' fields
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 018_artefact_workspace_fields.sql
--
-- Per R047 §4.4: when an artefact_field_library row carries scope='workspace',
-- this join table is the *only* way the field becomes visible to a workspace.
-- Absence of a row means exclusion (deny-by-default), which is the audit
-- primitive procurement reviewers need: "field X is admissible in workspace
-- A but not B" is a discrete row, not an inferred property.
--
-- workspace_id is a cross-DB reference to mmff_vector.workspaces.id; no
-- enforced FK because the source-of-truth lives in another database. The
-- canary test (PLA-0026 T6) substitutes for the FK.
-- ============================================================

BEGIN;

CREATE TABLE artefact_workspace_fields (
    -- Cross-DB reference to mmff_vector.workspaces.id; app-enforced.
    workspace_id      UUID NOT NULL,

    -- Hard FK to the field definition. CASCADE so archiving / removing a
    -- field definition cleans up the whitelist rows in lock-step.
    field_library_id  UUID NOT NULL
        REFERENCES artefact_field_library(id) ON DELETE CASCADE,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- User who admitted the field; soft FK to mmff_vector.users.id.
    created_by        UUID,

    PRIMARY KEY (workspace_id, field_library_id)
);

-- Reverse lookup: "which workspaces may use this field?" Used by the
-- archive-flow audit and by saga clean-up when a field is being removed.
CREATE INDEX idx_awf_field
    ON artefact_workspace_fields (field_library_id);

COMMENT ON TABLE artefact_workspace_fields IS
    'Whitelist for artefact_field_library rows with scope=''workspace''. '
    'A row admits the field into the workspace; absence excludes it. '
    'workspace_id and created_by are cross-DB soft references to '
    'mmff_vector.workspaces and mmff_vector.users respectively.';
COMMENT ON COLUMN artefact_workspace_fields.workspace_id IS
    'Cross-DB reference to mmff_vector.workspaces.id (app-enforced; canary '
    'test PLA-0026 T6 stands in for the FK).';
COMMENT ON COLUMN artefact_workspace_fields.created_by IS
    'User who whitelisted the field. Soft FK to mmff_vector.users.id.';

COMMIT;
