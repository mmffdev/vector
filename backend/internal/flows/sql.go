// Package flows SQL constants.
//
// PLA-0048 / RF1.2.8. Every SQL string literal used by the flows package
// lives here as a named constant. service.go / reset_load.go /
// reset_service.go reference these constants; they DO NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlListFlowsByScope, sqlInsertFlowState, etc.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// Pool: every read/write targets vaPool (vector_artefacts). mainPool is
// retained on Service for the membership/tenancy gate but holds no
// flow data after the PLA-0023 cutover.
package flows

// ── service.go: listing + read ─────────────────────────────────────────────

// sqlListFlowsByScope returns every flow and its states for a workspace,
// scoped by artefact-type scope ('work' or 'strategy').
// $1=subscriptionID, $2=workspaceID, $3=scope.
// Joins flows → artefacts_types → flows_states; the listByScope helper
// then de-duplicates flows in Go.
const sqlListFlowsByScope = `
		SELECT
		    f.flows_id,
		    f.flows_name         AS flow_name,
		    f.flows_is_default,
		    f.flows_id_artefact_type,
		    at.artefacts_types_name  AS type_name,
		    at.artefacts_types_scope AS type_scope,
		    fs.flows_states_id          AS state_id,
		    fs.flows_states_name        AS state_name,
		    fs.flows_states_kind        AS state_kind,
		    fs.flows_states_sort_order  AS state_sort_order,
		    fs.flows_states_is_initial  AS state_is_initial,
		    fs.flows_states_is_pullable AS state_is_pullable,
		    fs.flows_states_colour      AS state_colour,
		    fs.flows_states_description AS state_description
		FROM flows f
		JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		JOIN flows_states    fs ON fs.flows_states_id_flow = f.flows_id AND fs.flows_states_archived_at IS NULL
		WHERE at.artefacts_types_id_subscription = $1
		  AND at.artefacts_types_id_workspace = $2
		  AND at.artefacts_types_scope = $3
		  AND at.artefacts_types_archived_at IS NULL
		  AND f.flows_archived_at IS NULL
		ORDER BY at.artefacts_types_name, f.flows_is_default DESC, fs.flows_states_sort_order;
	`

// sqlListExitRulesForStates fetches active exit rules for a batch of
// state ids in one round-trip. Used by hydrateExitRules to avoid N+1
// when rendering the catalogue list.
const sqlListExitRulesForStates = `
		SELECT flows_states_exit_rules_id, flows_states_exit_rules_id_flow_state, flows_states_exit_rules_sort_order, flows_states_exit_rules_name, flows_states_exit_rules_colour
		FROM   flows_states_exit_rules
		WHERE  flows_states_exit_rules_id_flow_state = ANY($1)
		  AND  flows_states_exit_rules_archived_at IS NULL
		ORDER  BY flows_states_exit_rules_id_flow_state, flows_states_exit_rules_sort_order, flows_states_exit_rules_created_at;
	`

// sqlListTransitionsForFlows returns the allowed-edge set for a batch
// of flows in one round-trip. Used by loadTransitions.
const sqlListTransitionsForFlows = `
		SELECT flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to
		FROM   flows_transitions
		WHERE  flows_transitions_id_flow = ANY($1)
		ORDER  BY flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to;
	`

// ── service.go: flow state CRUD ────────────────────────────────────────────

// sqlPatchFlowState rewrites the mutable fields of one flow state,
// scoped to subscription via the artefacts_types join. COALESCE handles
// nil-as-no-change for everything except description, which uses a
// $9 boolean flag so callers can clear it to NULL.
const sqlPatchFlowState = `
		UPDATE flows_states fs
		SET    flows_states_colour      = COALESCE($1, fs.flows_states_colour),
		       flows_states_name        = COALESCE($4, fs.flows_states_name),
		       flows_states_sort_order  = COALESCE($5, fs.flows_states_sort_order),
		       flows_states_is_initial  = COALESCE($6, fs.flows_states_is_initial),
		       flows_states_kind        = COALESCE($7, fs.flows_states_kind),
		       flows_states_is_pullable = COALESCE($8, fs.flows_states_is_pullable),
		       flows_states_description = CASE WHEN $9::boolean THEN $10 ELSE fs.flows_states_description END
		FROM   flows f
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  fs.flows_states_id      = $2
		  AND  fs.flows_states_id_flow = f.flows_id
		  AND  at.artefacts_types_id_subscription = $3
		  AND  at.artefacts_types_archived_at IS NULL
		  AND  f.flows_archived_at  IS NULL
		  AND  fs.flows_states_archived_at IS NULL
		RETURNING fs.flows_states_id, fs.flows_states_name, fs.flows_states_kind, fs.flows_states_sort_order, fs.flows_states_is_initial, fs.flows_states_is_pullable, fs.flows_states_colour, fs.flows_states_description
	`

