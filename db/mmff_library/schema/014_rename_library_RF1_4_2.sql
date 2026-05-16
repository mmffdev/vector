-- RF1.4.2.library (mmff_library side) — pluralise + column-prefix.
BEGIN;

-- ── 1. library_releases stays named library_releases (root family).
-- Apply column-prefix per §2.3.
ALTER TABLE library_releases RENAME COLUMN id                        TO library_releases_id;
ALTER TABLE library_releases RENAME COLUMN library_version           TO library_releases_library_version;
ALTER TABLE library_releases RENAME COLUMN title                     TO library_releases_title;
ALTER TABLE library_releases RENAME COLUMN summary_md                TO library_releases_summary_md;
ALTER TABLE library_releases RENAME COLUMN body_md                   TO library_releases_body_md;
ALTER TABLE library_releases RENAME COLUMN severity                  TO library_releases_severity;
ALTER TABLE library_releases RENAME COLUMN audience_tier             TO library_releases_audience_tier;
ALTER TABLE library_releases RENAME COLUMN audience_subscription_ids TO library_releases_audience_subscription_ids;
ALTER TABLE library_releases RENAME COLUMN affects_model_family_id   TO library_releases_id_model_family;
ALTER TABLE library_releases RENAME COLUMN released_at               TO library_releases_released_at;
ALTER TABLE library_releases RENAME COLUMN expires_at                TO library_releases_expires_at;
ALTER TABLE library_releases RENAME COLUMN archived_at               TO library_releases_archived_at;
ALTER TABLE library_releases RENAME COLUMN created_at                TO library_releases_created_at;
ALTER TABLE library_releases RENAME COLUMN updated_at                TO library_releases_updated_at;

-- Severity CHECK constraint already auto-named `library_releases_severity_check`
-- by Postgres at table creation; no rename needed after the column rename
-- (predicate auto-updates).

-- ── 2. library_release_actions → library_releases_actions.
ALTER TABLE library_release_actions RENAME TO library_releases_actions;
ALTER TABLE library_releases_actions RENAME COLUMN id         TO library_releases_actions_id;
ALTER TABLE library_releases_actions RENAME COLUMN release_id TO library_releases_actions_id_library_release;
ALTER TABLE library_releases_actions RENAME COLUMN action_key TO library_releases_actions_action_key;
ALTER TABLE library_releases_actions RENAME COLUMN label      TO library_releases_actions_label;
ALTER TABLE library_releases_actions RENAME COLUMN payload    TO library_releases_actions_payload;
ALTER TABLE library_releases_actions RENAME COLUMN sort_order TO library_releases_actions_sort_order;
ALTER TABLE library_releases_actions RENAME COLUMN created_at TO library_releases_actions_created_at;
ALTER TABLE library_releases_actions RENAME COLUMN updated_at TO library_releases_actions_updated_at;

DO $$
DECLARE
    fk_name text;
    ak_check text;
    uq_name text;
BEGIN
    SELECT conname INTO fk_name FROM pg_constraint
        WHERE conrelid='library_releases_actions'::regclass AND contype='f';
    SELECT conname INTO ak_check FROM pg_constraint
        WHERE conrelid='library_releases_actions'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%library_releases_actions_action_key%';
    SELECT conname INTO uq_name FROM pg_constraint
        WHERE conrelid='library_releases_actions'::regclass AND contype='u';
    IF fk_name IS NOT NULL THEN EXECUTE format('ALTER TABLE library_releases_actions RENAME CONSTRAINT %I TO library_releases_actions_id_library_release_fkey', fk_name); END IF;
    IF ak_check IS NOT NULL THEN EXECUTE format('ALTER TABLE library_releases_actions RENAME CONSTRAINT %I TO library_releases_actions_action_key_check', ak_check); END IF;
    IF uq_name IS NOT NULL THEN EXECUTE format('ALTER TABLE library_releases_actions RENAME CONSTRAINT %I TO library_releases_actions_id_library_release_action_key_key', uq_name); END IF;
END $$;

-- ── 3. library_release_log → library_release_logs (pluralise; root is library_release_log).
-- Per §2.8: target = library_release_logs (not library_releases_logs); naming spec carries an
-- exception note that this is the file/audit log, not a "release log" sub-resource.
ALTER TABLE library_release_log RENAME TO library_release_logs;
ALTER TABLE library_release_logs RENAME COLUMN id              TO library_release_logs_id;
ALTER TABLE library_release_logs RENAME COLUMN library_version TO library_release_logs_library_version;
ALTER TABLE library_release_logs RENAME COLUMN release_id      TO library_release_logs_id_library_release;
ALTER TABLE library_release_logs RENAME COLUMN file_name       TO library_release_logs_file_name;
ALTER TABLE library_release_logs RENAME COLUMN sha256          TO library_release_logs_sha256;
ALTER TABLE library_release_logs RENAME COLUMN applied_at      TO library_release_logs_applied_at;
ALTER TABLE library_release_logs RENAME COLUMN applied_by      TO library_release_logs_applied_by;

ALTER INDEX idx_library_release_log_version RENAME TO idx_library_release_logs_library_version_applied_at;

DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT conname INTO fk_name FROM pg_constraint
        WHERE conrelid='library_release_logs'::regclass AND contype='f';
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE library_release_logs RENAME CONSTRAINT %I TO library_release_logs_id_library_release_fkey', fk_name);
    END IF;
END $$;

-- ── 4 + 5. portfolio_templates + portfolio_template_layer_definitions:
-- DEFERRED. Spec target `library_portfolio_models` collides with the
-- pre-existing `portfolio_models` family (003_portfolio_model_bundles.sql:
-- portfolio_models + portfolio_model_layers / _workflows /
-- _workflow_transitions / _artifacts / _terminology). Naming spec §2.8
-- does not address the collision; filed for a follow-up that resolves
-- which table set wins the `library_portfolio_models` name. The other
-- four library_* renames in this migration proceed unblocked.

COMMIT;
