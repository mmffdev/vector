-- mmff_vector: drop roles_org_nodes — superseded by topology_role_grants on VA
-- 2026-05-13 — PLA-0023 P4 pass (mmff_vector → vector_artefacts consolidation)
--
-- roles_org_nodes (0 rows) — the legacy per-node role-grant table from the
-- pre-M6.2.7 orgdesign era. The M6.2.7 cutover moved all role-grant writes
-- to vector_artefacts.topology_role_grants, which carries the same invariants
-- with updated column names (role → role_code, subscription_id → workspace_id)
-- and a FK to topology_nodes.
--
-- Full repo scan (2026-05-13) found 0 Go/TS readers outside test teardowns.
-- 0 inbound FKs. topology_role_grants on VA also has 0 rows (no grants seeded
-- on dev) — both tables are empty, VA is the write target going forward.

BEGIN;

DROP TABLE IF EXISTS roles_org_nodes CASCADE;

COMMIT;