// sqlExistsFlowStateInTenant is the tenancy gate used by ListExitRules.
// Confirms the state exists, isn't archived, and belongs to the
// caller's subscription before we expose its exit-rule list.
const sqlExistsFlowStateInTenant = `
		SELECT EXISTS(
			SELECT 1
			FROM   flows_states fs
			JOIN   flows f         ON f.flows_id = fs.flows_states_id_flow
			JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
			WHERE  fs.flows_states_id = $1
			  AND  at.artefacts_types_id_subscription = $2
			  AND  fs.flows_states_archived_at IS NULL
			  AND  f.flows_archived_at  IS NULL
			  AND  at.artefacts_types_archived_at IS NULL
		)
	`

// sqlListExitRulesForState returns active exit rules for one state in
// display order. Caller has already gated on tenancy via
// sqlExistsFlowStateInTenant.
const sqlListExitRulesForState = `
		SELECT flows_states_exit_rules_id, flows_states_exit_rules_sort_order, flows_states_exit_rules_name, flows_states_exit_rules_colour
		FROM   flows_states_exit_rules
		WHERE  flows_states_exit_rules_id_flow_state = $1
		  AND  flows_states_exit_rules_archived_at IS NULL
		ORDER  BY flows_states_exit_rules_sort_order, flows_states_exit_rules_created_at
	`

// sqlInsertExitRuleAppend folds the tenancy check + next-sort-order
// compute + insert into one query. The CTE chain (ok + next_order)
// gates on subscription and computes max(sort_order)+10 before the
// INSERT … SELECT lands the new row.
const sqlInsertExitRuleAppend = `
		WITH ok AS (
			SELECT fs.flows_states_id
			FROM   flows_states fs
			JOIN   flows f         ON f.flows_id = fs.flows_states_id_flow
			JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
			WHERE  fs.flows_states_id = $1
			  AND  at.artefacts_types_id_subscription = $2
			  AND  fs.flows_states_archived_at IS NULL
			  AND  f.flows_archived_at  IS NULL
			  AND  at.artefacts_types_archived_at IS NULL
		),
		next_order AS (
			SELECT COALESCE(MAX(flows_states_exit_rules_sort_order), 0) + 10 AS so
			FROM   flows_states_exit_rules
			WHERE  flows_states_exit_rules_id_flow_state = $1
			  AND  flows_states_exit_rules_archived_at IS NULL
		)
		INSERT INTO flows_states_exit_rules (flows_states_exit_rules_id_flow_state, flows_states_exit_rules_sort_order, flows_states_exit_rules_name, flows_states_exit_rules_colour)
		SELECT ok.flows_states_id, next_order.so, $3, $4
		FROM   ok, next_order
		RETURNING flows_states_exit_rules_id, flows_states_exit_rules_sort_order, flows_states_exit_rules_name, flows_states_exit_rules_colour
	`

// sqlPatchExitRule rewrites mutable fields on one exit rule, scoped to
// subscription. Colour uses a $3 boolean flag so callers can clear it
// to NULL or leave it untouched (same convention as sqlPatchFlowState).
const sqlPatchExitRule = `
		UPDATE flows_states_exit_rules r
		SET    flows_states_exit_rules_name       = COALESCE($1, r.flows_states_exit_rules_name),
		       flows_states_exit_rules_sort_order = COALESCE($2, r.flows_states_exit_rules_sort_order),
		       flows_states_exit_rules_colour     = CASE WHEN $3::boolean THEN $4 ELSE r.flows_states_exit_rules_colour END
		FROM   flows_states fs
		JOIN   flows f         ON f.flows_id = fs.flows_states_id_flow
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  r.flows_states_exit_rules_id            = $5
		  AND  r.flows_states_exit_rules_id_flow_state = fs.flows_states_id
		  AND  at.artefacts_types_id_subscription = $6
		  AND  r.flows_states_exit_rules_archived_at IS NULL
		  AND  fs.flows_states_archived_at IS NULL
		  AND  f.flows_archived_at  IS NULL
		  AND  at.artefacts_types_archived_at IS NULL
		RETURNING r.flows_states_exit_rules_id, r.flows_states_exit_rules_sort_order, r.flows_states_exit_rules_name, r.flows_states_exit_rules_colour
	`

// sqlArchiveExitRule soft-archives one exit rule scoped to subscription.
const sqlArchiveExitRule = `
		UPDATE flows_states_exit_rules r
		SET    flows_states_exit_rules_archived_at = NOW()
		FROM   flows_states fs
		JOIN   flows f         ON f.flows_id = fs.flows_states_id_flow
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  r.flows_states_exit_rules_id            = $1
		  AND  r.flows_states_exit_rules_id_flow_state = fs.flows_states_id
		  AND  at.artefacts_types_id_subscription = $2
		  AND  r.flows_states_exit_rules_archived_at IS NULL
	`

