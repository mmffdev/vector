// Package artefactitems SQL constants.
//
// PLA-0048 / RF1.2.19. Sole writer for artefacts + artefacts_fields_values
// (vector_artefacts); read-only against mmff_vector for owner decoration
// and workspace resolution.
package artefactitems

import "fmt"

// rollupCTE is the WITH RECURSIVE expression spliced into the list,
// get-one, and list-children data queries. Independent const so the
// data SELECTs reference it as `WITH ` + rollupCTE + ` SELECT …`.
//
// (Naming: keeps the historical name from when this lived inline —
// migrating the const but preserving the identifier means handler
// tests that import this symbol keep working unchanged.)
const rollupCTE = `rollup_points AS (
	SELECT
		a.artefacts_id,
		CASE WHEN EXISTS (
			SELECT 1 FROM artefacts c
			WHERE c.artefacts_id_parent = a.artefacts_id AND c.artefacts_archived_at IS NULL
		) THEN (
			WITH RECURSIVE descendants AS (
				SELECT artefacts_id, artefacts_story_points
				FROM artefacts
				WHERE artefacts_id_parent = a.artefacts_id AND artefacts_archived_at IS NULL
				UNION ALL
				SELECT child.artefacts_id, child.artefacts_story_points
				FROM artefacts child
				JOIN descendants d ON child.artefacts_id_parent = d.artefacts_id
				WHERE child.artefacts_archived_at IS NULL
			)
			SELECT COALESCE(SUM(artefacts_story_points), 0) FROM descendants
		) ELSE NULL END AS rollup_points
	FROM artefacts a
	WHERE a.artefacts_id_subscription = $1
	  AND a.artefacts_archived_at IS NULL
)`

// sqlWorkItemColumns is the shared SELECT column list used by the data
// queries (List + Get + ListChildren). Kept as a fragment string so all
// three projections stay in lockstep.
const sqlWorkItemColumns = `
	a.artefacts_id::text,
	a.artefacts_id_subscription::text,
	a.artefacts_number              AS key_num,
	lower(at.artefacts_types_name)  AS item_type,
	at.artefacts_types_prefix       AS type_prefix,
	a.artefacts_id_artefact_type::text AS artefact_type_id,
	a.artefacts_title               AS title,
	a.artefacts_description         AS description,
	''                              AS status,
	COALESCE(fs.flows_states_id::text, '')        AS flow_state_id,
	COALESCE(fs.flows_states_name, '')            AS flow_state_name,
	CASE fs.flows_states_kind
		WHEN 'backlog'     THEN 'backlog'
		WHEN 'todo'        THEN 'todo'
		WHEN 'in_progress' THEN 'doing'
		WHEN 'done'        THEN 'completed'
		WHEN 'accepted'    THEN 'accepted'
		WHEN 'cancelled'   THEN 'cancelled'
		ELSE                    'backlog'
	END                             AS flow_state_code,
	a.artefacts_id_priority::text              AS priority_id,
	pri.artefact_priorities_name               AS priority_name,
	pri.artefact_priorities_slot               AS priority_slot,
	pri.artefact_priorities_sort_order         AS priority_sort_order,
	a.artefacts_story_points        AS story_points,
	a.artefacts_id_timebox_sprint::text,
	-- Denormalised sprint label — single column read, no JOIN. The
	-- writer side keeps this in sync on artefact-sprint assignment
	-- (CreateWorkItem / PatchWorkItem) and on sprint rename / suffix
	-- edit (Sprint service Patch fan-out). NULL when the artefact has
	-- no sprint assigned. Migration 144 added the column + backfill.
	a.artefacts_id_timebox_sprint::text AS sprint_ref_id,
	a.artefacts_timebox_sprint_label    AS sprint_ref_alias,
	a.artefacts_id_parent::text     AS parent_id,
	ap.artefacts_id::text           AS parent_ref_id,
	apt.artefacts_types_prefix      AS parent_ref_type_prefix,
	ap.artefacts_number             AS parent_ref_key_num,
	ap.artefacts_title              AS parent_ref_title,
	NULL::text                      AS root_feature_id,
	COALESCE(a.artefacts_id_user_owned_by::text, '') AS owner_id,
	NULL::text                      AS owner_ref_id,
	NULL::text                      AS owner_display_name,
	NULL::text                      AS owner_avatar_url,
	a.artefacts_due_date::text      AS due_date,
	COALESCE(a.artefacts_id_user_created_by::text, '') AS created_by,
	a.artefacts_created_at          AS created_at,
	a.artefacts_updated_at          AS updated_at,
	a.artefacts_archived_at         AS archived_at,
	(SELECT count(*) FROM artefacts child
	 WHERE child.artefacts_id_parent = a.artefacts_id
	   AND child.artefacts_archived_at IS NULL)        AS children_count,
	COALESCE(rp.rollup_points, a.artefacts_story_points) AS rollup_points,
	a.artefacts_id_topology_node::text      AS topology_node_id,
	a.artefacts_colour                      AS colour,
	a.artefacts_is_blocked                  AS is_blocked,
	a.artefacts_blocked_reason              AS blocked_reason,
	a.artefacts_id_timebox_release::text    AS release_id,
	a.artefacts_id_timebox_milestone::text  AS milestone_id,
	a.artefacts_description_doc             AS description_doc`

