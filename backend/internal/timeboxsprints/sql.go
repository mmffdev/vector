// Package timeboxsprints SQL constants.
//
// PLA-0048 / RF1.2.10 (consts) + RF1.4.2.timeboxes (column-prefix rule,
// migration 054). Sole writer for timeboxes_sprints (vector_artefacts).
package timeboxsprints

// Hydrate column-list — used in every SELECT/RETURNING for this table.
// Single source of truth so the column order in Scan() matches.
const sprintCols = `
		timeboxes_sprints_id,
		timeboxes_sprints_id_subscription,
		timeboxes_sprints_id_workspace,
		timeboxes_sprints_id_topology_node,
		timeboxes_sprints_name,
		timeboxes_sprints_suffix,
		timeboxes_sprints_id_user_owner,
		timeboxes_sprints_cadence_days,
		timeboxes_sprints_date_start::text,
		timeboxes_sprints_date_end::text,
		timeboxes_sprints_scope,
		timeboxes_sprints_velocity,
		timeboxes_sprints_estimate,
		timeboxes_sprints_creep_by_count,
		timeboxes_sprints_creep_by_estimate,
		timeboxes_sprints_status,
		timeboxes_sprints_created_at,
		timeboxes_sprints_updated_at,
		timeboxes_sprints_archived_at
	`

// sqlInsertSprint creates a new sprint and returns the hydrated row.
// Slice 5A — scope_propagation is the 11th input column. Caller passes
// either the explicit value or COALESCEs to the DB default
// ('this_node_only') via NULL.
const sqlInsertSprint = `
		INSERT INTO timeboxes_sprints (
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start,
			timeboxes_sprints_date_end,
			timeboxes_sprints_velocity,
			timeboxes_sprints_scope_propagation
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'this_node_only'))
		RETURNING
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
	`

// sqlSelectSprintByID returns one live sprint scoped to workspace.
const sqlSelectSprintByID = `
		SELECT
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
		FROM timeboxes_sprints
		WHERE timeboxes_sprints_id = $1
		  AND timeboxes_sprints_id_workspace = $2
		  AND timeboxes_sprints_archived_at IS NULL
	`

// sqlListSprintsTemplate is the dynamic list query — %s holds the
// composed WHERE clause built from List filters.
const sqlListSprintsTemplate = `
		SELECT
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
		FROM timeboxes_sprints
		WHERE %s
		ORDER BY timeboxes_sprints_date_start ASC
	`

// sqlUpdateSprintTemplate is the sparse-UPDATE shell. %s slots: SET
// clause; $%d $%d in WHERE for (id, workspace_id).
const sqlUpdateSprintTemplate = `
		UPDATE timeboxes_sprints
		SET %s
		WHERE timeboxes_sprints_id = $%d
		  AND timeboxes_sprints_id_workspace = $%d
		  AND timeboxes_sprints_archived_at IS NULL
		RETURNING
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
	`

// sqlArchiveSprint soft-deletes one sprint scoped to workspace.
const sqlArchiveSprint = `
		UPDATE timeboxes_sprints
		SET timeboxes_sprints_archived_at = now()
		WHERE timeboxes_sprints_id = $1
		  AND timeboxes_sprints_id_workspace = $2
		  AND timeboxes_sprints_archived_at IS NULL
	`

