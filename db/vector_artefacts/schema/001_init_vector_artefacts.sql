-- ============================================================
-- MMFFDev - vector_artefacts: Bootstrap database (Phase 1)
-- Run against the `postgres` database (NOT vector_artefacts):
--   psql -U mmff_dev -d postgres -f 001_init_vector_artefacts.sql
--
-- Creates the vector_artefacts database. Idempotent via SELECT + \gexec --
-- CREATE DATABASE cannot run inside a function or transaction block, so the
-- conditional is built as a meta-command that emits the CREATE statement
-- only when the database is missing.
--
-- This is the third Vector database, alongside:
--   - mmff_vector       : main app (users, workspaces, subscriptions, ...)
--   - mmff_library      : MMFF-authored shared content library (read-only)
--   - vector_artefacts  : THIS DB - unified artefact storage (work + strategy)
--
-- Cross-database FKs are not supported in Postgres. Soft references back to
-- mmff_vector (subscription_id, workspace_id, user_id) are validated by the
-- application layer before insert, mirroring the pattern used by the
-- subscription_layers <-> mmff_library bridge (see db/schema/029).
-- ============================================================

SELECT format(
    'CREATE DATABASE vector_artefacts ENCODING ''UTF8'' LC_COLLATE ''en_US.UTF-8'' LC_CTYPE ''en_US.UTF-8'' TEMPLATE template0'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'vector_artefacts')
\gexec

COMMENT ON DATABASE vector_artefacts IS
    'Unified artefact storage for Vector. Single ''artefacts'' table holds both '
    'work items (epics, stories, tasks, defects) and strategy items (themes, '
    'business objectives, features) - distinguished by artefact_types.scope. '
    'Custom fields via field_library + artefact_type_fields + artefact_field_values. '
    'Cross-DB references to mmff_vector are soft (UUID, app-validated).';