// sqlCountWorkItemsTemplate is the count-only query used by List. The
// extraWhere is composed in Go from the active filter set; %s slot.
const sqlCountWorkItemsTemplate = `
		SELECT count(*) FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		WHERE a.artefacts_id_subscription = $1
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_scope = $2%s
	`

// sqlListWorkItemsTemplate is the paged data query. %s slots: extra
// WHERE; ORDER BY; LIMIT/OFFSET bind indexes.
const sqlListWorkItemsTemplate = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		LEFT JOIN rollup_points rp ON rp.artefacts_id = a.artefacts_id
		LEFT JOIN artefacts ap ON ap.artefacts_id = a.artefacts_id_parent AND ap.artefacts_archived_at IS NULL
		LEFT JOIN artefacts_types apt ON apt.artefacts_types_id = ap.artefacts_id_artefact_type
		WHERE a.artefacts_id_subscription = $1
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_scope = $2%s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`

// sqlSelectAncestors returns the parent chain of an artefact, ordered
// from immediate parent (depth=1) up to the topmost ancestor. Slim
// projection — the diagram consumer (ArtefactNodeDiagram) only needs
// id, type_prefix, key_num, title, parent_id. Uses a recursive CTE so
// the whole chain comes back in one round-trip regardless of depth.
//
// Subscription clamp is enforced on the starting row + walked rows so
// cross-tenant parent_id values (defensive — shouldn't exist post-RI)
// halt the walk at the boundary rather than leaking the next row.
const sqlSelectAncestors = `
		WITH RECURSIVE chain AS (
			SELECT
				a.artefacts_id, a.artefacts_id_parent, a.artefacts_id_artefact_type, a.artefacts_number, a.artefacts_title,
				1 AS depth
			FROM artefacts a
			WHERE a.artefacts_id = (
				SELECT artefacts_id_parent FROM artefacts
				WHERE artefacts_id = $1 AND artefacts_id_subscription = $2 AND artefacts_archived_at IS NULL
			)
			  AND a.artefacts_id_subscription = $2
			  AND a.artefacts_archived_at IS NULL
			UNION ALL
			SELECT
				p.artefacts_id, p.artefacts_id_parent, p.artefacts_id_artefact_type, p.artefacts_number, p.artefacts_title,
				c.depth + 1
			FROM artefacts p
			JOIN chain c ON p.artefacts_id = c.artefacts_id_parent
			WHERE p.artefacts_id_subscription = $2
			  AND p.artefacts_archived_at IS NULL
		)
		SELECT
			c.artefacts_id::text,
			at.artefacts_types_prefix AS type_prefix,
			c.artefacts_number AS key_num,
			c.artefacts_title AS title,
			c.artefacts_id_parent::text AS parent_id
		FROM chain c
		JOIN artefacts_types at ON at.artefacts_types_id = c.artefacts_id_artefact_type
		ORDER BY c.depth ASC
	`

// sqlSelectWorkItemByID is the single-row hydration used by GetWorkItem.
// Subscription-clamped only; admin/migration callers without a workspace
// context use this entry point.
const sqlSelectWorkItemByID = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		LEFT JOIN rollup_points rp ON rp.artefacts_id = a.artefacts_id
		LEFT JOIN artefacts ap ON ap.artefacts_id = a.artefacts_id_parent AND ap.artefacts_archived_at IS NULL
		LEFT JOIN artefacts_types apt ON apt.artefacts_types_id = ap.artefacts_id_artefact_type
		WHERE a.artefacts_id = $2
		  AND a.artefacts_id_subscription = $1
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_scope = $3
	`

// sqlSelectWorkItemByIDInWorkspace is the workspace-clamped sibling of
// sqlSelectWorkItemByID. PLA-0053 / story 00579, updated PLA062 S05.5
// — handler picks this when sentinel.WorkspaceIDFromCtx returns a
// clamp; cross-workspace IDs return pgx.ErrNoRows (translated to 404
// by the handler), so no existence leak between workspaces.
const sqlSelectWorkItemByIDInWorkspace = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		LEFT JOIN rollup_points rp ON rp.artefacts_id = a.artefacts_id
		LEFT JOIN artefacts ap ON ap.artefacts_id = a.artefacts_id_parent AND ap.artefacts_archived_at IS NULL
		LEFT JOIN artefacts_types apt ON apt.artefacts_types_id = ap.artefacts_id_artefact_type
		WHERE a.artefacts_id = $2
		  AND a.artefacts_id_subscription = $1
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_scope = $3
		  AND at.artefacts_types_id_workspace = $4
	`

// sqlListChildWorkItems lists direct children of a parent.
const sqlListChildWorkItems = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		LEFT JOIN rollup_points rp ON rp.artefacts_id = a.artefacts_id
		LEFT JOIN artefacts ap ON ap.artefacts_id = a.artefacts_id_parent AND ap.artefacts_archived_at IS NULL
		LEFT JOIN artefacts_types apt ON apt.artefacts_types_id = ap.artefacts_id_artefact_type
		WHERE a.artefacts_id_subscription = $1
		  AND a.artefacts_id_parent = $2
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_scope = $3
		ORDER BY a.artefacts_position ASC, a.artefacts_number ASC
	`