// sqlSelectMaxFlowStateSortOrder returns max(sort_order) for a flow,
// used by CreateState to compute the append position when the caller
// passes sort_order=0.
const sqlSelectMaxFlowStateSortOrder = `
		SELECT COALESCE(MAX(flows_states_sort_order), 0) FROM flows_states WHERE flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
	`

// sqlInsertFlowState appends a new state to a flow, tenancy-gated via
// the artefacts_types join. Returns the hydrated state row.
const sqlInsertFlowState = `
		INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
		SELECT f.flows_id, $3, $4, $5, $6, $7
		FROM   flows f
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  f.flows_id = $1
		  AND  at.artefacts_types_id_subscription = $2
		  AND  f.flows_archived_at IS NULL
		  AND  at.artefacts_types_archived_at IS NULL
		RETURNING flows_states_id, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_colour, flows_states_description
	`

// sqlArchiveFlowState soft-archives one state scoped to subscription.
const sqlArchiveFlowState = `
		UPDATE flows_states fs
		SET    flows_states_archived_at = NOW()
		FROM   flows f
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  fs.flows_states_id = $1
		  AND  fs.flows_states_id_flow = f.flows_id
		  AND  at.artefacts_types_id_subscription = $2
		  AND  fs.flows_states_archived_at IS NULL
	`

// sqlInsertTransition adds an allowed edge to a flow. The ON CONFLICT
// DO NOTHING + RETURNING shape lets the caller distinguish
// "already exists" from "flow not found" via pgx.ErrNoRows.
const sqlInsertTransition = `
		INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
		SELECT f.flows_id, $3, $4
		FROM   flows f
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  f.flows_id = $1
		  AND  at.artefacts_types_id_subscription = $2
		  AND  f.flows_archived_at IS NULL
		  AND  at.artefacts_types_archived_at IS NULL
		ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING
		RETURNING flows_transitions_id_state_from, flows_transitions_id_state_to
	`

// sqlExistsTransition is the after-the-fact existence probe used to
// distinguish ErrTransitionExists from ErrFlowNotFound when
// sqlInsertTransition's RETURNING comes back empty.
const sqlExistsTransition = `
		SELECT EXISTS(SELECT 1 FROM flows_transitions WHERE flows_transitions_id_flow=$1 AND flows_transitions_id_state_from=$2 AND flows_transitions_id_state_to=$3)
	`

// sqlDeleteTransition removes an allowed edge from a flow, scoped to
// subscription via the USING join.
const sqlDeleteTransition = `
		DELETE FROM flows_transitions ft
		USING  flows f
		JOIN   artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE  ft.flows_transitions_id_flow      = f.flows_id
		  AND  f.flows_id            = $1
		  AND  at.artefacts_types_id_subscription = $2
		  AND  ft.flows_transitions_id_state_from   = $3
		  AND  ft.flows_transitions_id_state_to     = $4
	`

// ── reset_load.go: snapshot diffing reads ──────────────────────────────────

// sqlSelectArtefactTypeNameInTenant gates the reset operation on the
// caller's subscription and fetches the type name for the audit/UI.
const sqlSelectArtefactTypeNameInTenant = `
		SELECT artefacts_types_name FROM artefacts_types
		 WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2 AND artefacts_types_archived_at IS NULL
	`

// sqlSelectDefaultFlowForArtefactType returns the live default flow
// for one artefact type (each type has exactly one default flow).
const sqlSelectDefaultFlowForArtefactType = `
		SELECT flows_id, flows_name FROM flows
		 WHERE flows_id_artefact_type = $1 AND flows_is_default = TRUE AND flows_archived_at IS NULL
	`

// sqlListLiveFlowStateRows returns active flows_states rows for one
// flow ordered by sort_order — the "live" side of the reset diff.
const sqlListLiveFlowStateRows = `
		SELECT flows_states_id, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_colour
		FROM   flows_states
		WHERE  flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
		ORDER  BY flows_states_sort_order
	`

// sqlSelectFlowDefaultID returns the flows_defaults snapshot row id for
// an artefact type. pgx.ErrNoRows → ErrNoSnapshot in the caller.
const sqlSelectFlowDefaultID = `
		SELECT flows_defaults_id FROM flows_defaults WHERE flows_defaults_id_artefact_type = $1
	`

