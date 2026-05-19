// Package artefactitems SQL constants.
//
// PLA-0048 / RF1.2.19. Sole writer for artefacts + artefacts_fields_values
// (vector_artefacts); read-only against mmff_vector for owner decoration
// and workspace resolution.
package artefactitems

// rollupCTE is the WITH RECURSIVE expression spliced into the list,
// get-one, and list-children data queries. Independent const so the
// data SELECTs reference it as `WITH ` + rollupCTE + ` SELECT …`.
//
// (Naming: keeps the historical name from when this lived inline —
// migrating the const but preserving the identifier means handler
// tests that import this symbol keep working unchanged.)
const rollupCTE = `rollup_points AS (
	SELECT
		a.id,
		CASE WHEN EXISTS (
			SELECT 1 FROM artefacts c
			WHERE c.parent_artefact_id = a.id AND c.archived_at IS NULL
		) THEN (
			WITH RECURSIVE descendants AS (
				SELECT id, story_points
				FROM artefacts
				WHERE parent_artefact_id = a.id AND archived_at IS NULL
				UNION ALL
				SELECT child.id, child.story_points
				FROM artefacts child
				JOIN descendants d ON child.parent_artefact_id = d.id
				WHERE child.archived_at IS NULL
			)
			SELECT COALESCE(SUM(story_points), 0) FROM descendants
		) ELSE NULL END AS rollup_points
	FROM artefacts a
	WHERE a.subscription_id = $1
	  AND a.archived_at IS NULL
)`

// sqlWorkItemColumns is the shared SELECT column list used by the data
// queries (List + Get + ListChildren). Kept as a fragment string so all
// three projections stay in lockstep.
const sqlWorkItemColumns = `
	a.id::text,
	a.subscription_id::text,
	a.number                        AS key_num,
	lower(at.artefacts_types_name)  AS item_type,
	at.artefacts_types_prefix       AS type_prefix,
	a.title,
	a.description,
	''                              AS status,
	COALESCE(fs.flows_states_id::text, '')        AS flow_state_id,
	COALESCE(fs.flows_states_name, '')            AS flow_state_name,
	CASE fs.flows_states_kind
		WHEN 'todo'        THEN 'backlog'
		WHEN 'in_progress' THEN 'doing'
		WHEN 'done'        THEN 'completed'
		WHEN 'cancelled'   THEN 'cancelled'
		ELSE                    'backlog'
	END                             AS flow_state_code,
	a.priority_id::text                        AS priority_id,
	pri.name                                   AS priority_name,
	pri.slot                                   AS priority_slot,
	pri.sort_order                             AS priority_sort_order,
	a.story_points,
	a.artefacts_id_timebox_sprint::text,
	NULL::text                      AS sprint_ref_id,
	NULL::text                      AS sprint_ref_alias,
	a.parent_artefact_id::text      AS parent_id,
	NULL::text                      AS root_feature_id,
	COALESCE(a.owned_by_user_id::text, '') AS owner_id,
	NULL::text                      AS owner_ref_id,
	NULL::text                      AS owner_display_name,
	NULL::text                      AS owner_avatar_url,
	a.due_date::text,
	COALESCE(a.created_by_user_id::text, '') AS created_by,
	a.created_at,
	a.updated_at,
	a.archived_at,
	(SELECT count(*) FROM artefacts child
	 WHERE child.parent_artefact_id = a.id
	   AND child.archived_at IS NULL)        AS children_count,
	COALESCE(rp.rollup_points, a.story_points) AS rollup_points`

// sqlCountWorkItemsTemplate is the count-only query used by List. The
// extraWhere is composed in Go from the active filter set; %s slot.
const sqlCountWorkItemsTemplate = `
		SELECT count(*) FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_scope = $2%s
	`

// sqlListWorkItemsTemplate is the paged data query. %s slots: extra
// WHERE; ORDER BY; LIMIT/OFFSET bind indexes.
const sqlListWorkItemsTemplate = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_scope = $2%s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`

// sqlSelectWorkItemByID is the single-row hydration used by GetWorkItem.
// Subscription-clamped only; admin/migration callers without a workspace
// context use this entry point.
const sqlSelectWorkItemByID = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.id = $2
		  AND a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_scope = $3
	`

// sqlSelectWorkItemByIDInWorkspace is the workspace-clamped sibling of
// sqlSelectWorkItemByID. PLA-0053 / story 00579 — handler picks this
// when topology.WorkspaceIDFromCtx returns a clamp; cross-workspace
// IDs return pgx.ErrNoRows (translated to 404 by the handler), so no
// existence leak between workspaces.
const sqlSelectWorkItemByIDInWorkspace = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.id = $2
		  AND a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_scope = $3
		  AND at.artefacts_types_id_workspace = $4
	`

// sqlListChildWorkItems lists direct children of a parent.
const sqlListChildWorkItems = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.parent_artefact_id = $2
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_scope = $3
		ORDER BY a.position ASC, a.number ASC
	`

// ── SummariseWorkItems ─────────────────────────────────────────────────────

// sqlSummariseTotalTemplate computes (total, blocked) — %s holds the
// composed WHERE clause.
const sqlSummariseTotalTemplate = `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (
				WHERE (fs.flows_states_kind = 'todo' OR fs.flows_states_id IS NULL)
				  AND a.updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
		WHERE %s
	`

