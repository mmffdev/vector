-- ============================================================
-- 076 — drop pane_help; carry forward the 5 nav-prefs help rows
--
-- pane_help (table 071) keyed help on a string paneId; the
-- addressable substrate (tables 074/075) keys on addressable UUID.
-- Migrate the 5 existing nav-prefs.* rows then drop pane_help.
--
-- Strategy (option B from the plan discussion):
--   - The /preferences/navigation page is not yet wrapped in <Panel>,
--     so build-reconcile has not seeded page_addressables for those
--     panels. We pre-create them here with source='build' so they are
--     idempotently adopted by build-reconcile when 00255 wraps the
--     page.
--   - For each pane_help row, INSERT into page_addressables (if not
--     already present) and INSERT into page_help with seeded_from
--     ='manual' (CHECK constraint allows library|manual|sdk_manifest;
--     'manual' marks human-authored copy carried over from pane_help).
--   - Map paneId nav-prefs.<x> -> name nav_prefs_<x> (snake_case),
--     kind 'panel', page_route '/preferences/navigation', address
--     samantha._viewport.app._panel.nav_prefs_<x>.
--   - DROP TABLE pane_help.
--
-- Idempotent: rerunning is a no-op (ON CONFLICT DO NOTHING + DROP IF
-- EXISTS).
-- ============================================================

BEGIN;

-- 1) Synthesize 5 page_addressables rows. Use ON CONFLICT against the
--    sibling-unique index (parent_id IS NULL + kind + name) so a
--    repeat run is a no-op and a future build-reconcile against the
--    wrapped page also no-ops.
--    Hyphens in paneid suffix (e.g. 'custom-nav', 'new-group',
--    'new-page') are mapped to underscores so the synthesized name
--    matches the frontend NAME_RE = /^[a-z0-9_]{1,64}$/ rule.
INSERT INTO page_addressables (parent_id, kind, name, address, page_route, source)
SELECT
    NULL                                                                                             AS parent_id,
    'panel'                                                                                          AS kind,
    'nav_prefs_' || replace(split_part(paneid, '.', 2), '-', '_')                                    AS name,
    'samantha._viewport.app._panel.nav_prefs_' || replace(split_part(paneid, '.', 2), '-', '_')      AS address,
    '/preferences/navigation'                                                                        AS page_route,
    'build'                                                                                          AS source
FROM pane_help
WHERE paneid LIKE 'nav-prefs.%'
ON CONFLICT DO NOTHING;

-- 2) Carry the 5 help bodies into page_help, joining the synthesized
--    addressable by address. Skip if a help row already exists for
--    that addressable+locale (idempotent).
INSERT INTO page_help (addressable_id, locale, body_html, seeded_from, updated_at, updated_by_user_id)
SELECT
    pa.id                                               AS addressable_id,
    'en'                                                AS locale,
    ph.body_html                                        AS body_html,
    'manual'                                            AS seeded_from,
    ph.updated_at                                       AS updated_at,
    ph.updated_by_user_id                               AS updated_by_user_id
FROM pane_help ph
JOIN page_addressables pa
    ON pa.address = 'samantha._viewport.app._panel.nav_prefs_' || replace(split_part(ph.paneid, '.', 2), '-', '_')
WHERE ph.paneid LIKE 'nav-prefs.%'
ON CONFLICT DO NOTHING;

-- 3) Drop pane_help. The endpoints (/api/pane-help) return 410 Gone
--    after this migration; route registration is removed in the same
--    PR so no caller can hit dead handlers.
DROP TABLE IF EXISTS pane_help;

COMMIT;
