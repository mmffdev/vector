-- 168_vector_fields_library_DOWN.sql — rollback. Manual psql only.
BEGIN;
DROP TABLE IF EXISTS vector_fields_library;
COMMIT;
