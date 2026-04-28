-- Fix subscription_layers sort_order for layers adopted from system library
-- models.  All bundled models were seeded with ascending sort_order
-- (root=low, leaf=high) but the portfolio layers table renders descending
-- (highest = top = most strategic), so adopted hierarchies appeared reversed.
--
-- Matches rows by source_library_id (the library layer UUID stamped at
-- adoption time) so only subscription-mirrored rows are touched.

UPDATE subscription_layers
   SET sort_order = CASE source_library_id::text
       -- MMFF model
       WHEN '00000000-0000-0000-0000-00000000ab01' THEN 50   -- PRW (root)
       WHEN '00000000-0000-0000-0000-00000000ab02' THEN 40   -- PR
       -- BO (ab03): was 30, stays 30
       WHEN '00000000-0000-0000-0000-00000000ab04' THEN 20   -- TH
       WHEN '00000000-0000-0000-0000-00000000ab05' THEN 10   -- FT (leaf)
       -- Enterprise model
       WHEN '00000000-0000-0000-0000-00000000bb11' THEN 50   -- SO (root)
       WHEN '00000000-0000-0000-0000-00000000bb12' THEN 40   -- PO
       -- BE (bb13): was 30, stays 30
       WHEN '00000000-0000-0000-0000-00000000bb14' THEN 20   -- BC
       WHEN '00000000-0000-0000-0000-00000000bb15' THEN 10   -- FE (leaf)
       -- Rally model
       WHEN '00000000-0000-0000-0000-00000000cc11' THEN 30   -- ST (root)
       -- IN (cc12): was 20, stays 20
       WHEN '00000000-0000-0000-0000-00000000cc13' THEN 10   -- FE (leaf)
       -- SAFe model
       WHEN '00000000-0000-0000-0000-00000000ee11' THEN 40   -- STH (root)
       WHEN '00000000-0000-0000-0000-00000000ee12' THEN 30   -- PBL
       WHEN '00000000-0000-0000-0000-00000000ee13' THEN 20   -- PGB
       WHEN '00000000-0000-0000-0000-00000000ee14' THEN 10   -- FE (leaf)
       ELSE sort_order
   END
 WHERE source_library_id IN (
       '00000000-0000-0000-0000-00000000ab01'::uuid,
       '00000000-0000-0000-0000-00000000ab02'::uuid,
       '00000000-0000-0000-0000-00000000ab04'::uuid,
       '00000000-0000-0000-0000-00000000ab05'::uuid,
       '00000000-0000-0000-0000-00000000bb11'::uuid,
       '00000000-0000-0000-0000-00000000bb12'::uuid,
       '00000000-0000-0000-0000-00000000bb14'::uuid,
       '00000000-0000-0000-0000-00000000bb15'::uuid,
       '00000000-0000-0000-0000-00000000cc11'::uuid,
       '00000000-0000-0000-0000-00000000cc13'::uuid,
       '00000000-0000-0000-0000-00000000ee11'::uuid,
       '00000000-0000-0000-0000-00000000ee12'::uuid,
       '00000000-0000-0000-0000-00000000ee13'::uuid,
       '00000000-0000-0000-0000-00000000ee14'::uuid
   )
   AND archived_at IS NULL;