// ── SummariseWorkItems ─────────────────────────────────────────────────────

// sqlSummariseTotalTemplate computes (total, blocked) — %s holds the
// composed WHERE clause.
const sqlSummariseTotalTemplate = `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (
				WHERE (fs.flows_states_kind = 'todo' OR fs.flows_states_id IS NULL)
				  AND a.artefacts_updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		WHERE %s
	`

// sqlListFacetTypesTemplate returns the distinct artefact_type_id values
// for live artefacts under the caller's clamp. %s holds the optional
// extra-clause string (workspace + topology scope) — see Service.ListFacets.
// Same JOIN shape as the summarise queries so the clamp logic is shared.
const sqlListFacetTypesTemplate = `
		SELECT DISTINCT a.artefacts_id_artefact_type
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE at.artefacts_types_id_subscription = $1
		  AND at.artefacts_types_scope = $2
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_archived_at IS NULL%s
	`

// sqlListFacetPrioritiesTemplate is the priority twin of the facet types
// query. priority_id is NOT NULL post-PLA-0055 but the IS NOT NULL guard
// keeps the query safe against legacy fixtures.
const sqlListFacetPrioritiesTemplate = `
		SELECT DISTINCT a.artefacts_id_priority
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE at.artefacts_types_id_subscription = $1
		  AND at.artefacts_types_scope = $2
		  AND a.artefacts_archived_at IS NULL
		  AND at.artefacts_types_archived_at IS NULL
		  AND a.artefacts_id_priority IS NOT NULL%s
	`

// sqlSummariseByTypeTemplate buckets counts by artefact_type.name. %s
// holds the composed WHERE clause shared with the total query.
const sqlSummariseByTypeTemplate = `
		SELECT lower(at.artefacts_types_name) AS name, COUNT(*)
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
		WHERE %s
		GROUP BY lower(at.artefacts_types_name)
	`

// ── SummariseRisks (PLA-0052 Story 10) ────────────────────────────────────
//
// Severity × likelihood matrix aggregator. Reads risk_impact + risk_probability
// from artefacts_fields_values; lowercases the value strings; counts per
// (severity, likelihood) cell + per-axis totals + open count (non-done states).
//
// Subscription-scoped. Risk artefacts only (artefacts_types_name='Risk').
const sqlSummariseRisks = `
		WITH r AS (
			SELECT
				a.artefacts_id,
				fs.flows_states_kind AS flow_kind,
				LOWER(MAX(fvi.artefacts_fields_values_string_value) FILTER (
					WHERE fli.artefacts_fields_library_field_name = 'risk_impact'
				)) AS severity,
				LOWER(MAX(fvp.artefacts_fields_values_string_value) FILTER (
					WHERE flp.artefacts_fields_library_field_name = 'risk_probability'
				)) AS likelihood
			FROM artefacts a
			JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
			LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		LEFT JOIN artefact_priorities pri ON pri.artefact_priorities_id = a.artefacts_id_priority
			LEFT JOIN artefacts_fields_values fvi
				ON fvi.artefacts_fields_values_id_artefact = a.artefacts_id
			LEFT JOIN artefacts_fields_library fli
				ON fli.artefacts_fields_library_id = fvi.artefacts_fields_values_id_field_library
			LEFT JOIN artefacts_fields_values fvp
				ON fvp.artefacts_fields_values_id_artefact = a.artefacts_id
			LEFT JOIN artefacts_fields_library flp
				ON flp.artefacts_fields_library_id = fvp.artefacts_fields_values_id_field_library
			WHERE a.artefacts_id_subscription = $1
			  AND a.artefacts_archived_at IS NULL
			  AND lower(at.artefacts_types_name) = 'risk'
			GROUP BY a.artefacts_id, fs.flows_states_kind
		)
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE flow_kind IS DISTINCT FROM 'done' AND flow_kind IS DISTINCT FROM 'accepted' AND flow_kind IS DISTINCT FROM 'cancelled') AS open_count,
			COUNT(*) FILTER (WHERE severity = 'critical') AS sev_critical,
			COUNT(*) FILTER (WHERE severity = 'high')     AS sev_high,
			COUNT(*) FILTER (WHERE severity = 'medium')   AS sev_medium,
			COUNT(*) FILTER (WHERE severity = 'low')      AS sev_low,
			COUNT(*) FILTER (WHERE likelihood = 'high')   AS lik_high,
			COUNT(*) FILTER (WHERE likelihood = 'medium') AS lik_medium,
			COUNT(*) FILTER (WHERE likelihood = 'low')    AS lik_low,
			-- 3×3 matrix cells (severity × likelihood)
			COUNT(*) FILTER (WHERE severity='high'   AND likelihood='high')   AS mhh,
			COUNT(*) FILTER (WHERE severity='high'   AND likelihood='medium') AS mhm,
			COUNT(*) FILTER (WHERE severity='high'   AND likelihood='low')    AS mhl,
			COUNT(*) FILTER (WHERE severity='medium' AND likelihood='high')   AS mmh,
			COUNT(*) FILTER (WHERE severity='medium' AND likelihood='medium') AS mmm,
			COUNT(*) FILTER (WHERE severity='medium' AND likelihood='low')    AS mml,
			COUNT(*) FILTER (WHERE severity='low'    AND likelihood='high')   AS mlh,
			COUNT(*) FILTER (WHERE severity='low'    AND likelihood='medium') AS mlm,
			COUNT(*) FILTER (WHERE severity='low'    AND likelihood='low')    AS mll
		FROM r
	`

