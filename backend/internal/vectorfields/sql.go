package vectorfields

// sqlContextForType returns the CUSTOM field bindings for a (tenant,
// entity_kind, type) scope, including NULL-type universal bindings. Core
// fields are layered in Go (from columns.go), as in formlayouts today.
//
// $1 = tenant id; $2 = entity_kind; $3 = entity_type id.
const sqlContextForType = `
  SELECT l.vector_fields_library_id::text,
         l.vector_fields_library_name,
         l.vector_fields_library_label,
         l.vector_fields_library_type,
         c.vector_fields_context_required,
         c.vector_fields_context_is_compulsory,
         c.vector_fields_context_position
    FROM vector_fields_context c
    JOIN vector_fields_library l
      ON l.vector_fields_library_id = c.vector_fields_context_id_field
   WHERE c.vector_fields_context_id_tenant = $1
     AND c.vector_fields_context_entity_kind = $2
     AND (c.vector_fields_context_id_entity_type = $3
          OR c.vector_fields_context_id_entity_type IS NULL)
     AND l.vector_fields_library_archived_at IS NULL
   ORDER BY c.vector_fields_context_position ASC,
            l.vector_fields_library_name ASC`
