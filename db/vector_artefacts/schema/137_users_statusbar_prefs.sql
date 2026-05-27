-- ============================================================
-- 137_users_statusbar_prefs.sql
--
-- Per-user preferences for the bottom shell status bar
-- (StatusBarBottom). Stores which data points the user has pinned
-- and in which order.
--
-- WHY:
--   The bottom status bar is a user-configurable strip — the user
--   picks which metrics they want to keep an eye on (blockers,
--   stories in the active meg, tasks, future UI/DB status). Prefs
--   are global per user, not per workspace — a user gets the same
--   pinned data-point set everywhere. The data each point *renders*
--   may still vary per workspace (e.g. clamp-meg-driven counts
--   change as scope changes); only the SELECTION is global.
--
-- IDEMPOTENCY:
--   CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--   Safe to re-run; no seed rows (defaults are resolved client-side
--   when the user has no row yet).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/137_users_statusbar_prefs.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS users_statusbar_prefs (
    users_statusbar_prefs_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    users_statusbar_prefs_user_id      uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    users_statusbar_prefs_data_points  JSONB       NOT NULL,
    users_statusbar_prefs_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One prefs row per user (global, not workspace-scoped).
CREATE UNIQUE INDEX IF NOT EXISTS users_statusbar_prefs_user_uidx
    ON users_statusbar_prefs (users_statusbar_prefs_user_id);

COMMIT;
