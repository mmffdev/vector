// Package portfoliomodels SQL constants.
//
// PLA-0048 / RF1.2.20 (FINAL). The adoption saga + dev reset + workspace
// layers + adoption-state surfaces cross three databases:
//
//   - libRO       — mmff_library (delegated to librarydb)
//   - vectorPool  — mmff_vector  (workspace + role lookups)
//   - vaPool      — vector_artefacts (artefacts_types, artefacts, flows,
//                   timeboxes, topology, master_record_*, adoption state,
//                   error_events post-PLA-0023-P1)
//
// Last package on the RF1.2 conveyor. Consolidates SQL from service.go,
// adoption_state.go, adopt.go, adopt_strategy_types.go, adopt_flows.go,
// adopt_readopt.go, adopt_work_types.go, dev_reset.go.
package portfoliomodels

// ── service.go (workspace layers + tenancy) ────────────────────────────────

// sqlSelectWorkspaceSubscriptionID returns the workspace's owning
// subscription so callers can refuse cross-tenant reads.
const sqlSelectWorkspaceSubscriptionID = `SELECT subscription_id FROM master_record_workspaces WHERE id = $1`

// sqlExistsActiveWorkspaceMembership probes whether the user holds any
// live grant on the workspace.
const sqlExistsActiveWorkspaceMembership = `
		SELECT EXISTS (
		    SELECT 1
		      FROM users_roles_workspaces
		     WHERE users_roles_workspaces_id_workspace = $1
		       AND users_roles_workspaces_id_user      = $2
		       AND users_roles_workspaces_revoked_at  IS NULL
		)
	`

// sqlListWorkspaceStrategyArtefactTypes returns the live strategy
// artefacts_types for a workspace, ordered parent-first.
const sqlListWorkspaceStrategyArtefactTypes = `
		SELECT artefacts_types_id, artefacts_types_id_workspace,
		       artefacts_types_id_library_layer,
		       artefacts_types_name, artefacts_types_prefix, artefacts_types_sort_order,
		       artefacts_types_id_parent_type,
		       artefacts_types_description, artefacts_types_allows_children,
		       artefacts_types_is_placeholder,
		       artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
		  FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1
		   AND artefacts_types_scope         = 'strategy'
		   AND artefacts_types_archived_at  IS NULL
		 ORDER BY (artefacts_types_id_parent_type IS NOT NULL),
		          artefacts_types_sort_order,
		          artefacts_types_name
	`

// sqlPatchWorkspaceStrategyArtefactType updates one strategy artefact_type
// scoped to its workspace.
const sqlPatchWorkspaceStrategyArtefactType = `
		UPDATE artefacts_types
		   SET artefacts_types_name        = $1,
		       artefacts_types_prefix      = $2,
		       artefacts_types_sort_order  = $3,
		       artefacts_types_description = $4
		 WHERE artefacts_types_id           = $5
		   AND artefacts_types_id_workspace = $6
		   AND artefacts_types_scope        = 'strategy'
		   AND artefacts_types_archived_at IS NULL
	`

// ── adoption_state.go ──────────────────────────────────────────────────────

// sqlSelectFirstLiveWorkspaceForSubscription returns the lowest-id live
// workspace for a subscription. Mirrors the saga's resolveWorkspaceID.
const sqlSelectFirstLiveWorkspaceForSubscription = `
		SELECT id
		  FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY id
		 LIMIT 1
	`

// sqlSelectAdoptionStateForWorkspace is the LEFT JOIN that computes
// (hasMaster, hasStrategyType, modelID, adoptedAt, adoptedByUserID)
// for a workspace in one round-trip.
const sqlSelectAdoptionStateForWorkspace = `
		SELECT
			(mrp.master_record_portfolios_id_workspace IS NOT NULL) AS has_master,
			EXISTS (
				SELECT 1
				  FROM artefacts_types at
				 WHERE at.artefacts_types_id_workspace = $1
				   AND at.artefacts_types_scope = 'strategy'
				   AND at.artefacts_types_archived_at IS NULL
			) AS has_strategy_type,
			mrp.master_record_portfolios_id_library_portfolio_model,
			mrp.master_record_portfolios_adopted_at,
			mrp.master_record_portfolios_id_user_adopter
		  FROM (SELECT $1::uuid AS workspace_id) k
		  LEFT JOIN master_record_portfolios mrp
		    ON mrp.master_record_portfolios_id_workspace = k.workspace_id
		   AND mrp.master_record_portfolios_archived_at IS NULL
	`

