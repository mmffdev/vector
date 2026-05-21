-- Migration 234: Fix two avatar-bucket page rows whose icon keys are
-- not recognised by NavIcon (app/components/nav_primary_rail_NavPageIcons.tsx).
--
-- The rail's icon catalogue uses a switch on the icon string; unknown
-- keys fall through to the default empty-circle glyph. Two rows shipped
-- with placeholder keys that pre-date the catalogue:
--
--   preferences-navigation : icon='route'  → 'navigation' (compass arrow)
--   theme                  : icon='theme'  → 'palette'    (paint palette)
--
-- Both replacement keys already exist in NavIcon (see grep output above
-- the migration). Idempotent: gated by icon-value WHERE filter so re-runs
-- after a manual fix-up are no-ops.

BEGIN;

UPDATE pages
   SET icon       = 'navigation',
       updated_at = NOW()
 WHERE key_enum = 'preferences-navigation'
   AND icon     = 'route';

UPDATE pages
   SET icon       = 'palette',
       updated_at = NOW()
 WHERE key_enum = 'theme'
   AND icon     = 'theme';

COMMIT;
