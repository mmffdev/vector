// Package formlayouts SQL constants.
//
// PLA-0048 / RF1.1.1 — every raw SQL literal lives here (sql.go), not
// inline in service.go. All queries run on vaPool (vector_artefacts).
package formlayouts

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSelectCurrentLayoutByNodeType returns the live PUBLISHED layout row
// for a (topology node, artefact type) pair. pgx.ErrNoRows → ErrNotFound.
//
// SERVER IS THE GATE — the runtime form renderer reaches the live layout
// through this query. The explicit is_draft = FALSE predicate is
// belt-and-braces: drafts already have is_current = FALSE (so the
// is_current predicate alone excludes them), but pinning is_draft = FALSE
// here means no future query path can ever leak a half-built draft into a
// live form, even if the is_current invariant regresses.
const sqlSelectCurrentLayoutByNodeType = `
	SELECT topology_node_form_layouts_id,
	       topology_node_form_layouts_id_topology_node,
	       topology_node_form_layouts_id_artefact_type,
	       topology_node_form_layouts_id_workspace,
	       topology_node_form_layouts_version,
	       topology_node_form_layouts_is_current,
	       topology_node_form_layouts_is_draft,
	       topology_node_form_layouts_layout_json,
	       topology_node_form_layouts_created_at,
	       topology_node_form_layouts_updated_at
	  FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2
	   AND topology_node_form_layouts_is_current
	   AND topology_node_form_layouts_is_draft = FALSE
	 LIMIT 1`

// sqlSelectDraftByNodeType returns the WIP draft row for a (node, type)
// pair (at most one — guarded by uq_topology_node_form_layouts_draft).
// The builder's draft-aware load tries this first, falling back to the
// published current. The runtime NEVER calls this.
const sqlSelectDraftByNodeType = `
	SELECT topology_node_form_layouts_id,
	       topology_node_form_layouts_id_topology_node,
	       topology_node_form_layouts_id_artefact_type,
	       topology_node_form_layouts_id_workspace,
	       topology_node_form_layouts_version,
	       topology_node_form_layouts_is_current,
	       topology_node_form_layouts_is_draft,
	       topology_node_form_layouts_layout_json,
	       topology_node_form_layouts_created_at,
	       topology_node_form_layouts_updated_at
	  FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2
	   AND topology_node_form_layouts_is_draft
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
	       topology_node_form_layouts_is_draft,
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
	       tf.artefacts_types_fields_required,
	       tf.artefacts_types_fields_is_compulsory
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

// sqlSelectTypeSlotScope resolves an artefact type's slot + scope so the
// builder can scope its core-field catalogue per type (a Defect never sees
// strategic columns; an Epic never sees Steps-to-Reproduce). slot is NULL
// for strategy types — scanned into a sql.NullString. Subscription-scoped
// for defence-in-depth (the type id is tenant-private, but a cross-tenant
// enumerating UUID must still come back empty → pgx.ErrNoRows).
//
// $1 = artefact_type_id (uuid); $2 = subscription_id (uuid).
const sqlSelectTypeSlotScope = `
	SELECT artefacts_types_slot, artefacts_types_scope
	  FROM artefacts_types
	 WHERE artefacts_types_id = $1
	   AND artefacts_types_id_subscription = $2
	   AND artefacts_types_archived_at IS NULL
	 LIMIT 1`

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

// sqlUpsertDraft inserts or replaces the single draft row for a (node,
// type). A draft does NOT burn a version (version pinned to 0 — drafts are
// not part of the monotonic published sequence), does NOT set is_current,
// and is flagged is_draft=TRUE. ON CONFLICT targets the partial unique
// index uq_topology_node_form_layouts_draft so re-saving a draft overwrites
// the layout_json in place rather than accumulating rows. updated_at is
// bumped by the table's BEFORE UPDATE trigger.
//
// $1 node, $2 type, $3 workspace, $4 layout_json, $5 created_by.
const sqlUpsertDraft = `
	INSERT INTO topology_node_form_layouts (
		topology_node_form_layouts_id_topology_node,
		topology_node_form_layouts_id_artefact_type,
		topology_node_form_layouts_id_workspace,
		topology_node_form_layouts_version,
		topology_node_form_layouts_layout_json,
		topology_node_form_layouts_is_current,
		topology_node_form_layouts_is_draft,
		topology_node_form_layouts_created_by
	) VALUES ($1,$2,$3,0,$4,FALSE,TRUE,$5)
	ON CONFLICT (
		topology_node_form_layouts_id_topology_node,
		topology_node_form_layouts_id_artefact_type
	) WHERE topology_node_form_layouts_is_draft
	DO UPDATE SET
		topology_node_form_layouts_layout_json = EXCLUDED.topology_node_form_layouts_layout_json,
		topology_node_form_layouts_id_workspace = EXCLUDED.topology_node_form_layouts_id_workspace,
		topology_node_form_layouts_created_by = EXCLUDED.topology_node_form_layouts_created_by
	RETURNING topology_node_form_layouts_id`

// sqlDeleteDraft removes the draft row for a (node, type), if any. Called
// when a layout is PUBLISHED (Save layout) — the draft is superseded by the
// new published version, so it must not linger and reload over the live one.
//
// $1 node, $2 type.
const sqlDeleteDraft = `
	DELETE FROM topology_node_form_layouts
	 WHERE topology_node_form_layouts_id_topology_node = $1
	   AND topology_node_form_layouts_id_artefact_type = $2
	   AND topology_node_form_layouts_is_draft`