// ── adopt.go (orchestrator state + errors) ─────────────────────────────────

// sqlSelectActiveAdoptionState returns the live (non-archived)
// artefacts_adoption_states row for a workspace.
const sqlSelectActiveAdoptionState = `
		SELECT id, model_id, status, adopted_at
		  FROM artefacts_adoption_states
		 WHERE workspace_id = $1
		   AND archived_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 1
	`

// sqlInsertAdoptionState writes a fresh in_progress row.
const sqlInsertAdoptionState = `
		INSERT INTO artefacts_adoption_states
		    (workspace_id, subscription_id, model_id, adopted_by_user_id, status)
		VALUES ($1, $2, $3, $4, 'in_progress')
		RETURNING id
	`

// sqlArchiveCompletedStateForReadoption soft-archives a completed row
// when the operator switches to a different model.
const sqlArchiveCompletedStateForReadoption = `
		UPDATE artefacts_adoption_states
		   SET archived_at = NOW()
		 WHERE id = $1
		   AND workspace_id = $2
		   AND status = 'completed'
		   AND archived_at IS NULL
	`

// sqlArchiveStaleFailedAdoptionState soft-archives a failed row for a
// different model so the partial unique index admits a fresh row.
const sqlArchiveStaleFailedAdoptionState = `
		UPDATE artefacts_adoption_states
		   SET archived_at = NOW()
		 WHERE id = $1
		   AND workspace_id = $2
		   AND status = 'failed'
		   AND archived_at IS NULL
	`

// sqlResetFailedAdoptionStateToInProgress flips a previously-failed
// row back so a retry of the same model resumes idempotently.
const sqlResetFailedAdoptionStateToInProgress = `
		UPDATE artefacts_adoption_states
		   SET status = 'in_progress'
		 WHERE id = $1
		   AND workspace_id = $2
		   AND status = 'failed'
		   AND archived_at IS NULL
	`

// sqlMarkAdoptionStateCompleted finalises the saga.
const sqlMarkAdoptionStateCompleted = `
		UPDATE artefacts_adoption_states
		   SET status = 'completed',
		       adopted_by_user_id = $2,
		       adopted_at = NOW()
		 WHERE id = $1
		   AND workspace_id = $3
		 RETURNING adopted_at
	`

// sqlMarkAdoptionStateFailed flips the row to failed in the abort path.
const sqlMarkAdoptionStateFailed = `
		UPDATE artefacts_adoption_states
		   SET status = 'failed'
		 WHERE id = $1
		   AND workspace_id = $2
		   AND archived_at IS NULL
	`

// sqlInsertErrorEvent persists one error_events row (the saga's
// failure-record path).
const sqlInsertErrorEvent = `
		INSERT INTO errors_events (
			errors_events_id_subscription,
			errors_events_id_user,
			errors_events_code,
			errors_events_context,
			errors_events_request_id
		) VALUES ($1, $2, $3, $4, $5)
	`

// ── adopt_strategy_types.go (B3) ───────────────────────────────────────────

// sqlInsertStrategyArtefactType — Phase 1 of B3 (parent_type_id=NULL).
const sqlInsertStrategyArtefactType = `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_sort_order,
			artefacts_types_id_library_layer, artefacts_types_library_layer_tag
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			$3, $4, $5,
			NULL, $6, $7,
			$8, $9
		)
		ON CONFLICT (artefacts_types_id_workspace, artefacts_types_scope, artefacts_types_prefix)
			WHERE artefacts_types_archived_at IS NULL
			DO NOTHING
	`

// sqlUpdateStrategyArtefactTypeParent — Phase 2 of B3 (set parent_type_id).
const sqlUpdateStrategyArtefactTypeParent = `
		UPDATE artefacts_types
		   SET artefacts_types_id_parent_type = $1
		 WHERE artefacts_types_id = $2
		   AND artefacts_types_id_workspace = $3
		   AND artefacts_types_scope = 'strategy'
		   AND artefacts_types_archived_at IS NULL
	`

