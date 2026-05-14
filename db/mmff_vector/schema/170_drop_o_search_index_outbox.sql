-- mmff_vector: drop o_search_index_outbox
-- 2026-05-13 — PLA-0023 P1 (mmff_vector → vector_artefacts consolidation)
--
-- Dead-leaf disposal — `o_search_index_outbox` was the legacy search
-- worker queue. Replaced by `vector_artefacts.artefacts_search_outbox`
-- (artefacts_schema/035) per B7.1.1; the active worker
-- (backend/internal/searchworker/worker.go) reads exclusively from the
-- VA outbox via vaPool.
--
-- Pre-drop verification (run from psql on 2026-05-13):
--   • source rows in mmff_vector.o_search_index_outbox: 0
--   • incoming FKs to o_search_index_outbox: none
--   • Go writers/readers of o_search_index_outbox: 0 (only a
--     historical-context comment in searchworker/worker.go:11
--     mentioning the legacy table)
--   • Replacement on VA: artefacts_search_outbox exists; trigger
--     artefacts_search_enqueue is installed on vector_artefacts.artefacts
--     and the searchworker poll target matches.
--
-- The outgoing FK on o_search_index_outbox.artefact_type → obj_execution_types
-- vanishes with the table; obj_execution_types is itself a P5 drop target.
--
-- The owned sequence o_search_index_outbox_id_seq is dropped automatically
-- by CASCADE (PRIMARY KEY identity sequence).

BEGIN;

DROP TABLE IF EXISTS o_search_index_outbox CASCADE;

COMMIT;
