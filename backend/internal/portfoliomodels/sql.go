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
		     WHERE workspace_id = $1
		       AND user_id      = $2
		       AND revoked_at  IS NULL
		)
	`

// sqlListWorkspaceStrategyArtefactTypes returns the live strategy
// artefacts_types for a workspace, ordered parent-first.
const sqlListWorkspaceStrategyArtefactTypes = `
		SELECT id, workspace_id,
		       library_layer_id,
		       name, prefix, sort_order,
		       parent_type_id,
		       description, allows_children,
		       is_placeholder,
		       archived_at, created_at, updated_at
		  FROM artefacts_types
		 WHERE workspace_id = $1
		   AND scope         = 'strategy'
		   AND archived_at  IS NULL
		 ORDER BY (parent_type_id IS NOT NULL),
		          sort_order,
		          name
	`

// sqlPatchWorkspaceStrategyArtefactType updates one strategy artefact_type
// scoped to its workspace.
const sqlPatchWorkspaceStrategyArtefactType = `
		UPDATE artefacts_types
		   SET name        = $1,
		       prefix      = $2,
		       sort_order  = $3,
		       description = $4
		 WHERE id           = $5
		   AND workspace_id = $6
		   AND scope        = 'strategy'
		   AND archived_at IS NULL
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
				 WHERE at.workspace_id = $1
				   AND at.scope = 'strategy'
				   AND at.archived_at IS NULL
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
			subscription_id, workspace_id,
			scope, source,
			name, prefix, description,
			parent_type_id, allows_children, sort_order,
			library_layer_id, library_layer_tag
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			$3, $4, $5,
			NULL, $6, $7,
			$8, $9
		)
		ON CONFLICT (workspace_id, scope, prefix)
			WHERE archived_at IS NULL
			DO NOTHING
	`

// sqlUpdateStrategyArtefactTypeParent — Phase 2 of B3 (set parent_type_id).
const sqlUpdateStrategyArtefactTypeParent = `
		UPDATE artefacts_types
		   SET parent_type_id = $1
		 WHERE id = $2
		   AND workspace_id = $3
		   AND scope = 'strategy'
		   AND archived_at IS NULL
	`

// sqlSelectStrategyArtefactTypeMap returns library_layer_id → id for
// every live strategy artefact_type in this workspace.
const sqlSelectStrategyArtefactTypeMap = `
		SELECT library_layer_id, id
		  FROM artefacts_types
		 WHERE workspace_id = $1
		   AND scope = 'strategy'
		   AND archived_at IS NULL
		   AND library_layer_id IS NOT NULL
	`

// ── adopt_flows.go (B4) ────────────────────────────────────────────────────

const sqlInsertDefaultFlowForLayer = `
		INSERT INTO flows (
			artefact_type_id, name, description,
			is_default, library_layer_id
		) VALUES (
			$1, $2, NULL,
			TRUE, $3
		)
		ON CONFLICT (artefact_type_id)
			WHERE is_default = TRUE AND archived_at IS NULL
			DO NOTHING
	`

const sqlInsertFlowStateForWorkflow = `
		INSERT INTO flows_states (
			flow_id, name, kind, colour, sort_order, is_initial,
			library_workflow_id
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7
		)
		ON CONFLICT (flow_id, library_workflow_id)
			WHERE archived_at IS NULL AND library_workflow_id IS NOT NULL
			DO NOTHING
	`

const sqlInsertFlowTransitionForLibrary = `
		INSERT INTO flows_transitions (
			flow_id, from_state_id, to_state_id, required_permission
		) VALUES (
			$1, $2, $3, NULL
		)
		ON CONFLICT (flow_id, from_state_id, to_state_id)
			DO NOTHING
	`

const sqlSelectFlowStateLibMap = `
		SELECT fs.library_workflow_id, fs.id
		  FROM flows_states fs
		  JOIN flows f          ON f.id = fs.flow_id
		  JOIN artefacts_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND t.archived_at IS NULL
		   AND f.archived_at IS NULL
		   AND fs.archived_at IS NULL
		   AND fs.library_workflow_id IS NOT NULL
	`

const sqlSelectDefaultFlowMap = `
		SELECT f.artefact_type_id, f.id
		  FROM flows f
		  JOIN artefacts_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND t.archived_at IS NULL
		   AND f.archived_at IS NULL
		   AND f.is_default = TRUE
	`

const sqlSelectFlowStateFlowMap = `
		SELECT fs.id, fs.flow_id
		  FROM flows_states fs
		  JOIN flows f          ON f.id = fs.flow_id
		  JOIN artefacts_types t ON t.id = f.artefact_type_id
		 WHERE t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND t.archived_at IS NULL
		   AND f.archived_at IS NULL
		   AND fs.archived_at IS NULL
	`

// ── adopt_readopt.go (B8 placeholder + repoint) ────────────────────────────

const sqlUpsertReadoptPlaceholderType = `
		INSERT INTO artefacts_types (
			subscription_id, workspace_id,
			scope, source,
			name, prefix, description,
			parent_type_id, allows_children, sort_order,
			library_layer_id, library_layer_tag,
			is_placeholder
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			'Pending re-classification', '__P',
			'Re-adoption placeholder. Move every work item into the new model, then archive this bin.',
			NULL, FALSE, 9999,
			NULL, NULL,
			TRUE
		)
		ON CONFLICT (workspace_id) WHERE is_placeholder = TRUE AND archived_at IS NULL
			DO UPDATE SET updated_at = now()
		RETURNING id
	`

const sqlUpsertReadoptPlaceholderArtefact = `
		INSERT INTO artefacts (
			subscription_id, workspace_id,
			artefact_type_id,
			number,
			title, description,
			parent_artefact_id, flow_state_id,
			created_by_user_id, owned_by_user_id,
			position
		) VALUES (
			$1, $2,
			$3,
			1,
			'Pending re-classification',
			'These work items were attached to the previous portfolio model. Move each into a layer of the new model, then archive this bin.',
			NULL, NULL,
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
		  JOIN artefacts_types AS pt ON pt.id = p.artefact_type_id
		 WHERE a.parent_artefact_id = p.id
		   AND a.workspace_id = $2
		   AND a.archived_at IS NULL
		   AND pt.scope = 'strategy'
		   AND pt.is_placeholder = FALSE
		   AND pt.workspace_id = $2
	`

const sqlDeleteOldStrategyArtefacts = `
		DELETE FROM artefacts AS a
		 USING artefacts_types AS t
		 WHERE a.artefact_type_id = t.id
		   AND a.workspace_id = $1
		   AND t.workspace_id = $1
		   AND t.scope = 'strategy'
		   AND t.is_placeholder = FALSE
	`

const sqlArchiveOldStrategyArtefactTypes = `
		UPDATE artefacts_types
		   SET archived_at = now(),
		       updated_at  = now()
		 WHERE workspace_id = $1
		   AND scope = 'strategy'
		   AND is_placeholder = FALSE
		   AND archived_at IS NULL
	`

// ── adopt_work_types.go (B5) ───────────────────────────────────────────────

const sqlInsertWorkArtefactTypeFromSystem = `
		INSERT INTO artefacts_types (
			subscription_id, workspace_id,
			scope, source,
			name, prefix, description,
			parent_type_id, allows_children, sort_order,
			library_layer_id, library_layer_tag
		) VALUES (
			$1, $2,
			'work', 'tenant',
			$3, $4, $5,
			NULL, $6, $7,
			NULL, NULL
		)
		ON CONFLICT (workspace_id, scope, prefix)
			WHERE archived_at IS NULL
			DO NOTHING
	`

const sqlUpdateWorkArtefactTypeParent = `
		UPDATE artefacts_types
		   SET parent_type_id = $1
		 WHERE id = $2
		   AND workspace_id = $3
		   AND scope = 'work'
		   AND archived_at IS NULL
	`

const sqlSelectSystemWorkTypes = `
		SELECT id, parent_type_id, name, prefix, description,
		       allows_children, sort_order
		  FROM artefacts_types
		 WHERE subscription_id = $1
		   AND scope  = 'work'
		   AND source = 'system'
		   AND archived_at IS NULL
		 ORDER BY sort_order, name
	`

const sqlSelectWorkTenantPrefixMap = `
		SELECT prefix, id
		  FROM artefacts_types
		 WHERE workspace_id = $1
		   AND scope  = 'work'
		   AND source = 'tenant'
		   AND archived_at IS NULL
	`

// ── dev_reset.go ───────────────────────────────────────────────────────────

const sqlDeleteAllAdoptionStateForSubscription = `DELETE FROM artefacts_adoption_states WHERE subscription_id = $1`

const sqlDeleteAllArtefactFieldValuesForSubscription = `DELETE FROM artefacts_fields_values WHERE subscription_id = $1`

const sqlDeleteAllArtefactsForSubscription = `DELETE FROM artefacts WHERE subscription_id = $1`

const sqlDeleteArtefactNumberSequenceForSubscription = `DELETE FROM artefacts_number_sequences WHERE subscription_id = $1`

const sqlDeleteTenantArtefactTypesForSubscription = `DELETE FROM artefacts_types WHERE subscription_id = $1 AND source = 'tenant'`

const sqlDeleteAllTimeboxSprintsForSubscription = `DELETE FROM timeboxes_sprints WHERE timeboxes_sprints_id_subscription = $1`

const sqlDeleteAllTimeboxReleasesForSubscription = `DELETE FROM timeboxes_releases WHERE timeboxes_releases_id_subscription = $1`

const sqlDeleteAllTopologyRoleGrantsForSubscription = `DELETE FROM users_roles_topology_nodes WHERE users_roles_topology_nodes_id_subscription = $1`

const sqlDeleteAllTopologyViewStateForSubscription = `DELETE FROM topology_view_states WHERE topology_view_states_id_subscription = $1`

const sqlDetachTopologyParentsForSubscription = `UPDATE topology_nodes SET parent_id = NULL WHERE subscription_id = $1`

const sqlDeleteAllTopologyNodesForSubscription = `DELETE FROM topology_nodes WHERE subscription_id = $1`

const sqlDeleteMasterRecordPortfolioForWorkspace = `DELETE FROM master_record_portfolios WHERE master_record_portfolios_id_workspace = $1`

const sqlUpsertTestbedTenantRecord = `
		INSERT INTO master_record_tenants (
			workspace_id,
			tenant_name,
			tenant_description,
			tenant_owner_user_id,
			tenant_data_region,
			tenant_timezone,
			tenant_date_format,
			tenant_datetime_format,
			tenant_workdays,
			tenant_week_start,
			tenant_rank_method,
			tenant_build_changeset_tracking,
			tenant_primary_contact_email
		) VALUES (
			$1, 'ACME Bank', 'MMFFDev Testbed', $2,
			'euw2', 'Europe/London', 'DD/MM/YYYY', 'DD/MM/YYYY HH:mm',
			ARRAY['mon','tue','wed','thu','fri']::text[],
			'mon', 'manual', FALSE, 'cookra@me.com'
		)
		ON CONFLICT (workspace_id) DO UPDATE
		   SET tenant_name                     = EXCLUDED.tenant_name,
		       tenant_description              = EXCLUDED.tenant_description,
		       tenant_owner_user_id            = EXCLUDED.tenant_owner_user_id,
		       tenant_data_region              = EXCLUDED.tenant_data_region,
		       tenant_timezone                 = EXCLUDED.tenant_timezone,
		       tenant_date_format              = EXCLUDED.tenant_date_format,
		       tenant_datetime_format          = EXCLUDED.tenant_datetime_format,
		       tenant_workdays                 = EXCLUDED.tenant_workdays,
		       tenant_week_start               = EXCLUDED.tenant_week_start,
		       tenant_rank_method              = EXCLUDED.tenant_rank_method,
		       tenant_build_changeset_tracking = EXCLUDED.tenant_build_changeset_tracking,
		       tenant_primary_contact_email    = EXCLUDED.tenant_primary_contact_email,
		       tenant_updated_at               = now()
	`

const sqlInsertTestbedRootTopologyNode = `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id,
			name, description, layout_mode, collapsed_default, sort_order
		) VALUES (
			gen_random_uuid(), $1, $2, NULL,
			'ACME Bank', '', 'auto-horizontal', FALSE, 0
		)
	`

// sqlSeedDevStrategyArtefactsFn calls the SQL function installed by
// db/vector_artefacts/schema/052_seed_dev_strategy_artefacts.sql to populate
// starter strategy artefacts. Idempotent via ON CONFLICT inside the fn.
const sqlSeedDevStrategyArtefactsFn = `SELECT seed_dev_strategy_artefacts($1, $2)`

const sqlDeleteRolesWorkspacesForSubscription = `
		DELETE FROM users_roles_workspaces
		 WHERE workspace_id IN (
		     SELECT id FROM master_record_workspaces WHERE subscription_id = $1
		 )
	`

const sqlDeleteAllWorkspacesForSubscription = `DELETE FROM master_record_workspaces WHERE subscription_id = $1`
