-- mmff_vector: drop the obj_flow_* legacy family
-- 2026-05-13 — PLA-0023 P0' (mmff_vector → vector_artefacts consolidation)
--
-- Four tables, all dead-leaf at the Go/TS layer (full-repo scan
-- 2026-05-13 — only hits are comment-only docstrings in
-- backend/internal/artefactitemsv2/types.go lines 36 + 296 referring
-- to the legacy substrate as historical context).
--
-- obj_flow_tenant (277 rows) — superseded by vector_artefacts.flows /
--   flow_states / flow_transitions. Pre-PoC tenant-scoped flow rows;
--   the flow-engine cutover (PLA-0023) moved every live reader to
--   vaPool. 0 inbound FKs.
--
-- canonical_states (5 rows) — the canonical state vocabulary that
--   obj_flow_tenant referenced. Replaced by flow_states.kind on VA.
--
-- obj_execution_types (7 rows) — pre-PoC strategy-vs-work split. The
--   work/strategy distinction now lives in vector_artefacts.artefact_types.
--
-- obj_execution_types_tenant (0 rows) — tenant override table, never
--   populated post-PoC.
--
-- Drop order (FK-respecting): the two tenant tables first (they hold
-- the FKs pointing into the catalogue tables), then the catalogues.
-- CASCADE catches any stray view/policy refs.

BEGIN;

DROP TABLE IF EXISTS obj_execution_types_tenant CASCADE;
DROP TABLE IF EXISTS obj_flow_tenant CASCADE;
DROP TABLE IF EXISTS canonical_states CASCADE;
DROP TABLE IF EXISTS obj_execution_types CASCADE;

COMMIT;
