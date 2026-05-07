-- audit_field_library_orphans.sql
-- PLA-0026 / Story 00476 (M1) — Pre-migration audit of vector_artefacts.field_library
--
-- Purpose: gates migration M2 (which renames field_library → artefact_field_library
-- and adds the scope discriminator). Confirms there is no orphaned tenant data
-- that would be silently mis-scoped during the rename.
--
-- Target DB: vector_artefacts
-- Run:       psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
--                 -f dev/scripts/audit_field_library_orphans.sql
-- Exit:      The script never raises; readers compare the printed numbers
--            against the assertions in dev/research/R047-audit-M1.txt.

\echo === [M1] Pre-migration audit of field_library (vector_artefacts) ===
\echo

\echo --- A. Row totals ---
SELECT
  COUNT(*)                                        AS total_rows,
  COUNT(*) FILTER (WHERE archived_at IS NULL)     AS live_rows,
  COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived_rows
FROM field_library;

\echo --- B. NULL-subscription audit (must be 0; column is NOT NULL) ---
SELECT COUNT(*) AS null_subscription_rows
FROM field_library
WHERE subscription_id IS NULL;

\echo --- C. Distinct tenants represented ---
SELECT COUNT(DISTINCT subscription_id) AS distinct_tenants
FROM field_library
WHERE archived_at IS NULL;

\echo --- D. Per-tenant row distribution ---
SELECT subscription_id, COUNT(*) AS rows
FROM field_library
WHERE archived_at IS NULL
GROUP BY subscription_id
ORDER BY rows DESC, subscription_id
LIMIT 50;

\echo --- E. field_name reuse across tenants (global-candidate audit) ---
\echo --- A field_name shared across N tenants is a candidate for scope='global' ---
SELECT field_name,
       COUNT(DISTINCT subscription_id) AS tenants,
       COUNT(*)                        AS total_rows
FROM field_library
WHERE archived_at IS NULL
GROUP BY field_name
HAVING COUNT(DISTINCT subscription_id) > 1
ORDER BY tenants DESC, field_name
LIMIT 100;

\echo --- F. Inbound FK reference counts (dependency audit for M2 rename) ---
SELECT
  (SELECT COUNT(*) FROM artefact_type_fields)    AS atf_rows,
  (SELECT COUNT(*) FROM artefact_field_values)   AS afv_rows;

\echo === [M1] Audit complete ===
