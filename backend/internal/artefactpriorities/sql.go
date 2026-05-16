package artefactpriorities

// SQL constants for the artefactpriorities service. Kept in their own
// file per the project's lint:sql-in-sqlfile-only rule (Go sources
// elsewhere should not inline ad-hoc SQL).

const sqlColumns = `
	id, workspace_id, name, slot,
	sort_order, colour, archived_at,
	created_at, updated_at`

const sqlListByWorkspace = `
	SELECT` + sqlColumns + `
	  FROM artefact_priorities
	 WHERE workspace_id = $1
	   AND archived_at IS NULL
	 ORDER BY sort_order, name`

const sqlInsert = `
	INSERT INTO artefact_priorities (workspace_id, name, slot, sort_order, colour)
	VALUES ($1::uuid, $2, NULL, $3, $4)
	RETURNING` + sqlColumns

// sqlPatchTemplate has one %s slot for the SET clause. Caller composes
// it from the non-nil PatchInput fields.
const sqlPatchTemplate = `
	UPDATE artefact_priorities
	   SET %s
	 WHERE id = $1
	   AND workspace_id = $2
	   AND archived_at IS NULL
	 RETURNING` + sqlColumns

const sqlReadSlot = `
	SELECT slot
	  FROM artefact_priorities
	 WHERE id = $1
	   AND workspace_id = $2
	   AND archived_at IS NULL`

const sqlArchive = `
	UPDATE artefact_priorities
	   SET archived_at = now(), updated_at = now()
	 WHERE id = $1
	   AND workspace_id = $2
	   AND archived_at IS NULL`
