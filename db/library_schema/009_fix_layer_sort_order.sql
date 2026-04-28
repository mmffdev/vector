-- Fix portfolio_model_layers sort_order: all bundled models were seeded with
-- ascending order (root=10, leaf=50) but the portfolio layers table renders
-- descending (highest sort_order = top = most strategic).  Reverse so each
-- root layer has the highest value and each leaf the lowest.

-- MMFF model  (PRW→PR→BO→TH→FT)
UPDATE portfolio_model_layers SET sort_order = 50 WHERE id = '00000000-0000-0000-0000-00000000ab01'::uuid;  -- PRW
UPDATE portfolio_model_layers SET sort_order = 40 WHERE id = '00000000-0000-0000-0000-00000000ab02'::uuid;  -- PR
-- BO (ab03) was 30; new value also 30 — no change needed
UPDATE portfolio_model_layers SET sort_order = 20 WHERE id = '00000000-0000-0000-0000-00000000ab04'::uuid;  -- TH
UPDATE portfolio_model_layers SET sort_order = 10 WHERE id = '00000000-0000-0000-0000-00000000ab05'::uuid;  -- FT

-- Enterprise model  (SO→PO→BE→BC→FE)
UPDATE portfolio_model_layers SET sort_order = 50 WHERE id = '00000000-0000-0000-0000-00000000bb11'::uuid;  -- SO
UPDATE portfolio_model_layers SET sort_order = 40 WHERE id = '00000000-0000-0000-0000-00000000bb12'::uuid;  -- PO
-- BE (bb13) was 30; new value also 30 — no change needed
UPDATE portfolio_model_layers SET sort_order = 20 WHERE id = '00000000-0000-0000-0000-00000000bb14'::uuid;  -- BC
UPDATE portfolio_model_layers SET sort_order = 10 WHERE id = '00000000-0000-0000-0000-00000000bb15'::uuid;  -- FE

-- Rally model  (ST→IN→FE)
UPDATE portfolio_model_layers SET sort_order = 30 WHERE id = '00000000-0000-0000-0000-00000000cc11'::uuid;  -- ST
-- IN (cc12) was 20; new value also 20 — no change needed
UPDATE portfolio_model_layers SET sort_order = 10 WHERE id = '00000000-0000-0000-0000-00000000cc13'::uuid;  -- FE

-- SAFe model  (STH→PBL→PGB→FE)
UPDATE portfolio_model_layers SET sort_order = 40 WHERE id = '00000000-0000-0000-0000-00000000ee11'::uuid;  -- STH
UPDATE portfolio_model_layers SET sort_order = 30 WHERE id = '00000000-0000-0000-0000-00000000ee12'::uuid;  -- PBL
UPDATE portfolio_model_layers SET sort_order = 20 WHERE id = '00000000-0000-0000-0000-00000000ee13'::uuid;  -- PGB
UPDATE portfolio_model_layers SET sort_order = 10 WHERE id = '00000000-0000-0000-0000-00000000ee14'::uuid;  -- FE

-- Flat model (dd) has one layer; single-layer position is irrelevant — no change.