// ── ListFlowStates ─────────────────────────────────────────────────────────

// Default-type variant: subscription-scoped, picks the first work-scoped
// artefact type. Kept for back-compat with callers that don't yet pass
// ?artefact_type_id (the existing useWorkItemFlowStates hook).
const sqlListWorkScopeFlowStates = `
		SELECT fs.flows_states_id, fs.flows_states_sort_order, fs.flows_states_name, fs.flows_states_kind, fs.flows_states_colour
		FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = (
			SELECT at.artefacts_types_id FROM artefacts_types at
			JOIN flows f2 ON f2.flows_id_artefact_type = at.artefacts_types_id
			WHERE at.artefacts_types_id_subscription = $1
			  AND at.artefacts_types_scope = $2
			  AND f2.flows_is_default = TRUE
			  AND f2.flows_archived_at IS NULL
			  AND at.artefacts_types_archived_at IS NULL
			ORDER BY at.artefacts_types_created_at ASC
			LIMIT 1
		)
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_archived_at IS NULL
		ORDER BY fs.flows_states_sort_order ASC
	`

// By-type variant: returns the default flow's states for one or more
// artefact_type_ids in a single query. The handler accepts a comma-
// separated list (?artefact_type_id=<uuid>,<uuid>) so the ObjectTree
// can prime a per-type cache in one round-trip. Subscription clamp is
// still enforced (every type row must belong to the caller). Returns
// flows_id_artefact_type so the caller can group rows by type.
const sqlListFlowStatesByArtefactType = `
		SELECT
			f.flows_id_artefact_type::text AS artefact_type_id,
			fs.flows_states_id,
			fs.flows_states_sort_order,
			fs.flows_states_name,
			fs.flows_states_kind,
			fs.flows_states_colour
		FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE f.flows_id_artefact_type = ANY($1::uuid[])
		  AND at.artefacts_types_id_subscription = $2
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_archived_at IS NULL
		  AND at.artefacts_types_archived_at IS NULL
		ORDER BY f.flows_id_artefact_type, fs.flows_states_sort_order ASC
	`

// ── CreateWorkItem ─────────────────────────────────────────────────────────

const sqlSelectArtefactTypeIDForCreate = `
		SELECT at.artefacts_types_id FROM artefacts_types at
		WHERE at.artefacts_types_id_subscription = $1
		  AND at.artefacts_types_scope = $3
		  AND lower(at.artefacts_types_name) = $2
		  AND at.artefacts_types_archived_at IS NULL
		ORDER BY EXISTS (
		  SELECT 1 FROM flows f
		  JOIN flows_states fs ON fs.flows_states_id_flow = f.flows_id
		  WHERE f.flows_id_artefact_type = at.artefacts_types_id
		    AND f.flows_is_default = TRUE AND fs.flows_states_is_initial = TRUE
		    AND f.flows_archived_at IS NULL AND fs.flows_states_archived_at IS NULL
		) DESC, at.artefacts_types_created_at
		LIMIT 1
	`

const sqlAllocateArtefactNumber = `
		INSERT INTO artefacts_number_sequences (
			artefacts_number_sequences_id_subscription,
			artefacts_number_sequences_id_artefact_type,
			artefacts_number_sequences_next_num
		)
		VALUES (
			$1, $2,
			(SELECT COALESCE(MAX(artefacts_number), 0) + 2 FROM artefacts WHERE artefacts_id_subscription = $1 AND artefacts_id_artefact_type = $2)
		)
		ON CONFLICT (artefacts_number_sequences_id_subscription, artefacts_number_sequences_id_artefact_type) DO UPDATE
			SET artefacts_number_sequences_next_num = GREATEST(
				artefacts_number_sequences.artefacts_number_sequences_next_num + 1,
				(SELECT COALESCE(MAX(artefacts_number), 0) + 2 FROM artefacts WHERE artefacts_id_subscription = $1 AND artefacts_id_artefact_type = $2)
			)
		RETURNING artefacts_number_sequences_next_num - 1
	`

