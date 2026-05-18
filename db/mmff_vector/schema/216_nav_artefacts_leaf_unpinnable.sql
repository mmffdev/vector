-- 216_nav_artefacts_leaf_unpinnable.sql
--
-- The three artefact leaf pages now live inside the ws-artefacts shell.
-- They should not appear as independent nav items — only the shell
-- (ws-artefacts) shows in the rail. Unpin and mark non-pinnable.

BEGIN;

UPDATE pages
   SET pinnable      = FALSE,
       default_pinned = FALSE
 WHERE key_enum IN ('ws-artefact-types', 'ws-transition-rules', 'ws-flow-states-v2')
   AND subscription_id IS NULL
   AND created_by IS NULL;

COMMIT;
