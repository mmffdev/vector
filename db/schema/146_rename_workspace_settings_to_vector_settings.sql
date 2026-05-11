-- ============================================================
-- 146_rename_workspace_settings_to_vector_settings.sql
--
-- Rename the sidebar label for the `workspace-settings` page entry
-- from "Workspace Settings" to "Vector Settings".
-- Route key, href and tag are unchanged — label only.
-- ============================================================

UPDATE pages
   SET label = 'Vector Settings'
 WHERE key_enum = 'workspace-settings'
   AND label   = 'Workspace Settings';