const sqlSelectDefaultInitialFlowState = `
		SELECT fs.flows_states_id FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_is_initial = TRUE
		  AND fs.flows_states_archived_at IS NULL
		LIMIT 1
	`

const sqlSelectFirstLiveWorkspaceForSubscription = `
		SELECT master_record_workspaces_id FROM master_record_workspaces
		WHERE master_record_workspaces_id_subscription = $1 AND master_record_workspaces_archived_at IS NULL
		ORDER BY master_record_workspaces_created_at ASC LIMIT 1
	`

const sqlSelectNextArtefactPosition = `
		SELECT COALESCE(MAX(artefacts_position), 0) + 100 FROM artefacts
		WHERE artefacts_id_subscription = $1
		  AND artefacts_id_artefact_type = $2
		  AND artefacts_archived_at IS NULL
	`

// sqlDeriveSprintLabelSubquery is the canonical scalar-subquery for
// computing the denormalised sprint label from a sprint_id bind. Used by
// the Create INSERT (sprint_id bound at $10) and the Patch sparse-UPDATE
// (sprint_id bound dynamically — see Service.PatchWorkItem). %d slots
// the bind index. Format matches migration 144's backfill:
//
//	'<name> — <suffix>' when suffix is non-empty after trimming
//	'<name>'            otherwise
//	NULL                when the sprint is archived or the bind is NULL
const sqlDeriveSprintLabelSubquery = `(
	SELECT CASE
		WHEN s.timeboxes_sprints_suffix IS NOT NULL
		 AND length(btrim(s.timeboxes_sprints_suffix)) > 0
		THEN s.timeboxes_sprints_name || ' — ' || btrim(s.timeboxes_sprints_suffix)
		ELSE s.timeboxes_sprints_name
	END
	FROM timeboxes_sprints s
	WHERE s.timeboxes_sprints_id = $%d::uuid
	  AND s.timeboxes_sprints_archived_at IS NULL)`

// Denormalised sprint label is derived in the same INSERT via the
// shared sqlDeriveSprintLabelSubquery fragment (sprint_id bound at $10).
// Keeps the call signature one round-trip while ensuring the row is born
// with the correct label. NULL when sprint_id is NULL or the sprint is
// archived.
var sqlInsertArtefact = `
		INSERT INTO artefacts
			(artefacts_id_subscription, artefacts_id_workspace, artefacts_id_artefact_type, artefacts_number, artefacts_title, artefacts_description,
			 artefacts_id_flow_state, artefacts_id_priority, artefacts_story_points, artefacts_id_timebox_sprint, artefacts_id_parent,
			 artefacts_id_user_owned_by, artefacts_id_user_created_by, artefacts_position, artefacts_id_topology_node,
			 artefacts_timebox_sprint_label)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10,$11,$12,$13,$14,$15,
			` + fmt.Sprintf(sqlDeriveSprintLabelSubquery, 10) + `)
		RETURNING artefacts_id
	`

// ── PatchWorkItem ──────────────────────────────────────────────────────────

const sqlExistsFlowStateInSubscription = `
		SELECT EXISTS(
			SELECT 1 FROM flows_states fs
			JOIN flows f ON f.flows_id = fs.flows_states_id_flow
			JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
			WHERE fs.flows_states_id = $1
			  AND at.artefacts_types_id_subscription = $2
			  AND fs.flows_states_archived_at IS NULL
		)
	`

// sqlPatchArtefactTemplate is the sparse-UPDATE shell. First %s holds
// the comma-separated SET clause; %d %d hold the (id, subscription_id)
// bind indexes.
const sqlPatchArtefactTemplate = `UPDATE artefacts SET %s
		WHERE artefacts_id = $%d AND artefacts_id_subscription = $%d AND artefacts_archived_at IS NULL`

// ── ArchiveWorkItem ────────────────────────────────────────────────────────

const sqlArchiveArtefact = `
		UPDATE artefacts
		SET artefacts_archived_at = now(), artefacts_updated_at = now()
		WHERE artefacts_id = $1 AND artefacts_id_subscription = $2 AND artefacts_archived_at IS NULL
	`

// ── Flow-state cascade (recalc) ────────────────────────────────────────────
//
// Rule (execution-zone artefacts: TA / US / DE / EP only):
//   - ANY direct live child has flows_states_kind = 'in_progress'
//     → parent moves to first kind='in_progress' state in its flow.
//   - ALL direct live children have flows_states_kind = 'done'
//     → parent moves to first kind='done' state in its flow.
//   - ALL direct live children have flows_states_kind = 'todo' or 'backlog'
//     → parent moves to first kind='backlog' (fallback 'todo') in its flow.
//   - 'accepted' is NEVER set automatically — that's a manual gate.
//
// The cascade reads the parent's artefact_type_id (so we know which flow
// to land in), counts live children, and projects their kinds. A single
// query returns everything the rule needs in one round-trip.
//
// sqlSelectArtefactForRecalc — fetches the row that's about to be recalc'd.
// Returns: scope (work / strategy), artefact_type_id, current flow_state_id,
// parent_artefact_id (so the cascade can recurse up), and archived_at
// (to bail if the row is itself archived — recalc on archived parents
// is a no-op).
const sqlSelectArtefactForRecalc = `
		SELECT
			at.artefacts_types_scope,
			a.artefacts_id_artefact_type,
			a.artefacts_id_flow_state,
			COALESCE(fs.flows_states_kind, '') AS current_kind,
			a.artefacts_id_parent,
			a.artefacts_archived_at
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		WHERE a.artefacts_id = $1 AND a.artefacts_id_subscription = $2
	`

