-- TD-RISK-PAGE-TAG (2026-05-16) — pages row for /risk had tag_enum='strategy'
-- but the Risk-as-row pattern (PLA-0052) puts risks on the work-items
-- surface where the matching /work-items row carries tag_enum='planning'.
-- Reclassify so the rail UX groups risk under the same tag as its host
-- surface.

UPDATE pages
SET tag_enum = 'planning'
WHERE key_enum = 'risk' AND tag_enum = 'strategy';
