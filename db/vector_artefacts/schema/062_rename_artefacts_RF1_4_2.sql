-- RF1.4.2.artefacts — pluralise child tables in the artefacts family.
-- artefacts itself is unchanged (§2.6 root family).
-- Table-rename only — full column-prefix on these tables is the
-- single largest sweep in RF1.4.2 (~460 SQL strings) and is deferred
-- to a follow-up commit.
BEGIN;

ALTER TABLE artefact_types              RENAME TO artefacts_types;
ALTER TABLE artefact_type_fields        RENAME TO artefacts_types_fields;
ALTER TABLE artefact_field_library      RENAME TO artefacts_fields_library;
ALTER TABLE artefact_workspace_fields   RENAME TO workspaces_fields;
ALTER TABLE artefact_field_values       RENAME TO artefacts_fields_values;
ALTER TABLE artefact_number_sequence    RENAME TO artefacts_number_sequences;
ALTER TABLE artefact_adoption_state     RENAME TO artefacts_adoption_states;

COMMIT;