// sqlSelectStrategyArtefactTypeMap returns library_layer_id → id for
// every live strategy artefact_type in this workspace.
const sqlSelectStrategyArtefactTypeMap = `
		SELECT artefacts_types_id_library_layer, artefacts_types_id
		  FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1
		   AND artefacts_types_scope = 'strategy'
		   AND artefacts_types_archived_at IS NULL
		   AND artefacts_types_id_library_layer IS NOT NULL
	`

// ── adopt_flows.go (B4) ────────────────────────────────────────────────────

const sqlInsertDefaultFlowForLayer = `
		INSERT INTO flows (
			flows_id_artefact_type, flows_name, flows_description,
			flows_is_default, flows_id_library_layer
		) VALUES (
			$1, $2, NULL,
			TRUE, $3
		)
		ON CONFLICT (flows_id_artefact_type)
			WHERE flows_is_default = TRUE AND flows_archived_at IS NULL
			DO NOTHING
	`

const sqlInsertFlowStateForWorkflow = `
		INSERT INTO flows_states (
			flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_colour, flows_states_sort_order, flows_states_is_initial,
			flows_states_id_library_workflow
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7
		)
		ON CONFLICT (flows_states_id_flow, flows_states_id_library_workflow)
			WHERE flows_states_archived_at IS NULL AND flows_states_id_library_workflow IS NOT NULL
			DO NOTHING
	`

const sqlInsertFlowTransitionForLibrary = `
		INSERT INTO flows_transitions (
			flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to, flows_transitions_required_permission
		) VALUES (
			$1, $2, $3, NULL
		)
		ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
			DO NOTHING
	`

const sqlSelectFlowStateLibMap = `
		SELECT fs.flows_states_id_library_workflow, fs.flows_states_id
		  FROM flows_states fs
		  JOIN flows f          ON f.flows_id = fs.flows_states_id_flow
		  JOIN artefacts_types t ON t.artefacts_types_id = f.flows_id_artefact_type
		 WHERE t.artefacts_types_id_workspace = $1
		   AND t.artefacts_types_scope = 'strategy'
		   AND t.artefacts_types_archived_at IS NULL
		   AND f.flows_archived_at IS NULL
		   AND fs.flows_states_archived_at IS NULL
		   AND fs.flows_states_id_library_workflow IS NOT NULL
	`

const sqlSelectDefaultFlowMap = `
		SELECT f.flows_id_artefact_type, f.flows_id
		  FROM flows f
		  JOIN artefacts_types t ON t.artefacts_types_id = f.flows_id_artefact_type
		 WHERE t.artefacts_types_id_workspace = $1
		   AND t.artefacts_types_scope = 'strategy'
		   AND t.artefacts_types_archived_at IS NULL
		   AND f.flows_archived_at IS NULL
		   AND f.flows_is_default = TRUE
	`

const sqlSelectFlowStateFlowMap = `
		SELECT fs.flows_states_id, fs.flows_states_id_flow
		  FROM flows_states fs
		  JOIN flows f          ON f.flows_id = fs.flows_states_id_flow
		  JOIN artefacts_types t ON t.artefacts_types_id = f.flows_id_artefact_type
		 WHERE t.artefacts_types_id_workspace = $1
		   AND t.artefacts_types_scope = 'strategy'
		   AND t.artefacts_types_archived_at IS NULL
		   AND f.flows_archived_at IS NULL
		   AND fs.flows_states_archived_at IS NULL
	`

// ── adopt_readopt.go (B8 placeholder + repoint) ────────────────────────────

const sqlUpsertReadoptPlaceholderType = `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_sort_order,
			artefacts_types_id_library_layer, artefacts_types_library_layer_tag,
			artefacts_types_is_placeholder
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			'Pending re-classification', '__P',
			'Re-adoption placeholder. Move every work item into the new model, then archive this bin.',
			NULL, FALSE, 9999,
			NULL, NULL,
			TRUE
		)
		ON CONFLICT (artefacts_types_id_workspace) WHERE artefacts_types_is_placeholder = TRUE AND artefacts_types_archived_at IS NULL
			DO UPDATE SET artefacts_types_updated_at = now()
		RETURNING artefacts_types_id
	`

