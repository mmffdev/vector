-- TD-NAV-001 (2026-05-14) — Dev Tools bucket is currently visible to any
-- user with the `dev_tools` page-role grant, regardless of env. Once we
-- deploy to staging or prod, dev-only nav groups should automatically
-- hide unless BACKEND_ENV == 'dev'.
--
-- Adds pages_tags_env_only (nullable):
--   NULL    → visible in every env (default)
--   'dev'   → only visible when BACKEND_ENV == 'dev'
--   future env values can be added without schema change.
--
-- Then tags the dev_tools bucket as env_only='dev'.

ALTER TABLE pages_tags
  ADD COLUMN IF NOT EXISTS pages_tags_env_only TEXT NULL;

COMMENT ON COLUMN pages_tags.pages_tags_env_only IS
  'TD-NAV-001: env restriction. NULL = visible everywhere; ''dev'' = only when BACKEND_ENV=dev.';

UPDATE pages_tags
SET pages_tags_env_only = 'dev'
WHERE pages_tags_tag_enum = 'dev_tools';
