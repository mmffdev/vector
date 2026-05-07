-- DOWN for 024_artefact_types_placeholder.sql (PLA-0026 / 00497).
BEGIN;

DROP INDEX IF EXISTS artefact_types_one_placeholder_per_workspace;

ALTER TABLE artefact_types
    DROP COLUMN IF EXISTS is_placeholder;

COMMIT;
