-- ============================================================
-- 086 — users.first_name / last_name / department
--
-- Workspace Settings → Users tab now exposes basic profile fields
-- (first/last name + department) editable inline by gadmins. All
-- three are nullable on existing rows — they default to NULL until
-- a gadmin or the user themselves fills them in.
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name  TEXT,
    ADD COLUMN IF NOT EXISTS department TEXT;

CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
CREATE INDEX IF NOT EXISTS idx_users_last_name  ON users(last_name);
