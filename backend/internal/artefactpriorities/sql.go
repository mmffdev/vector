package artefactpriorities

// SQL constants for the artefactpriorities service. Kept in their own
// file per the project's lint:sql-in-sqlfile-only rule (Go sources
// elsewhere should not inline ad-hoc SQL).
//
// RF1.5.2 — column prefixes applied per the §2.3 / §2.4 convention.
// Every column on artefact_priorities is `artefact_priorities_<col>`;
// the soft `workspace_id` (no Postgres FK — workspaces lives in
// mmff_vector) is `artefact_priorities_id_workspace`. Migration 094.

const sqlColumns = `
	artefact_priorities_id,
	artefact_priorities_id_workspace,
	artefact_priorities_name,
	artefact_priorities_slot,
	artefact_priorities_sort_order,
	artefact_priorities_colour,
	artefact_priorities_archived_at,
	artefact_priorities_created_at,
	artefact_priorities_updated_at`

const sqlListByWorkspace = `
	SELECT` + sqlColumns + `
	  FROM artefact_priorities
	 WHERE artefact_priorities_id_workspace = $1
	   AND artefact_priorities_archived_at IS NULL
	 ORDER BY artefact_priorities_sort_order, artefact_priorities_name`

const sqlInsert = `
	INSERT INTO artefact_priorities (
		artefact_priorities_id_workspace,
		artefact_priorities_name,
		artefact_priorities_slot,
		artefact_priorities_sort_order,
		artefact_priorities_colour
	)
	VALUES ($1::uuid, $2, NULL, $3, $4)
	RETURNING` + sqlColumns

// sqlPatchTemplate has one %s slot for the SET clause. Caller composes
// it from the non-nil PatchInput fields.
const sqlPatchTemplate = `
	UPDATE artefact_priorities
	   SET %s
	 WHERE artefact_priorities_id = $1
	   AND artefact_priorities_id_workspace = $2
	   AND artefact_priorities_archived_at IS NULL
	 RETURNING` + sqlColumns

const sqlReadSlot = `
	SELECT artefact_priorities_slot
	  FROM artefact_priorities
	 WHERE artefact_priorities_id = $1
	   AND artefact_priorities_id_workspace = $2
	   AND artefact_priorities_archived_at IS NULL`

const sqlArchive = `
	UPDATE artefact_priorities
	   SET artefact_priorities_archived_at = now(),
	       artefact_priorities_updated_at  = now()
	 WHERE artefact_priorities_id = $1
	   AND artefact_priorities_id_workspace = $2
	   AND artefact_priorities_archived_at IS NULL`
