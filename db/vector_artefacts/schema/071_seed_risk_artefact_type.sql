-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 1
-- Migration 071 — seed Risk system artefact type (scope=work)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 071_seed_risk_artefact_type.sql
--
-- Adds Risk as the 5th system work-scope artefact type, mirroring Defect's
-- shape exactly. Direct INSERT pattern — does NOT use seed_system_artefact_types()
-- since that function still references pre-RF1.4.4 column names (filed as
-- TD-SEED-FN-DRIFT, S2). Follows mig 041's direct-INSERT precedent.
--
-- Idempotent via ON CONFLICT on the live unique index
-- uq_artefacts_types_prefix_live (subscription, scope, prefix where archived_at IS NULL).
--
-- Scope: inserts ONE Risk row for the live dev subscription (…0001). The
-- fixture subscriptions (22 of them, no human users) are NOT seeded —
-- PLA-0052 Story 7 (migration 077) handles per-workspace adoption backfill
-- if and when fixture subs are revived.
--
-- Flow + states + transitions: handled by migration 073 (Risk Flow) and
-- 074 (Risk State) — this migration only creates the artefacts_types row.
--
-- Sole writer (post-migration): portfoliomodels.adopt_work_types (existing
-- generic mirror — no code change needed, verified by Agent A in the
-- PLA-0052 grill sweep).
-- ============================================================

BEGIN;

-- Risk row for the live dev subscription.
-- Workspace anchor: a4df2e21-… is the system dev workspace (same as Defect).
-- Sort order 25 slots Risk between Defect (20) and Task (30).
-- Colour #dc2626 (red) — domain-appropriate, doesn't collide with Defect indigo.
INSERT INTO artefacts_types (
    artefacts_types_id_subscription,
    artefacts_types_id_workspace,
    artefacts_types_scope,
    artefacts_types_source,
    artefacts_types_name,
    artefacts_types_prefix,
    artefacts_types_sort_order,
    artefacts_types_colour,
    artefacts_types_allows_children,
    artefacts_types_description
)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'a4df2e21-8d9a-452b-b4f9-eded455381c8'::uuid,
    'work',
    'system',
    'Risk',
    'RSK',
    25,
    '#dc2626',
    TRUE,
    'A risk to delivery, security, compliance, or operations. Tracked with severity × probability scoring and a mitigation lifecycle.'
)
ON CONFLICT (
    artefacts_types_id_subscription,
    artefacts_types_scope,
    artefacts_types_prefix
) WHERE artefacts_types_archived_at IS NULL DO NOTHING;

-- Sanity check: the row exists post-INSERT (DO block raises if missing).
DO $$
DECLARE
    v_risk_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_risk_count
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL;

    IF v_risk_count <> 1 THEN
        RAISE EXCEPTION 'Migration 071 sanity check failed: expected exactly 1 Risk row, found %', v_risk_count;
    END IF;
END
$$;

COMMIT;
