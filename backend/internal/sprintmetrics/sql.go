package sprintmetrics

// sqlSelectBurnEvents reads the append-only ledger for one sprint within one
// workspace, oldest first, normalising occurred_at to a "YYYY-MM-DD" string.
const sqlSelectBurnEvents = `SELECT sprint_burn_events_id_artefact, sprint_burn_events_event_type, sprint_burn_events_points_delta, sprint_burn_events_scope_delta, to_char(sprint_burn_events_occurred_at,'YYYY-MM-DD') FROM sprint_burn_events WHERE sprint_burn_events_id_sprint=$1 AND sprint_burn_events_id_workspace=$2 ORDER BY sprint_burn_events_occurred_at ASC`

// sqlSelectSprintWindow reads the sprint's start/end as "YYYY-MM-DD" strings.
const sqlSelectSprintWindow = `SELECT to_char(timeboxes_sprints_date_start,'YYYY-MM-DD'), to_char(timeboxes_sprints_date_end,'YYYY-MM-DD') FROM timeboxes_sprints WHERE timeboxes_sprints_id=$1`

// sqlInsertBurnEvent appends one ledger row inside the artefact write tx.
// Columns are fully table-name prefixed per the column-naming hard rule
// (occurred_at defaults to now()).
const sqlInsertBurnEvent = `INSERT INTO sprint_burn_events (sprint_burn_events_id_sprint, sprint_burn_events_id_artefact, sprint_burn_events_event_type, sprint_burn_events_points_delta, sprint_burn_events_points_after, sprint_burn_events_scope_delta, sprint_burn_events_id_actor, sprint_burn_events_id_workspace) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
