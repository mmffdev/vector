-- ============================================================
-- 086_seed_dev_milestones.sql
--
-- Seeds three milestones for the default dev tenant/workspace so the
-- ArtefactInlineForm's Milestone dropdown has values to choose from
-- on first load. Without this, the milestone select renders empty
-- and the surface looks broken in dev.
--
-- WHY:
--   Sister to 052_seed_dev_strategy_artefacts.sql — keeps dev pages
--   populated after MasterReset wipes user-created data.
--
-- IDEMPOTENCY:
--   Each row has a deterministic UUID + ON CONFLICT DO NOTHING.
--   Re-running is a no-op.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/086_seed_dev_milestones_DOWN.sql
-- ============================================================

BEGIN;

INSERT INTO timebox_milestones (
    id, subscription_id, workspace_id,
    milestone_name, milestone_description, milestone_date_target,
    status, position
) VALUES
    (
        '00000000-0000-0000-0000-000000000801'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000010'::uuid,
        'Alpha launch',
        'Internal alpha to seed-customer cohort.',
        CURRENT_DATE + INTERVAL '30 days',
        'planned', 1
    ),
    (
        '00000000-0000-0000-0000-000000000802'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000010'::uuid,
        'Beta launch',
        'Public beta to 100 design partners.',
        CURRENT_DATE + INTERVAL '90 days',
        'planned', 2
    ),
    (
        '00000000-0000-0000-0000-000000000803'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000010'::uuid,
        'GA — General Availability',
        'Open to all paid tiers; finance + defence procurement-ready.',
        CURRENT_DATE + INTERVAL '180 days',
        'planned', 3
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
