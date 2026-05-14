-- mmff_vector: drop shadow copy of master_record_tenant
-- 2026-05-13 — PLA-0023 P2 (mmff_vector → vector_artefacts consolidation)
--
-- master_record_tenant exists in both databases. The canonical copy now
-- lives on vector_artefacts (mig 036, artefacts_schema), with:
--   - PK renamed tenant_id → workspace_id
--   - FKs dropped (cross-DB app-enforced)
--   - tenantsettings.New(tenantSettingsPool) wires to vaPool since
--     backend/cmd/server/main.go:419-425 was updated at M2 cutover
--
-- The mmff_vector copy is a stale shadow: tenant_updated_at on VA
-- (2026-05-10 01:31) is newer than on mmff_vector (2026-05-10 01:11),
-- confirming VA has been the sole write target since at least that date.
-- No data needs copying — the VA row is already live.
--
-- The FKs on the mmff_vector copy (→ subscriptions, → users) were
-- not present on the VA copy and are not needed: the service enforces
-- tenant isolation at the application layer.

BEGIN;

DROP TABLE IF EXISTS master_record_tenant CASCADE;

COMMIT;