// sqlCountChildrenByKind — bucket the parent's LIVE children by canonical
// kind. Returns one row per kind present. Rows where the child has no
// flow_state_id (NULL — shouldn't happen post-PLA-0055 but defensive)
// are bucketed as 'unknown' and ignored by the rule.
const sqlCountChildrenByKind = `
		SELECT
			COALESCE(fs.flows_states_kind, 'unknown') AS kind,
			count(*) AS n
		FROM artefacts a
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		WHERE a.artefacts_id_parent = $1
		  AND a.artefacts_id_subscription = $2
		  AND a.artefacts_archived_at IS NULL
		GROUP BY kind
	`

// sqlSelectFirstFlowStateByKind — finds the first (lowest sort_order)
// live flow state of the given kind in the artefact-type's default flow.
// Returns sql.ErrNoRows if the flow doesn't expose that kind (e.g. the
// Task default flow has no 'backlog' state). The recalc caller treats
// that as "skip this bucket" rather than fail.
const sqlSelectFirstFlowStateByKind = `
		SELECT fs.flows_states_id
		FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_kind = $2
		  AND fs.flows_states_archived_at IS NULL
		ORDER BY fs.flows_states_sort_order ASC
		LIMIT 1
	`

// sqlCountLiveChildrenOnly — quick existence check for the manual-edit
// guard. Returns the count of live children of `id` in the caller's
// subscription. Used by PatchWorkItem to reject manual flow_state_id
// writes on parented rows (HARD RULE: SERVER IS THE GATE).
const sqlCountLiveChildrenOnly = `
		SELECT count(*) FROM artefacts
		WHERE artefacts_id_parent = $1
		  AND artefacts_id_subscription = $2
		  AND artefacts_archived_at IS NULL
	`

// sqlSetFlowStateInternal — UPDATE used by the recalc engine ONLY.
// Bypasses the per-row "parented → manual edit forbidden" guard because
// the cascade itself is the system writing, not a user. Sets updated_at
// to keep the audit trail honest.
const sqlSetFlowStateInternal = `
		UPDATE artefacts
		SET artefacts_id_flow_state = $1::uuid, artefacts_updated_at = now()
		WHERE artefacts_id = $2 AND artefacts_id_subscription = $3 AND artefacts_archived_at IS NULL
	`

// sqlSelectParentForRecalc — fetch ONLY the parent_artefact_id and
// subscription_id of an artefact, used when wiring patch/archive into
// the cascade (we need the parent id BEFORE the row is changed/gone).
const sqlSelectParentForRecalc = `
		SELECT artefacts_id_parent, artefacts_id_subscription
		FROM artefacts
		WHERE artefacts_id = $1
	`

// sqlSelectCurrentFlowKind — reads the current flows_states_kind of an
// artefact row. Used by the PatchWorkItem cascade guard to allow manual
// edits on terminal-state parents (done / accepted), so the user can
// move a finished parent to accepted or push it back for more work.
// LEFT JOIN tolerates rows that somehow lack a flow_state (defensive —
// shouldn't happen post-mig, but won't crash if it does).
const sqlSelectCurrentFlowKind = `
		SELECT COALESCE(fs.flows_states_kind, '')
		FROM artefacts a
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.artefacts_id_flow_state
		WHERE a.artefacts_id = $1 AND a.artefacts_id_subscription = $2
	`

// sqlSelectFirstReachableStateByKind — finds the first state of the
// target kind that is REACHABLE from `currentStateID` via a single
// flows_transitions edge. Honours tenant-customised transition rules
// (set via /workspace-admin/artefacts/transition-rules) — the cascade
// can't jump backlog→done if the user removed that edge.
//
// Lowest sort_order wins when multiple states of the target kind are
// reachable. Returns sql.ErrNoRows when no edge exists; caller treats
// as "no legal single-hop move toward this kind — stay put".
//
// Why single-hop: the cascade re-fires every time a child changes, so
// even when the path requires multiple hops, the parent makes
// incremental progress on each child action. A user could see "1/2 done
// → Story moves todo→in_progress on next child action" instead of
// jumping in_progress directly. The graph eventually converges.
const sqlSelectFirstReachableStateByKind = `
		SELECT fs.flows_states_id
		FROM flows_transitions ft
		JOIN flows_states fs ON fs.flows_states_id = ft.flows_transitions_id_state_to
		WHERE ft.flows_transitions_id_state_from = $1
		  AND fs.flows_states_kind = $2
		  AND fs.flows_states_archived_at IS NULL
		ORDER BY fs.flows_states_sort_order ASC
		LIMIT 1
	`

