-- Drop obj_portfolio_items from mmff_vector.
--
-- PLA-0023 cutover (P5 confirmed):
--   - rows: 0 (verified 2026-05-13 22:55)
--   - backend readers: none (only a stale comment reference in
--     internal/orgdesign/middleware.go — comment only, no query)
--   - inbound FKs: none (no other table references this one)
--   - outbound FKs: drop with the table
--
-- Canonical home for strategic items is now vector_artefacts.artefacts
-- with at.scope = 'strategy', read via vaPool. See docs/c_c_db_routing.md.
--
-- DOWN: db/schema/down/177_drop_obj_portfolio_items_DOWN.sql

BEGIN;

DROP TABLE IF EXISTS obj_portfolio_items;

COMMIT;
