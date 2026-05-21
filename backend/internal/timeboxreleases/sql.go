// Package timeboxreleases SQL constants.
//
// PLA-0048 / RF1.2.10 (consts) + RF1.4.2.timeboxes (column-prefix rule,
// migration 054). Sole writer for timeboxes_releases (vector_artefacts).
package timeboxreleases

// sqlInsertRelease creates a new release and returns the hydrated row.
const sqlInsertRelease = `
		INSERT INTO timeboxes_releases (
			timeboxes_releases_id_subscription,
			timeboxes_releases_id_workspace,
			timeboxes_releases_id_topology_node,
			timeboxes_releases_name,
			timeboxes_releases_suffix,
			timeboxes_releases_id_user_owner,
			timeboxes_releases_cadence_days,
			timeboxes_releases_date_start,
			timeboxes_releases_date_end,
			timeboxes_releases_velocity,
			timeboxes_releases_scope_propagation
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'this_node_only'))
		RETURNING
			timeboxes_releases_id,
			timeboxes_releases_id_subscription,
			timeboxes_releases_id_workspace,
			timeboxes_releases_id_topology_node,
			timeboxes_releases_name,
			timeboxes_releases_suffix,
			timeboxes_releases_id_user_owner,
			timeboxes_releases_cadence_days,
			timeboxes_releases_date_start::text,
			timeboxes_releases_date_end::text,
			timeboxes_releases_scope,
			timeboxes_releases_velocity,
			timeboxes_releases_estimate,
			timeboxes_releases_creep_by_count,
			timeboxes_releases_creep_by_estimate,
			timeboxes_releases_status,
			timeboxes_releases_created_at,
			timeboxes_releases_updated_at,
			timeboxes_releases_archived_at,
			timeboxes_releases_scope_propagation
	`

// sqlSelectReleaseByID returns one live release scoped to workspace.
const sqlSelectReleaseByID = `
		SELECT
			timeboxes_releases_id,
			timeboxes_releases_id_subscription,
			timeboxes_releases_id_workspace,
			timeboxes_releases_id_topology_node,
			timeboxes_releases_name,
			timeboxes_releases_suffix,
			timeboxes_releases_id_user_owner,
			timeboxes_releases_cadence_days,
			timeboxes_releases_date_start::text,
			timeboxes_releases_date_end::text,
			timeboxes_releases_scope,
			timeboxes_releases_velocity,
			timeboxes_releases_estimate,
			timeboxes_releases_creep_by_count,
			timeboxes_releases_creep_by_estimate,
			timeboxes_releases_status,
			timeboxes_releases_created_at,
			timeboxes_releases_updated_at,
			timeboxes_releases_archived_at
		FROM timeboxes_releases
		WHERE timeboxes_releases_id = $1
		  AND timeboxes_releases_id_workspace = $2
		  AND timeboxes_releases_archived_at IS NULL
	`

// sqlListReleasesTemplate is the dynamic list query — %s holds the
// composed WHERE clause built from List filters.
const sqlListReleasesTemplate = `
		SELECT
			timeboxes_releases_id,
			timeboxes_releases_id_subscription,
			timeboxes_releases_id_workspace,
			timeboxes_releases_id_topology_node,
			timeboxes_releases_name,
			timeboxes_releases_suffix,
			timeboxes_releases_id_user_owner,
			timeboxes_releases_cadence_days,
			timeboxes_releases_date_start::text,
			timeboxes_releases_date_end::text,
			timeboxes_releases_scope,
			timeboxes_releases_velocity,
			timeboxes_releases_estimate,
			timeboxes_releases_creep_by_count,
			timeboxes_releases_creep_by_estimate,
			timeboxes_releases_status,
			timeboxes_releases_created_at,
			timeboxes_releases_updated_at,
			timeboxes_releases_archived_at
		FROM timeboxes_releases
		WHERE %s
		ORDER BY timeboxes_releases_date_start ASC
	`

// sqlUpdateReleaseTemplate is the sparse-UPDATE shell. %s slots: SET
// clause; $%d $%d in WHERE for (id, workspace_id).
const sqlUpdateReleaseTemplate = `
		UPDATE timeboxes_releases
		SET %s
		WHERE timeboxes_releases_id = $%d
		  AND timeboxes_releases_id_workspace = $%d
		  AND timeboxes_releases_archived_at IS NULL
		RETURNING
			timeboxes_releases_id,
			timeboxes_releases_id_subscription,
			timeboxes_releases_id_workspace,
			timeboxes_releases_id_topology_node,
			timeboxes_releases_name,
			timeboxes_releases_suffix,
			timeboxes_releases_id_user_owner,
			timeboxes_releases_cadence_days,
			timeboxes_releases_date_start::text,
			timeboxes_releases_date_end::text,
			timeboxes_releases_scope,
			timeboxes_releases_velocity,
			timeboxes_releases_estimate,
			timeboxes_releases_creep_by_count,
			timeboxes_releases_creep_by_estimate,
			timeboxes_releases_status,
			timeboxes_releases_created_at,
			timeboxes_releases_updated_at,
			timeboxes_releases_archived_at,
			timeboxes_releases_scope_propagation
	`

// sqlArchiveRelease soft-deletes one release scoped to workspace.
const sqlArchiveRelease = `
		UPDATE timeboxes_releases
		SET timeboxes_releases_archived_at = now()
		WHERE timeboxes_releases_id = $1
		  AND timeboxes_releases_id_workspace = $2
		  AND timeboxes_releases_archived_at IS NULL
	`
