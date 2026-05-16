-- DOWN for vector_artefacts/053_topology_commits.sql
-- Drops the topology_commits table. Pair with mmff_vector down for 180.
--
-- Recovery path: re-run vector_artefacts/053 to recreate; restore data
-- from backup if rows existed (none on dev pre-cutover).

BEGIN;

DROP TABLE IF EXISTS topology_commits CASCADE;

COMMIT;
