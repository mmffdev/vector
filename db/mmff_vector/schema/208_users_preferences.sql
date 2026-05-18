-- 208_users_preferences.sql
-- Adds per-user namespaced preference storage. Replaces URL-bar query
-- state (filter chips, sort, tab) on /work-items and /portfolio-items.
-- See TD-URL-FILTER-CHIPS + TD-URL-TAB-STATE pay-down notes in
-- docs/c_tech_debt.md and feedback_url_is_path_only.md.
--
-- Storage model: one JSONB column on users, keyed by string namespace
-- (e.g. "workitems.filters", "portfolioitems.sort"). Backend exposes
-- read/write via /_site/me/preferences/{key}. Cross-tenant safe — keyed
-- by user_id which already carries subscription_id.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.preferences IS
  'Per-user namespaced preferences (filter chips, sort, tab state, etc.). '
  'Keyed by string namespace via /_site/me/preferences/{key}. '
  'Replaces URL-bar query state retired by PLA-0053 (feedback_url_is_path_only).';

INSERT INTO schema_migrations (filename) VALUES ('208_users_preferences.sql');

COMMIT;