// ── BulkOps ────────────────────────────────────────────────────────────────

const sqlSelectArtefactsForBulkLock = `
		SELECT a.artefacts_id::text, lower(at.artefacts_types_name)
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE a.artefacts_id_subscription = $1 AND a.artefacts_id::text = ANY($2) AND a.artefacts_archived_at IS NULL
		FOR UPDATE OF a
	`

const sqlBulkSetPriority = `UPDATE artefacts SET artefacts_id_priority=$1::uuid, artefacts_updated_at=now() WHERE artefacts_id=$2::uuid AND artefacts_id_subscription=$3`

// sqlSelectDefaultPriorityForWorkspace mirrors the frontend's
// pickDefaultPriority: prefer the pri_medium-slotted row in this
// workspace; fall back to the lowest sort_order non-archived row.
// PLA-0055 / story 00595 — used by CreateWorkItem when the caller
// doesn't supply a priority_id.
const sqlSelectDefaultPriorityForWorkspace = `
		SELECT artefact_priorities_id FROM artefact_priorities
		 WHERE artefact_priorities_id_workspace = $1
		   AND artefact_priorities_archived_at IS NULL
		 ORDER BY (artefact_priorities_slot = 'pri_medium') DESC, artefact_priorities_sort_order ASC
		 LIMIT 1
	`

const sqlBulkSetOwner = `UPDATE artefacts SET artefacts_id_user_owned_by=$1::uuid, artefacts_updated_at=now() WHERE artefacts_id=$2::uuid AND artefacts_id_subscription=$3`

const sqlBulkArchive = `UPDATE artefacts SET artefacts_archived_at=now(), artefacts_updated_at=now() WHERE artefacts_id=$1::uuid AND artefacts_id_subscription=$2`

const sqlBulkSetFlowState = `UPDATE artefacts SET artefacts_id_flow_state=$1::uuid, artefacts_updated_at=now() WHERE artefacts_id=$2::uuid AND artefacts_id_subscription=$3`

// ── ListFieldsForType ──────────────────────────────────────────────────────

// sqlListFieldsForType returns the schema for the per-type form: every
// field bound to the artefact type, joined with its field_library
// definition, ordered by display position. Filters out archived library
// rows (binding rows have no archive flag of their own; the library's
// archived_at is the soft-delete authority).
//
// $1 = artefact_type_id (uuid)
// $2 = subscription_id (uuid) — defence-in-depth: the type id is already
//      tenant-private (gen_random_uuid), but cross-tenant scans should
//      never come back even on an enumerating UUID.
const sqlListFieldsForType = `
		SELECT fl.artefacts_fields_library_id::text,
		       fl.artefacts_fields_library_field_name,
		       fl.artefacts_fields_library_label,
		       fl.artefacts_fields_library_field_type,
		       fl.artefacts_fields_library_options_json::text,
		       tf.artefacts_types_fields_position,
		       tf.artefacts_types_fields_required,
		       tf.artefacts_types_fields_default_value
		  FROM artefacts_types_fields tf
		  JOIN artefacts_fields_library fl ON fl.artefacts_fields_library_id = tf.artefacts_types_fields_id_field_library
		  JOIN artefacts_types at ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
		 WHERE tf.artefacts_types_fields_id_artefact_type = $1
		   AND at.artefacts_types_id_subscription = $2
		   AND fl.artefacts_fields_library_archived_at IS NULL
		   AND at.artefacts_types_archived_at IS NULL
		 ORDER BY tf.artefacts_types_fields_position ASC, fl.artefacts_fields_library_field_name ASC
	`

// ── ListFieldValues + UpsertFieldValue + DeleteFieldValue ──────────────────

const sqlListFieldValuesForArtefact = `
		SELECT fv.artefacts_fields_values_id,
		       fv.artefacts_fields_values_id_artefact::text,
		       fl.artefacts_fields_library_id::text,
		       NULL::text,
		       fl.artefacts_fields_library_field_name, fl.artefacts_fields_library_label, fl.artefacts_fields_library_field_type, fl.artefacts_fields_library_options_json,
		       fv.artefacts_fields_values_string_value,
		       fv.artefacts_fields_values_number_value::text,
		       fv.artefacts_fields_values_text_value,
		       fv.artefacts_fields_values_date_value::text
		  FROM artefacts_fields_values fv
		  JOIN artefacts_fields_library fl ON fl.artefacts_fields_library_id = fv.artefacts_fields_values_id_field_library
		 WHERE fv.artefacts_fields_values_id_artefact = $1
		 ORDER BY fl.artefacts_fields_library_field_name ASC
	`

const sqlSelectFieldLibraryType = `
		SELECT artefacts_fields_library_field_type FROM artefacts_fields_library WHERE artefacts_fields_library_id = $1 AND artefacts_fields_library_id_subscription = $2
	`

