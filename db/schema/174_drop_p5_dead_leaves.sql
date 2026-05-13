-- mmff_vector: drop two P5 dead-leaf tables
-- 2026-05-13 — PLA-0023 P5 pass (mmff_vector → vector_artefacts consolidation)
--
-- org_node_view_state (0 rows) — superseded by vector_artefacts.topology_view_state
--   (post-M6.2.7 orgdesign cutover). 0 Go/TS readers across full repo scan.
--   0 inbound FKs. The VA copy is what orgdesign.Service writes to.
--
-- user_stories (0 rows) — story-tracker artefact table from a pre-Planka era;
--   Planka is currently suspended and this table was never part of the cutover
--   substrate. 0 Go/TS readers. FK to subscriptions is outbound (not a blocker
--   for the drop — subscriptions stays; we're dropping the leaf).

BEGIN;

DROP TABLE IF EXISTS org_node_view_state CASCADE;
DROP TABLE IF EXISTS user_stories CASCADE;

COMMIT;
