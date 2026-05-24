-- ============================================================
-- 244 — users.home_location_follow_mode
--
-- Adds one column to `users`:
--
--   home_location_follow_mode    bool NOT NULL DEFAULT FALSE
--       Controls how the scope rail interacts with the user's
--       persistent home topology node (default_focus_node_id added
--       by migration 243):
--
--         FALSE (default, "Pinned")  — clicking a node in the scope
--           rail changes the SESSION focus only. users.default_focus_node_id
--           is unchanged. The Home Location dropdown on
--           /user/account-settings reflects the stored value.
--
--         TRUE  ("Follow")           — clicking a node in the scope
--           rail ALSO writes the new node into users.default_focus_node_id
--           (via the existing PUT /_site/sentinel/focus handler from
--           commit 19df4e33). The home location "follows" the user.
--
-- WHY:
--   Commit 0fab5d66 shipped the Home Location dropdown but the
--   underlying setFocus() action always persisted, which meant every
--   click in the scope rail silently overwrote the user's stored home.
--   This column lets the user opt INTO that follow behaviour explicitly
--   via a toggle on the account-settings page (built alongside this
--   migration) and keeps the default safe (Pinned).
--
-- DEFAULT:
--   FALSE — the safer choice. A user who picks a home expects it to
--   stay where they put it. Users who want the previous follow
--   behaviour can flip the toggle ON.
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS — safe to re-run on a freshly seeded DB
--   or after a partial roll-out.
--
-- ROLLBACK:
--   db/mmff_vector/schema/down/244_users_home_location_follow_mode_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS home_location_follow_mode boolean NOT NULL DEFAULT FALSE;

COMMIT;
