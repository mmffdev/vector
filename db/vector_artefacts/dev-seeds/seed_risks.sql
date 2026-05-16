-- Dev-only seed: inject N Risk artefacts assigned to a chosen user.
--
-- Standalone artifact of the same INSERT executed by the Go handler at
-- POST /_site/admin/dev/seed-risks (backend/internal/portfoliomodels/dev_reset.go).
-- Keep them in sync — this file is what you run when the backend is offline.
--
-- Parameters (psql -v):
--   :sub       — subscription_id            (uuid)
--   :ws        — workspace_id               (uuid)  — must own a Risk artefact type
--   :assignee  — user id for created_by/assigned_to/owned_by (uuid)
--   :count     — how many risks to insert   (integer)
--
-- Example:
--   psql "$VECTOR_ARTEFACTS_DB_URL" \
--     -v sub="'00000000-0000-0000-0000-000000000001'" \
--     -v ws="'a4df2e21-8d9a-452b-b4f9-eded455381c8'" \
--     -v assignee="'6cabe266-b2f4-43f9-879c-06020c789a0b'" \
--     -v count=200 \
--     -f db/vector_artefacts/dev-seeds/seed_risks.sql
--
-- Distribution: 5 flow states × 4 priorities, round-robin. All risks are
-- top-level (parent_artefact_id NULL) so they appear on /risk straight away.

WITH params AS (
  SELECT
    :sub::uuid       AS subscription_id,
    :ws::uuid        AS workspace_id,
    :assignee::uuid  AS assignee_id,
    :count::int      AS n
),
risk_type AS (
  SELECT artefacts_types_id
  FROM artefacts_types
  WHERE artefacts_types_id_subscription = (SELECT subscription_id FROM params)
    AND artefacts_types_id_workspace    = (SELECT workspace_id    FROM params)
    AND lower(artefacts_types_name) = 'risk'
    AND artefacts_types_scope = 'work'
    AND artefacts_types_archived_at IS NULL
  LIMIT 1
),
default_flow AS (
  SELECT f.flows_id
  FROM flows f
  WHERE f.flows_id_artefact_type = (SELECT artefacts_types_id FROM risk_type)
    AND f.flows_is_default = TRUE
    AND f.flows_archived_at IS NULL
  LIMIT 1
),
flow_states AS (
  SELECT array_agg(flows_states_id ORDER BY flows_states_sort_order) AS states
  FROM flows_states
  WHERE flows_states_id_flow = (SELECT flows_id FROM default_flow)
    AND flows_states_archived_at IS NULL
),
existing AS (
  SELECT COALESCE(MAX(number), 0) AS max_num
  FROM artefacts
  WHERE artefact_type_id = (SELECT artefacts_types_id FROM risk_type)
    AND subscription_id  = (SELECT subscription_id FROM params)
),
seq AS (SELECT generate_series(1, (SELECT n FROM params)) AS n)
INSERT INTO artefacts (
  subscription_id, workspace_id, artefact_type_id, number, title, description,
  flow_state_id, created_by_user_id, assigned_to_user_id, owned_by_user_id,
  priority
)
SELECT
  p.subscription_id,
  p.workspace_id,
  (SELECT artefacts_types_id FROM risk_type),
  e.max_num + s.n,
  CASE (s.n % 10)
    WHEN 0 THEN 'Unencrypted data at rest in audit logs'
    WHEN 1 THEN 'Single point of failure in payment gateway'
    WHEN 2 THEN 'Vendor dependency on legacy CMS'
    WHEN 3 THEN 'Insufficient capacity for peak season traffic'
    WHEN 4 THEN 'Stale credentials in CI environment'
    WHEN 5 THEN 'Regulatory exposure from GDPR retention gap'
    WHEN 6 THEN 'Key person dependency in platform team'
    WHEN 7 THEN 'Backup restore not tested in 12 months'
    WHEN 8 THEN 'Third-party SDK with known CVE'
    ELSE      'Privileged access without quarterly review'
  END || ' (#' || (e.max_num + s.n)::text || ')',
  'Auto-seeded risk. Severity/likelihood vary to populate the dashboard matrix.',
  (SELECT states[1 + ((s.n - 1) % cardinality(states))] FROM flow_states),
  p.assignee_id,
  p.assignee_id,
  p.assignee_id,
  CASE (s.n % 4)
    WHEN 0 THEN 'critical'
    WHEN 1 THEN 'high'
    WHEN 2 THEN 'medium'
    ELSE      'low'
  END
FROM params p, seq s, existing e;