// sqlSelectFieldLibraryNameAndType returns the field's stable wire name
// (used as the diff key in ArtefactChangedEvent.Fields) alongside its
// type (used to pick the correct value column from the four nullable
// columns in artefacts_fields_values). The rules schema endpoint
// surfaces the same column to the UI, so a rule condition stored
// against this key matches the matcher's lookup.
//
// NOTE: column is `field_name` in the live schema (migration 006). The
// sibling sqlListFieldValuesForArtefact selects `fl.name` which would
// fail at runtime against the same DB — pre-existing latent bug logged
// separately; do not align without auditing all callers of that query.
const sqlSelectFieldLibraryNameAndType = `
		SELECT artefacts_fields_library_field_name, artefacts_fields_library_field_type FROM artefacts_fields_library WHERE artefacts_fields_library_id = $1 AND artefacts_fields_library_id_subscription = $2
	`

// sqlSelectFieldValueByArtefactAndField loads the current row for a
// (artefact, field_library) pair so the producer can snapshot the
// before-value ahead of an upsert. Returns ErrNoRows when the field has
// never been written for this artefact — caller treats that as Before=nil.
const sqlSelectFieldValueByArtefactAndField = `
		SELECT artefacts_fields_values_string_value,
		       artefacts_fields_values_number_value::text,
		       artefacts_fields_values_text_value,
		       artefacts_fields_values_date_value::text
		  FROM artefacts_fields_values
		 WHERE artefacts_fields_values_id_artefact = $1
		   AND artefacts_fields_values_id_field_library = $2
	`

// sqlSelectArtefactSubscriptionID recovers an artefact's owning
// subscription. Used by the custom-field rule-hook path where the
// service doesn't carry a *WorkItem snapshot — Patch/Create already
// have the subscription_id in hand, but UpsertFieldValue / DeleteFieldValue
// don't, and the rules envelope needs it.
const sqlSelectArtefactSubscriptionID = `
		SELECT artefacts_id_subscription FROM artefacts WHERE artefacts_id = $1
	`

// sqlSelectFieldValueByValueRowID is the symmetric lookup for the
// DELETE path — the handler hands us a value-row id (the PK of the
// row in artefacts_fields_values), not a field_library id, so we
// join through to the library row to recover the field name + type
// and the soon-to-be-deleted value. One round-trip.
const sqlSelectFieldValueByValueRowID = `
		SELECT fl.artefacts_fields_library_field_name, fl.artefacts_fields_library_field_type,
		       fv.artefacts_fields_values_string_value,
		       fv.artefacts_fields_values_number_value::text,
		       fv.artefacts_fields_values_text_value,
		       fv.artefacts_fields_values_date_value::text
		  FROM artefacts_fields_values fv
		  JOIN artefacts_fields_library fl ON fl.artefacts_fields_library_id = fv.artefacts_fields_values_id_field_library
		 WHERE fv.artefacts_fields_values_id = $1
		   AND fv.artefacts_fields_values_id_artefact = $2
	`

const sqlUpsertFieldValue = `
		INSERT INTO artefacts_fields_values (
			artefacts_fields_values_id_artefact,
			artefacts_fields_values_id_field_library,
			artefacts_fields_values_string_value,
			artefacts_fields_values_number_value,
			artefacts_fields_values_text_value,
			artefacts_fields_values_date_value
		)
		VALUES ($1, $2, $3, $4::numeric, $5, $6::date)
		ON CONFLICT (artefacts_fields_values_id_artefact, artefacts_fields_values_id_field_library)
		DO UPDATE SET
			artefacts_fields_values_string_value = EXCLUDED.artefacts_fields_values_string_value,
			artefacts_fields_values_number_value = EXCLUDED.artefacts_fields_values_number_value,
			artefacts_fields_values_text_value   = EXCLUDED.artefacts_fields_values_text_value,
			artefacts_fields_values_date_value   = EXCLUDED.artefacts_fields_values_date_value,
			artefacts_fields_values_updated_at   = now()
	`

const sqlDeleteFieldValue = `DELETE FROM artefacts_fields_values WHERE artefacts_fields_values_id = $1 AND artefacts_fields_values_id_artefact = $2`

// ── decorateOwners (mmff_vector) ───────────────────────────────────────────

const sqlSelectActiveUserDisplayNamesByIDs = `
		SELECT users_id::text,
		       COALESCE(NULLIF(TRIM(COALESCE(users_first_name,'') || ' ' || COALESCE(users_last_name,'')), ''), users_email)
		FROM users
		WHERE users_id::text = ANY($1)
		  AND users_is_active = true
	`

// sqlArtefactWorkspaceAndTypeName — single round-trip lookup driving
// the notification-rules hook (fireRuleHook in service.go). Reads
// workspace_id from artefacts and joins to artefacts_types for the
// type NAME (rules engine targets by name post mig 237).
const sqlArtefactWorkspaceAndTypeName = `
		SELECT a.artefacts_id_workspace, t.artefacts_types_name
		FROM artefacts a
		JOIN artefacts_types t ON t.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE a.artefacts_id = $1
	`
