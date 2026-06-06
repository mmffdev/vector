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

// sqlSelectSprintAcceptance returns, per sprint in the workspace, the NET
// accepted points (accepted minus unaccepted) and the sprint end date. The
// workspace clamp is on the EVENTS row ($1) — the same fail-closed clamp the
// burndown uses — because timeboxes_sprints_id_workspace is a placeholder in
// this substrate while the events carry the real sentinel workspace. Only
// sprints that have at least one burn event appear; a sprint with zero accepted
// points (but other events) still appears with accepted_pts=0, which is correct
// for the velocity average. Ordered most-recent end first.
const sqlSelectSprintAcceptance = `
	SELECT
		e.sprint_burn_events_id_sprint::text                         AS sprint_id,
		COALESCE(s.timeboxes_sprints_name, '')                       AS name,
		to_char(s.timeboxes_sprints_date_end, 'YYYY-MM-DD')          AS end_date,
		COALESCE(SUM(
			CASE e.sprint_burn_events_event_type
				WHEN 'accepted'   THEN -e.sprint_burn_events_points_delta
				WHEN 'unaccepted' THEN -e.sprint_burn_events_points_delta
				ELSE 0
			END
		), 0)::int                                                   AS accepted_pts
	FROM sprint_burn_events e
	JOIN timeboxes_sprints s
		ON s.timeboxes_sprints_id = e.sprint_burn_events_id_sprint
		AND s.timeboxes_sprints_archived_at IS NULL
	WHERE e.sprint_burn_events_id_workspace = $1
	GROUP BY e.sprint_burn_events_id_sprint, s.timeboxes_sprints_name, s.timeboxes_sprints_date_end
	ORDER BY s.timeboxes_sprints_date_end DESC NULLS LAST
`
