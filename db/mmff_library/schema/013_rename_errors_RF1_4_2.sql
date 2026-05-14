-- RF1.4.2.errors (library side) — error_codes → errors_codes.
BEGIN;

ALTER TABLE error_codes RENAME TO errors_codes;

ALTER TABLE errors_codes RENAME COLUMN code         TO errors_codes_code;
ALTER TABLE errors_codes RENAME COLUMN severity     TO errors_codes_severity;
ALTER TABLE errors_codes RENAME COLUMN category     TO errors_codes_category;
ALTER TABLE errors_codes RENAME COLUMN user_message TO errors_codes_user_message;
ALTER TABLE errors_codes RENAME COLUMN dev_message  TO errors_codes_dev_message;
ALTER TABLE errors_codes RENAME COLUMN created_at   TO errors_codes_created_at;

ALTER INDEX idx_error_codes_category RENAME TO idx_errors_codes_category;

-- Rename inline CHECK constraints (auto-named by Postgres in 008).
DO $$
DECLARE
    sev_name text;
    cat_name text;
BEGIN
    SELECT conname INTO sev_name FROM pg_constraint
        WHERE conrelid='errors_codes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%errors_codes_severity%';
    SELECT conname INTO cat_name FROM pg_constraint
        WHERE conrelid='errors_codes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%errors_codes_category%';
    IF sev_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE errors_codes RENAME CONSTRAINT %I TO errors_codes_severity_check', sev_name);
    END IF;
    IF cat_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE errors_codes RENAME CONSTRAINT %I TO errors_codes_category_check', cat_name);
    END IF;
END $$;

COMMIT;