const sqlUpsertReadoptPlaceholderArtefact = `
		INSERT INTO artefacts (
			subscription_id, workspace_id,
			artefact_type_id,
			number,
			title, description,
			parent_artefact_id, flow_state_id,
			priority_id,
			created_by_user_id, owned_by_user_id,
			position
		) VALUES (
			$1, $2,
			$3,
			1,
			'Pending re-classification',
			'These work items were attached to the previous portfolio model. Move each into a layer of the new model, then archive this bin.',
			NULL, NULL,
			(SELECT id FROM artefact_priorities WHERE workspace_id = $2 AND archived_at IS NULL ORDER BY sort_order LIMIT 1),
			$4, $4,
			0
		)
		ON CONFLICT (subscription_id, artefact_type_id, number) DO UPDATE
			SET updated_at = now()
		RETURNING id
	`

const sqlRepointOrphanWorkArtefactsToPlaceholder = `
		UPDATE artefacts AS a
		   SET parent_artefact_id = $1,
		       updated_at = now()
		  FROM artefacts AS p
		  JOIN artefacts_types AS pt ON pt.artefacts_types_id = p.artefact_type_id
		 WHERE a.parent_artefact_id = p.id
		   AND a.workspace_id = $2
		   AND a.archived_at IS NULL
		   AND pt.artefacts_types_scope = 'strategy'
		   AND pt.artefacts_types_is_placeholder = FALSE
		   AND pt.artefacts_types_id_workspace = $2
	`

const sqlDeleteOldStrategyArtefacts = `
		DELETE FROM artefacts AS a
		 USING artefacts_types AS t
		 WHERE a.artefact_type_id = t.artefacts_types_id
		   AND a.workspace_id = $1
		   AND t.artefacts_types_id_workspace = $1
		   AND t.artefacts_types_scope = 'strategy'
		   AND t.artefacts_types_is_placeholder = FALSE
	`

const sqlArchiveOldStrategyArtefactTypes = `
		UPDATE artefacts_types
		   SET artefacts_types_archived_at = now(),
		       artefacts_types_updated_at  = now()
		 WHERE artefacts_types_id_workspace = $1
		   AND artefacts_types_scope = 'strategy'
		   AND artefacts_types_is_placeholder = FALSE
		   AND artefacts_types_archived_at IS NULL
	`

// ── adopt_work_types.go (B5) ───────────────────────────────────────────────

const sqlInsertWorkArtefactTypeFromSystem = `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_sort_order,
			artefacts_types_id_library_layer, artefacts_types_library_layer_tag
		) VALUES (
			$1, $2,
			'work', 'tenant',
			$3, $4, $5,
			NULL, $6, $7,
			NULL, NULL
		)
		ON CONFLICT (artefacts_types_id_workspace, artefacts_types_scope, artefacts_types_prefix)
			WHERE artefacts_types_archived_at IS NULL
			DO NOTHING
	`

const sqlUpdateWorkArtefactTypeParent = `
		UPDATE artefacts_types
		   SET artefacts_types_id_parent_type = $1
		 WHERE artefacts_types_id = $2
		   AND artefacts_types_id_workspace = $3
		   AND artefacts_types_scope = 'work'
		   AND artefacts_types_archived_at IS NULL
	`

const sqlSelectSystemWorkTypes = `
		SELECT artefacts_types_id, artefacts_types_id_parent_type, artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
		       artefacts_types_allows_children, artefacts_types_sort_order
		  FROM artefacts_types
		 WHERE artefacts_types_id_subscription = $1
		   AND artefacts_types_scope  = 'work'
		   AND artefacts_types_source = 'system'
		   AND artefacts_types_archived_at IS NULL
		 ORDER BY artefacts_types_sort_order, artefacts_types_name
	`

const sqlSelectWorkTenantPrefixMap = `
		SELECT artefacts_types_prefix, artefacts_types_id
		  FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1
		   AND artefacts_types_scope  = 'work'
		   AND artefacts_types_source = 'tenant'
		   AND artefacts_types_archived_at IS NULL
	`

// ── dev_reset.go ───────────────────────────────────────────────────────────

const sqlDeleteAllAdoptionStateForSubscription = `DELETE FROM artefacts_adoption_states WHERE subscription_id = $1`

// TD-RESET-001 fix (2026-05-14): artefacts_fields_values has NO subscription_id
// column — scoping reaches through artefacts.subscription_id (FK on the parent
// artefact). Old query (DELETE … WHERE subscription_id = $1) would error;
// MasterReset wouldn't have worked against any tenant carrying field values.
const sqlDeleteAllArtefactFieldValuesForSubscription = `
		DELETE FROM artefacts_fields_values fv
		 USING artefacts a
		 WHERE fv.artefacts_fields_values_id_artefact = a.id
		   AND a.subscription_id = $1
	`

