-- ============================================================
-- 193_universal_page_grants_admin_roles.sql
--
-- Grants gadmin + padmin visibility to every system page in
-- pages. Eliminates the patchwork of per-page role grants for the
-- two admin roles so testing isn't blocked by missing entries.
--
-- For 'user' role nothing changes — keeps the existing curated
-- grant set (17 pages of customer-facing surface).
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run after any
-- new page INSERT.
--
-- Future: this could become a Postgres trigger fn that auto-grants
-- gadmin + padmin on every new pages INSERT, but for now one-shot
-- migration + a checklist item in the seed/page-add process is
-- enough.
-- ============================================================

BEGIN;

INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role, users_roles_pages_role)
SELECT p.id, r.users_roles_id, r.users_roles_code::user_role
  FROM pages p
  CROSS JOIN users_roles r
 WHERE p.created_by IS NULL
   AND p.subscription_id IS NULL
   AND r.users_roles_is_system = TRUE
   AND r.users_roles_code IN ('gadmin', 'padmin')
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_role) DO NOTHING;

-- Wipe the lazy-seeded prefs so the backfill re-runs against the
-- new wider grant set on next nav request.
DELETE FROM users_nav_profiles;

DO $$
DECLARE g_count int; p_count int; total int;
BEGIN
    SELECT COUNT(*) INTO total FROM pages WHERE created_by IS NULL AND subscription_id IS NULL;
    SELECT COUNT(*) INTO g_count FROM users_roles_pages WHERE users_roles_pages_role = 'gadmin';
    SELECT COUNT(*) INTO p_count FROM users_roles_pages WHERE users_roles_pages_role = 'padmin';
    IF g_count <> total OR p_count <> total THEN
        RAISE EXCEPTION 'universal grant incomplete: total=% gadmin=% padmin=%', total, g_count, p_count;
    END IF;
END $$;

COMMIT;