// sqlFanoutArtefactSprintLabel refreshes the denormalised sprint label
// on every live artefact pointing at the given sprint. Called by Update
// when timeboxes_sprints_name or timeboxes_sprints_suffix changes — the
// per-artefact read path serves artefacts_timebox_sprint_label directly
// (no JOIN), so a rename / suffix edit MUST fan out here or the grid
// will keep rendering the stale label until each row is touched.
//
// Same CASE shape as migration 144's backfill and artefactitems'
// sqlDeriveSprintLabelSubquery — three locations encode the same
// label-formation rule; keep them in lockstep on any change to the
// '<name> — <suffix>' format.
const sqlFanoutArtefactSprintLabel = `
		UPDATE artefacts
		SET artefacts_timebox_sprint_label = (
			SELECT CASE
				WHEN s.timeboxes_sprints_suffix IS NOT NULL
				 AND length(btrim(s.timeboxes_sprints_suffix)) > 0
				THEN s.timeboxes_sprints_name || ' — ' || btrim(s.timeboxes_sprints_suffix)
				ELSE s.timeboxes_sprints_name
			END
			FROM timeboxes_sprints s
			WHERE s.timeboxes_sprints_id = $1
			  AND s.timeboxes_sprints_archived_at IS NULL),
		    artefacts_updated_at = now()
		WHERE artefacts_id_timebox_sprint = $1
		  AND artefacts_archived_at IS NULL
	`

// sqlStartSprint atomically transitions planned → active and returns
// the hydrated row. RETURNING is empty when status != 'planned'.
const sqlStartSprint = `
		UPDATE timeboxes_sprints
		SET timeboxes_sprints_status = 'active'
		WHERE timeboxes_sprints_id = $1
		  AND timeboxes_sprints_id_workspace = $2
		  AND timeboxes_sprints_status = 'planned'
		  AND timeboxes_sprints_archived_at IS NULL
		RETURNING
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
	`

// sqlCloseSprint atomically transitions active → completed.
const sqlCloseSprint = `
		UPDATE timeboxes_sprints
		SET timeboxes_sprints_status = 'completed'
		WHERE timeboxes_sprints_id = $1
		  AND timeboxes_sprints_id_workspace = $2
		  AND timeboxes_sprints_status = 'active'
		  AND timeboxes_sprints_archived_at IS NULL
		RETURNING
			timeboxes_sprints_id,
			timeboxes_sprints_id_subscription,
			timeboxes_sprints_id_workspace,
			timeboxes_sprints_id_topology_node,
			timeboxes_sprints_name,
			timeboxes_sprints_suffix,
			timeboxes_sprints_id_user_owner,
			timeboxes_sprints_cadence_days,
			timeboxes_sprints_date_start::text,
			timeboxes_sprints_date_end::text,
			timeboxes_sprints_scope,
			timeboxes_sprints_velocity,
			timeboxes_sprints_estimate,
			timeboxes_sprints_creep_by_count,
			timeboxes_sprints_creep_by_estimate,
			timeboxes_sprints_status,
			timeboxes_sprints_created_at,
			timeboxes_sprints_updated_at,
			timeboxes_sprints_archived_at,
			timeboxes_sprints_scope_propagation
	`

// sqlSelectLastSprintEndDateRoot returns the latest end-date for
// workspace-level sprints (no topology node binding).
const sqlSelectLastSprintEndDateRoot = `
		SELECT timeboxes_sprints_date_end::text
		FROM timeboxes_sprints
		WHERE timeboxes_sprints_id_workspace = $1
		  AND timeboxes_sprints_id_topology_node IS NULL
		  AND timeboxes_sprints_archived_at IS NULL
		ORDER BY timeboxes_sprints_date_end DESC LIMIT 1
	`

// sqlSelectLastSprintEndDateForNode returns the latest end-date for
// a specific topology node within a workspace.
const sqlSelectLastSprintEndDateForNode = `
		SELECT timeboxes_sprints_date_end::text
		FROM timeboxes_sprints
		WHERE timeboxes_sprints_id_workspace = $1
		  AND timeboxes_sprints_id_topology_node = $2
		  AND timeboxes_sprints_archived_at IS NULL
		ORDER BY timeboxes_sprints_date_end DESC LIMIT 1
	`

// _ retains sprintCols as the canonical column-list comment; not yet
// inlined into the queries above so the per-statement RETURNING blocks
// stay explicit and Scan()-aligned.
var _ = sprintCols
