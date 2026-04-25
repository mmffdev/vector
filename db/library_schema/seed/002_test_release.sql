-- ============================================================
-- MMFFDev - mmff_library SEED: Phase 3 test release (info severity)
-- Run against the mmff_library database AS mmff_library_admin:
--   docker exec -i mmff-ops-postgres psql -U mmff_library_admin -d mmff_library < seed/002_test_release.sql
--
-- Seeds a single info-severity release for the MMFF Standard family v1.
-- Lets the reconciler / handler tests work against a known-good row
-- without a real release artifact landing.
--
-- Idempotent: ON CONFLICT DO NOTHING + fixed UUIDs guard re-runs.
-- ============================================================

BEGIN;

INSERT INTO library_releases (
    id,
    library_version,
    title,
    summary_md,
    body_md,
    severity,
    audience_tier,
    audience_subscription_ids,
    affects_model_family_id
) VALUES (
    '00000000-0000-0000-0000-00000000ad01'::uuid,
    '2026.04.0',
    'MMFF Standard v1 published',
    'The MMFF Standard portfolio model is live. Adopt it from Settings → Portfolio model.',
    NULL,
    'info',
    NULL,                                                       -- all tiers
    NULL,                                                       -- all subscriptions
    '00000000-0000-0000-0000-00000000a000'::uuid                -- MMFF family
)
ON CONFLICT (library_version, title) DO NOTHING;

INSERT INTO library_release_actions (
    id,
    release_id,
    action_key,
    label,
    payload,
    sort_order
) VALUES (
    '00000000-0000-0000-0000-00000000ae01'::uuid,
    '00000000-0000-0000-0000-00000000ad01'::uuid,
    'dismissed',
    'Dismiss',
    '{}'::jsonb,
    0
)
ON CONFLICT (release_id, action_key) DO NOTHING;

-- Audit row — exercises the INSERT-only contract of library_release_log.
-- library_release_log has no natural unique key (each application is a
-- distinct event), so guard re-runs by checking for an existing row
-- with the same (file_name, sha256) before inserting.
INSERT INTO library_release_log (
    library_version,
    release_id,
    file_name,
    sha256
)
SELECT
    '2026.04.0',
    '00000000-0000-0000-0000-00000000ad01'::uuid,
    'seed/002_test_release.sql',
    'seed-only-no-checksum'
WHERE NOT EXISTS (
    SELECT 1 FROM library_release_log
    WHERE file_name = 'seed/002_test_release.sql'
      AND sha256 = 'seed-only-no-checksum'
);

COMMIT;