// sqlListSnapshotFlowStateRows returns flows_states_defaults rows for
// one flows_defaults snapshot ordered by sort_order — the "snapshot"
// side of the reset diff.
const sqlListSnapshotFlowStateRows = `
		SELECT flows_states_defaults_id, flows_states_defaults_name, flows_states_defaults_kind, flows_states_defaults_sort_order, flows_states_defaults_is_initial, flows_states_defaults_is_pullable, flows_states_defaults_colour
		FROM   flows_states_defaults
		WHERE  flows_states_defaults_id_flow_default = $1
		ORDER  BY flows_states_defaults_sort_order
	`

// sqlListLiveTransitionsWithNames returns transitions plus from/to
// state names for one flow. Names drive the snapshot-edge matching
// since IDs differ between live and snapshot once any edits land.
const sqlListLiveTransitionsWithNames = `
		SELECT ft.flows_transitions_id_state_from, ft.flows_transitions_id_state_to, fs_from.flows_states_name, fs_to.flows_states_name
		FROM   flows_transitions ft
		JOIN   flows_states fs_from ON fs_from.flows_states_id = ft.flows_transitions_id_state_from
		JOIN   flows_states fs_to   ON fs_to.flows_states_id   = ft.flows_transitions_id_state_to
		WHERE  ft.flows_transitions_id_flow = $1
	`

// sqlListSnapshotTransitionsWithNames mirrors
// sqlListLiveTransitionsWithNames for the flows_transitions_defaults /
// flows_states_defaults pair.
const sqlListSnapshotTransitionsWithNames = `
		SELECT ftd.flows_transitions_defaults_id_state_from, ftd.flows_transitions_defaults_id_state_to, fsd_from.flows_states_defaults_name, fsd_to.flows_states_defaults_name
		FROM   flows_transitions_defaults ftd
		JOIN   flows_states_defaults fsd_from ON fsd_from.flows_states_defaults_id = ftd.flows_transitions_defaults_id_state_from
		JOIN   flows_states_defaults fsd_to   ON fsd_to.flows_states_defaults_id   = ftd.flows_transitions_defaults_id_state_to
		WHERE  ftd.flows_transitions_defaults_id_flow_default = $1
	`

// ── reset_service.go: preview + apply ──────────────────────────────────────

// sqlCountArtefactsOnFlowState is the impact probe per "remove" pill:
// counts how many live artefacts would need to rebind onto a successor.
const sqlCountArtefactsOnFlowState = `
		SELECT COUNT(*) FROM artefacts WHERE flow_state_id = $1 AND archived_at IS NULL
	`

// sqlRebindArtefactsToSuccessor moves every live artefact from a
// to-be-archived pill onto its computed successor inside the reset tx.
// Runs BEFORE the source pill is archived to avoid momentary FK
// confusion (though FKs allow soft-archived rows).
const sqlRebindArtefactsToSuccessor = `
		UPDATE artefacts SET flow_state_id = $1, updated_at = now()
		WHERE flow_state_id = $2 AND archived_at IS NULL
	`

// sqlArchiveFlowStateByID is the unconditional soft-archive used by
// ApplyReset. The tenancy gate was already enforced by loadResetData;
// inside the tx we trust the diff and archive by id only.
const sqlArchiveFlowStateByID = `
		UPDATE flows_states SET flows_states_archived_at = now() WHERE flows_states_id = $1
	`

// sqlUpdateFlowStateOrderAndFlags rewrites sort_order + is_initial +
// is_pullable on a kept-but-changed pill during ApplyReset.
const sqlUpdateFlowStateOrderAndFlags = `
		UPDATE flows_states SET flows_states_sort_order = $1, flows_states_is_initial = $2, flows_states_is_pullable = $3 WHERE flows_states_id = $4
	`

// sqlInsertFlowStateForReset adds a missing pill back to the live flow
// during ApplyReset. No subscription gate inside the tx — the parent
// flow + subscription gate was enforced by loadResetData upstream.
const sqlInsertFlowStateForReset = `
		INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

// sqlDeleteFlowTransitionByFlowFromTo hard-deletes a transition during
// ApplyReset (transitions are never soft-archived; they're cheap to
// recreate).
const sqlDeleteFlowTransitionByFlowFromTo = `
		DELETE FROM flows_transitions WHERE flows_transitions_id_flow = $1 AND flows_transitions_id_state_from = $2 AND flows_transitions_id_state_to = $3
	`

// sqlInsertFlowTransitionIdempotent adds a transition back during
// ApplyReset. ON CONFLICT DO NOTHING handles the case where a parallel
// reset (or a prior partial run) already restored the edge.
const sqlInsertFlowTransitionIdempotent = `
		INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
	`

// sqlListFlowStateNameIDs returns name → id pairs for live states on
// one flow. Used by ApplyReset post-mutation to remap snapshot edges
// to the new state ids before reinserting transitions.
const sqlListFlowStateNameIDs = `
		SELECT flows_states_id, flows_states_name FROM flows_states WHERE flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
	`
