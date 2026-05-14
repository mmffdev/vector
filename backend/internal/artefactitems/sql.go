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
	lower(at.name)                  AS item_type,
	at.prefix                       AS type_prefix,
	a.title,
	a.description,
	''                              AS status,
	COALESCE(fs.id::text, '')        AS flow_state_id,
	COALESCE(fs.name, '')            AS flow_state_name,
	CASE fs.kind
		WHEN 'todo'        THEN 'backlog'
		WHEN 'in_progress' THEN 'doing'
		WHEN 'done'        THEN 'completed'
		WHEN 'cancelled'   THEN 'cancelled'
		ELSE                    'backlog'
	END                             AS flow_state_code,
	a.priority,
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
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = $2%s
	`

// sqlListWorkItemsTemplate is the paged data query. %s slots: extra
// WHERE; ORDER BY; LIMIT/OFFSET bind indexes.
const sqlListWorkItemsTemplate = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = $2%s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`

// sqlSelectWorkItemByID is the single-row hydration used by GetWorkItem.
const sqlSelectWorkItemByID = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.id = $2
		  AND a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = $3
	`

// sqlListChildWorkItems lists direct children of a parent.
const sqlListChildWorkItems = `
		WITH ` + rollupCTE + `
		SELECT` + sqlWorkItemColumns + `
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.parent_artefact_id = $2
		  AND a.archived_at IS NULL
		  AND at.scope = $3
		ORDER BY a.position ASC, a.number ASC
	`

// ── SummariseWorkItems ─────────────────────────────────────────────────────

// sqlSummariseTotalTemplate computes (total, blocked) — %s holds the
// composed WHERE clause.
const sqlSummariseTotalTemplate = `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (
				WHERE (fs.kind = 'todo' OR fs.id IS NULL)
				  AND a.updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		WHERE %s
	`

// sqlSummariseByTypeTemplate buckets counts by artefact_type.name. %s
// holds the composed WHERE clause shared with the total query.
const sqlSummariseByTypeTemplate = `
		SELECT lower(at.name) AS name, COUNT(*)
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		LEFT JOIN flows_states fs ON fs.id = a.flow_state_id
		WHERE %s
		GROUP BY lower(at.name)
	`

// ── ListFlowStates ─────────────────────────────────────────────────────────

const sqlListWorkScopeFlowStates = `
		SELECT fs.id, fs.sort_order, fs.name, fs.kind
		FROM flows_states fs
		JOIN flows f ON f.id = fs.flow_id
		WHERE f.artefact_type_id = (
			SELECT at.id FROM artefacts_types at
			JOIN flows f2 ON f2.artefact_type_id = at.id
			WHERE at.subscription_id = $1
			  AND at.scope = $2
			  AND f2.is_default = TRUE
			  AND f2.archived_at IS NULL
			  AND at.archived_at IS NULL
			ORDER BY at.created_at ASC
			LIMIT 1
		)
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.archived_at IS NULL
		ORDER BY fs.sort_order ASC
	`

// ── CreateWorkItem ─────────────────────────────────────────────────────────

const sqlSelectArtefactTypeIDForCreate = `
		SELECT id FROM artefacts_types
		WHERE subscription_id = $1
		  AND scope = $3
		  AND lower(name) = $2
		  AND archived_at IS NULL
		LIMIT 1
	`

const sqlAllocateArtefactNumber = `
		INSERT INTO artefacts_number_sequences (subscription_id, artefact_type_id, next_num)
		VALUES ($1, $2, 2)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = artefacts_number_sequences.next_num + 1
		RETURNING next_num - 1
	`

const sqlSelectDefaultInitialFlowState = `
		SELECT fs.id FROM flows_states fs
		JOIN flows f ON f.id = fs.flow_id
		WHERE f.artefact_type_id = $1
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.is_initial = TRUE
		  AND fs.archived_at IS NULL
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
			 flow_state_id, priority, story_points, artefacts_id_timebox_sprint, parent_artefact_id,
			 owned_by_user_id, created_by_user_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id
	`

// ── PatchWorkItem ──────────────────────────────────────────────────────────

const sqlExistsFlowStateInSubscription = `
		SELECT EXISTS(
			SELECT 1 FROM flows_states fs
			JOIN flows f ON f.id = fs.flow_id
			JOIN artefacts_types at ON at.id = f.artefact_type_id
			WHERE fs.id = $1
			  AND at.subscription_id = $2
			  AND fs.archived_at IS NULL
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
		SELECT a.id::text, lower(at.name)
		FROM artefacts a
		JOIN artefacts_types at ON at.id = a.artefact_type_id
		WHERE a.subscription_id = $1 AND a.id::text = ANY($2) AND a.archived_at IS NULL
		FOR UPDATE OF a
	`

const sqlBulkSetPriority = `UPDATE artefacts SET priority=$1, updated_at=now() WHERE id=$2::uuid AND subscription_id=$3`

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
