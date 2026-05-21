-- DOWN for migration 234: restore the placeholder icon keys.

BEGIN;

UPDATE pages
   SET icon       = 'route',
       updated_at = NOW()
 WHERE key_enum = 'preferences-navigation'
   AND icon     = 'navigation';

UPDATE pages
   SET icon       = 'theme',
       updated_at = NOW()
 WHERE key_enum = 'theme'
   AND icon     = 'palette';

COMMIT;