const sqlDeleteAllArtefactsForSubscription = `DELETE FROM artefacts WHERE subscription_id = $1`

// sqlCountArtefactsForSubscription — used by ArtefactsCount pre-flight
// (GET /_site/admin/dev/artefacts-count). Returns live / archived / total
// rows for one tenant; archived_at NULL = live.
const sqlCountArtefactsForSubscription = `
	SELECT
	  count(*) FILTER (WHERE archived_at IS NULL),
	  count(*) FILTER (WHERE archived_at IS NOT NULL),
	  count(*)
	FROM artefacts
	WHERE subscription_id = $1
`

const sqlDeleteArtefactNumberSequenceForSubscription = `DELETE FROM artefacts_number_sequences WHERE subscription_id = $1`

const sqlDeleteTenantArtefactTypesForSubscription = `DELETE FROM artefacts_types WHERE artefacts_types_id_subscription = $1 AND artefacts_types_source = 'tenant'`

const sqlDeleteAllTimeboxSprintsForSubscription = `DELETE FROM timeboxes_sprints WHERE timeboxes_sprints_id_subscription = $1`

const sqlDeleteAllTimeboxReleasesForSubscription = `DELETE FROM timeboxes_releases WHERE timeboxes_releases_id_subscription = $1`

const sqlDeleteMasterRecordPortfolioForWorkspace = `DELETE FROM master_record_portfolios WHERE master_record_portfolios_id_workspace = $1`

const sqlUpsertTestbedTenantRecord = `
		INSERT INTO master_record_workspaces (
			master_record_workspaces_id_workspace,
			master_record_workspaces_name,
			master_record_workspaces_description,
			master_record_workspaces_id_user_owner,
			master_record_workspaces_data_region,
			master_record_workspaces_timezone,
			master_record_workspaces_date_format,
			master_record_workspaces_datetime_format,
			master_record_workspaces_workdays,
			master_record_workspaces_week_start,
			master_record_workspaces_rank_method,
			master_record_workspaces_build_changeset_tracking,
			master_record_workspaces_primary_contact_email
		) VALUES (
			$1, 'ACME Bank', 'MMFFDev Testbed', $2,
			'euw2', 'Europe/London', 'DD/MM/YYYY', 'DD/MM/YYYY HH:mm',
			ARRAY['mon','tue','wed','thu','fri']::text[],
			'mon', 'manual', FALSE, 'cookra@me.com'
		)
		ON CONFLICT (master_record_workspaces_id_workspace) DO UPDATE
		   SET master_record_workspaces_name                     = EXCLUDED.master_record_workspaces_name,
		       master_record_workspaces_description              = EXCLUDED.master_record_workspaces_description,
		       master_record_workspaces_id_user_owner            = EXCLUDED.master_record_workspaces_id_user_owner,
		       master_record_workspaces_data_region              = EXCLUDED.master_record_workspaces_data_region,
		       master_record_workspaces_timezone                 = EXCLUDED.master_record_workspaces_timezone,
		       master_record_workspaces_date_format              = EXCLUDED.master_record_workspaces_date_format,
		       master_record_workspaces_datetime_format          = EXCLUDED.master_record_workspaces_datetime_format,
		       master_record_workspaces_workdays                 = EXCLUDED.master_record_workspaces_workdays,
		       master_record_workspaces_week_start               = EXCLUDED.master_record_workspaces_week_start,
		       master_record_workspaces_rank_method              = EXCLUDED.master_record_workspaces_rank_method,
		       master_record_workspaces_build_changeset_tracking = EXCLUDED.master_record_workspaces_build_changeset_tracking,
		       master_record_workspaces_primary_contact_email    = EXCLUDED.master_record_workspaces_primary_contact_email,
		       master_record_workspaces_updated_at               = now()
	`

// sqlSeedDevStrategyArtefactsFn calls the SQL function installed by
// db/vector_artefacts/schema/052_seed_dev_strategy_artefacts.sql to populate
// starter strategy artefacts. Idempotent via ON CONFLICT inside the fn.
const sqlSeedDevStrategyArtefactsFn = `SELECT seed_dev_strategy_artefacts($1, $2)`

