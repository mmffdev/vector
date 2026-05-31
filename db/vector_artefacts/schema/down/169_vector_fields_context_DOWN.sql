-- 169_vector_fields_context_DOWN.sql — rollback. Manual psql only.
BEGIN;
DROP TABLE IF EXISTS vector_fields_context;
COMMIT;
