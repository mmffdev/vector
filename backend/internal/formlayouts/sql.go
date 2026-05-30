// Package formlayouts SQL constants.
//
// PLA-0048 / RF1.1.1 — every raw SQL literal lives here (sql.go), not
// inline in service.go. All queries run on vaPool (vector_artefacts).
package formlayouts

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSelectCurrentLayoutByNodeType returns the live layout row for a
// (topology node, artefact type) pair. pgx.ErrNoRows → ErrNotFound.
const sqlSelectCurrentLayoutByNodeType = `
	SELECT topology_node_form_layouts_id,
	       topology_node_form_layouts_id_topology_node,
	       topology_node_form_layouts_id_artefact_type,
	       topology_node_form_layouts_id_workspace,
	       topology_node_form_layouts_version,
	       topology_node_form_layouts_is_current,
	       topology_node_form_layouts_layout_json,
	       topology_node_form_layouts_created_at,
	       topology_node_form_layouts_updated_at
	  FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2
	   AND topology_node_form_layouts_is_current
	 LIMIT 1`

// sqlSelectLayoutByID returns one specific version row (the runtime
// resolves an artefact's stamped artefacts_id_form_layout through this).
const sqlSelectLayoutByID = `
	SELECT topology_node_form_layouts_id,
	       topology_node_form_layouts_id_topology_node,
	       topology_node_form_layouts_id_artefact_type,
	       topology_node_form_layouts_id_workspace,
	       topology_node_form_layouts_version,
	       topology_node_form_layouts_is_current,
	       topology_node_form_layouts_layout_json,
	       topology_node_form_layouts_created_at,
	       topology_node_form_layouts_updated_at
	  FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id = $1
	 LIMIT 1`

// sqlNextLayoutVersion computes max(version)+1 for a (node, type) — the
// monotonic version assigned to the next saved layout.
const sqlNextLayoutVersion = `
	SELECT COALESCE(MAX(topology_node_form_layouts_version), 0) + 1
	  FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2`

// sqlRetireCurrentLayout flips the prior current row for a (node, type)
// to is_current=false ahead of inserting the new version.
const sqlRetireCurrentLayout = `
	UPDATE topology_node_form_layouts
	   SET topology_node_form_layouts_is_current = FALSE
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2
	   AND topology_node_form_layouts_is_current`

// sqlListCustomFieldsForType returns the custom fields bound to an
// artefact type, for the builder sidebar's Custom section. Scoped by
// subscription (defence-in-depth — the type id is tenant-private but a
// cross-tenant enumerating UUID must still come back empty). Mirrors
// artefactitems.sqlListFieldsForType's join shape.
//
// $1 = artefact_type_id (uuid); $2 = subscription_id (uuid).
const sqlListCustomFieldsForType = `
	SELECT fl.artefacts_fields_library_id::text,
	       fl.artefacts_fields_library_field_name,
	       fl.artefacts_fields_library_label,
	       fl.artefacts_fields_library_field_type,
	       tf.artefacts_types_fields_required
	  FROM artefacts_types_fields tf
	  JOIN artefacts_fields_library fl
	    ON fl.artefacts_fields_library_id = tf.artefacts_types_fields_id_field_library
	  JOIN artefacts_types at
	    ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
	 WHERE tf.artefacts_types_fields_id_artefact_type = $1
	   AND at.artefacts_types_id_subscription = $2
	   AND fl.artefacts_fields_library_archived_at IS NULL
	   AND at.artefacts_types_archived_at IS NULL
	 ORDER BY tf.artefacts_types_fields_position ASC,
	          fl.artefacts_fields_library_field_name ASC`

// sqlInsertLayout inserts a new current version row and returns its id.
const sqlInsertLayout = `
	INSERT INTO topology_node_form_layouts (
		topology_node_form_layouts_id_topology_node,
		topology_node_form_layouts_id_artefact_type,
		topology_node_form_layouts_id_workspace,
		topology_node_form_layouts_version,
		topology_node_form_layouts_layout_json,
		topology_node_form_layouts_is_current,
		topology_node_form_layouts_created_by
	) VALUES ($1,$2,$3,$4,$5,TRUE,$6)
	RETURNING topology_node_form_layouts_id`
