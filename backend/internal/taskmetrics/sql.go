package taskmetrics

// sqlSelectTaskBurnEvents reads the append-only ledger for one sprint within one
// workspace, oldest first, normalising occurred_at to "YYYY-MM-DD".
const sqlSelectTaskBurnEvents = `SELECT task_burn_events_id_artefact, task_burn_events_event_type, task_burn_events_remaining_delta, task_burn_events_scope_delta, to_char(task_burn_events_occurred_at,'YYYY-MM-DD') FROM task_burn_events WHERE task_burn_events_id_sprint=$1 AND task_burn_events_id_workspace=$2 ORDER BY task_burn_events_occurred_at ASC`

// sqlSelectSprintWindow reads the sprint's start/end as "YYYY-MM-DD" strings.
const sqlSelectSprintWindow = `SELECT to_char(timeboxes_sprints_date_start,'YYYY-MM-DD'), to_char(timeboxes_sprints_date_end,'YYYY-MM-DD') FROM timeboxes_sprints WHERE timeboxes_sprints_id=$1`

// sqlInsertTaskBurnEvent appends one ledger row inside the artefact write tx.
const sqlInsertTaskBurnEvent = `INSERT INTO task_burn_events (task_burn_events_id_sprint, task_burn_events_id_artefact, task_burn_events_event_type, task_burn_events_remaining_delta, task_burn_events_scope_delta, task_burn_events_id_actor, task_burn_events_id_workspace) VALUES ($1,$2,$3,$4,$5,$6,$7)`