// sqlResolveRiskTypeForSubscription — returns the live Risk artefact_type_id
// and its workspace_id for a given subscription. Used by SeedRisks.
const sqlResolveRiskTypeForSubscription = `
		SELECT artefacts_types_id, artefacts_types_id_workspace
		  FROM artefacts_types
		 WHERE artefacts_types_id_subscription = $1
		   AND artefacts_types_scope = 'work'
		   AND lower(artefacts_types_name) = 'risk'
		   AND artefacts_types_archived_at IS NULL
		 ORDER BY artefacts_types_created_at
		 LIMIT 1
	`

// sqlSeedRisks — bulk-inserts $5 Risk artefacts for ($1 subscription,
// $2 workspace, $3 risk_type_id, $4 assignee). Round-robins over the default
// Risk flow's states and the four priority levels. Mirrors
// db/vector_artefacts/dev-seeds/seed_risks.sql. Returns row count.
const sqlSeedRisks = `
		WITH default_flow AS (
		  SELECT flows_id FROM flows
		   WHERE flows_id_artefact_type = $3
		     AND flows_is_default = TRUE
		     AND flows_archived_at IS NULL
		   LIMIT 1
		),
		flow_states AS (
		  SELECT array_agg(flows_states_id ORDER BY flows_states_sort_order) AS states
		    FROM flows_states
		   WHERE flows_states_id_flow = (SELECT flows_id FROM default_flow)
		     AND flows_states_archived_at IS NULL
		),
		existing AS (
		  SELECT COALESCE(MAX(number), 0) AS max_num
		    FROM artefacts
		   WHERE artefact_type_id = $3 AND subscription_id = $1
		),
		seq AS (SELECT generate_series(1, $5::int) AS n),
		ins AS (
		  INSERT INTO artefacts (
		    subscription_id, workspace_id, artefact_type_id, number, title, description,
		    flow_state_id, created_by_user_id, assigned_to_user_id, owned_by_user_id, priority
		  )
		  SELECT
		    $1, $2, $3,
		    e.max_num + s.n,
		    CASE (s.n % 10)
		      WHEN 0 THEN 'Unencrypted data at rest in audit logs'
		      WHEN 1 THEN 'Single point of failure in payment gateway'
		      WHEN 2 THEN 'Vendor dependency on legacy CMS'
		      WHEN 3 THEN 'Insufficient capacity for peak season traffic'
		      WHEN 4 THEN 'Stale credentials in CI environment'
		      WHEN 5 THEN 'Regulatory exposure from GDPR retention gap'
		      WHEN 6 THEN 'Key person dependency in platform team'
		      WHEN 7 THEN 'Backup restore not tested in 12 months'
		      WHEN 8 THEN 'Third-party SDK with known CVE'
		      ELSE      'Privileged access without quarterly review'
		    END || ' (#' || (e.max_num + s.n)::text || ')',
		    'Auto-seeded risk. Severity/likelihood vary to populate the dashboard matrix.',
		    (SELECT states[1 + ((s.n - 1) % cardinality(states))] FROM flow_states),
		    $4, $4, $4,
		    CASE (s.n % 4)
		      WHEN 0 THEN 'critical'
		      WHEN 1 THEN 'high'
		      WHEN 2 THEN 'medium'
		      ELSE      'low'
		    END
		  FROM seq s, existing e
		  RETURNING 1
		)
		SELECT count(*) FROM ins
	`

const sqlDeleteRolesWorkspacesForSubscription = `
		DELETE FROM users_roles_workspaces
		 WHERE users_roles_workspaces_id_workspace IN (
		     SELECT id FROM master_record_workspaces WHERE subscription_id = $1
		 )
	`

const sqlDeleteAllWorkspacesForSubscription = `DELETE FROM master_record_workspaces WHERE subscription_id = $1`

const sqlDevSeedWorkspace = `
	INSERT INTO master_record_workspaces (subscription_id, name, slug, description, created_by)
	VALUES ($1, $2, $3, '', $4)
	RETURNING id`

const sqlDevSeedWorkspaceCreatorGrant = `
	INSERT INTO users_roles_workspaces (
		users_roles_workspaces_id_subscription,
		users_roles_workspaces_id_workspace,
		users_roles_workspaces_id_user,
		users_roles_workspaces_role,
		users_roles_workspaces_id_user_granted_by
	) VALUES ($1, $2, $3, 'admin', $3)`