// sqlSummariseByTypeTemplate buckets counts by artefact_type.name. %s
// holds the composed WHERE clause shared with the total query.
const sqlSummariseByTypeTemplate = `
		SELECT lower(at.artefacts_types_name) AS name, COUNT(*)
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
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
				a.id,
				fs.flows_states_kind AS flow_kind,
				LOWER(MAX(fvi.artefacts_fields_values_string_value) FILTER (
					WHERE fli.field_name = 'risk_impact'
				)) AS severity,
				LOWER(MAX(fvp.artefacts_fields_values_string_value) FILTER (
					WHERE flp.field_name = 'risk_probability'
				)) AS likelihood
			FROM artefacts a
			JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
			LEFT JOIN flows_states fs ON fs.flows_states_id = a.flow_state_id
		LEFT JOIN artefact_priorities pri ON pri.id = a.priority_id
			LEFT JOIN artefacts_fields_values fvi
				ON fvi.artefacts_fields_values_id_artefact = a.id
			LEFT JOIN artefacts_fields_library fli
				ON fli.id = fvi.artefacts_fields_values_id_field_library
			LEFT JOIN artefacts_fields_values fvp
				ON fvp.artefacts_fields_values_id_artefact = a.id
			LEFT JOIN artefacts_fields_library flp
				ON flp.id = fvp.artefacts_fields_values_id_field_library
			WHERE a.subscription_id = $1
			  AND a.archived_at IS NULL
			  AND lower(at.artefacts_types_name) = 'risk'
			GROUP BY a.id, fs.flows_states_kind
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

const sqlListWorkScopeFlowStates = `
		SELECT fs.flows_states_id, fs.flows_states_sort_order, fs.flows_states_name, fs.flows_states_kind
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
		INSERT INTO artefacts_number_sequences (subscription_id, artefact_type_id, next_num)
		VALUES (
			$1, $2,
			(SELECT COALESCE(MAX(number), 0) + 2 FROM artefacts WHERE subscription_id = $1 AND artefact_type_id = $2)
		)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = GREATEST(
				artefacts_number_sequences.next_num + 1,
				(SELECT COALESCE(MAX(number), 0) + 2 FROM artefacts WHERE subscription_id = $1 AND artefact_type_id = $2)
			)
		RETURNING next_num - 1
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
		SELECT id FROM master_record_workspaces
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY created_at ASC LIMIT 1
	`

const sqlSelectNextArtefactPosition = `
		SELECT COALESCE(MAX(position), 0) + 100 FROM artefacts
		WHERE subscription_id = $1
		  AND artefact_type_id = $2
		  AND archived_at IS NULL
	`

const sqlInsertArtefact = `
		INSERT INTO artefacts
			(subscription_id, workspace_id, artefact_type_id, number, title, description,
			 flow_state_id, priority_id, story_points, artefacts_id_timebox_sprint, parent_artefact_id,
			 owned_by_user_id, created_by_user_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10,$11,$12,$13,$14)
		RETURNING id
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
		WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`

// ── ArchiveWorkItem ────────────────────────────────────────────────────────

const sqlArchiveArtefact = `
		UPDATE artefacts
		SET archived_at = now(), updated_at = now()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
	`

// ── BulkOps ────────────────────────────────────────────────────────────────

const sqlSelectArtefactsForBulkLock = `
		SELECT a.id::text, lower(at.artefacts_types_name)
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		WHERE a.subscription_id = $1 AND a.id::text = ANY($2) AND a.archived_at IS NULL
		FOR UPDATE OF a
	`

const sqlBulkSetPriority = `UPDATE artefacts SET priority_id=$1::uuid, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`

// sqlSelectDefaultPriorityForWorkspace mirrors the frontend's
// pickDefaultPriority: prefer the pri_medium-slotted row in this
// workspace; fall back to the lowest sort_order non-archived row.
// PLA-0055 / story 00595 — used by CreateWorkItem when the caller
// doesn't supply a priority_id.
const sqlSelectDefaultPriorityForWorkspace = `
		SELECT id FROM artefact_priorities
		 WHERE workspace_id = $1
		   AND archived_at IS NULL
		 ORDER BY (slot = 'pri_medium') DESC, sort_order ASC
		 LIMIT 1
	`

const sqlBulkSetOwner = `UPDATE artefacts SET owned_by_user_id=$1::uuid, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`

const sqlBulkArchive = `UPDATE artefacts SET archived_at=now(), updated_at=now() WHERE id=$1::uuid AND subscription_id=$2`

const sqlBulkSetFlowState = `UPDATE artefacts SET flow_state_id=$1::uuid, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`

// ── ListFieldValues + UpsertFieldValue + DeleteFieldValue ──────────────────

const sqlListFieldValuesForArtefact = `
		SELECT fv.artefacts_fields_values_id,
		       fv.artefacts_fields_values_id_artefact::text,
		       fl.id::text,
		       NULL::text,
		       fl.name, fl.label, fl.field_type, fl.options_json,
		       fv.artefacts_fields_values_string_value,
		       fv.artefacts_fields_values_number_value::text,
		       fv.artefacts_fields_values_text_value,
		       fv.artefacts_fields_values_date_value::text
		  FROM artefacts_fields_values fv
		  JOIN artefacts_fields_library fl ON fl.id = fv.artefacts_fields_values_id_field_library
		 WHERE fv.artefacts_fields_values_id_artefact = $1
		 ORDER BY fl.name ASC
	`

const sqlSelectFieldLibraryType = `
		SELECT field_type FROM artefacts_fields_library WHERE id = $1 AND subscription_id = $2
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
		SELECT id::text,
		       COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email)
		FROM users
		WHERE id::text = ANY($1)
		  AND is_active = true
	`
