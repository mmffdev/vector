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

// sqlListFlowsByScope returns every flow and its states for a
// subscription, scoped by artefact-type scope ('work' or 'strategy').
// Joins flows → artefact_types → flows_states; the listByScope helper
// then de-duplicates flows in Go.
const sqlListFlowsByScope = `
		SELECT
		    f.id,
		    f.name         AS flow_name,
		    f.is_default,
		    f.artefact_type_id,
		    at.name        AS type_name,
		    at.scope       AS type_scope,
		    fs.id          AS state_id,
		    fs.name        AS state_name,
		    fs.kind        AS state_kind,
		    fs.sort_order  AS state_sort_order,
		    fs.is_initial  AS state_is_initial,
		    fs.is_pullable AS state_is_pullable,
		    fs.colour      AS state_colour,
		    fs.description AS state_description
		FROM flows f
		JOIN artefact_types at ON at.id = f.artefact_type_id
		JOIN flows_states    fs ON fs.flow_id = f.id AND fs.archived_at IS NULL
		WHERE at.subscription_id = $1
		  AND at.scope = $2
		  AND at.archived_at IS NULL
		  AND f.archived_at IS NULL
		ORDER BY at.name, f.is_default DESC, fs.sort_order;
	`

// sqlListExitRulesForStates fetches active exit rules for a batch of
// state ids in one round-trip. Used by hydrateExitRules to avoid N+1
// when rendering the catalogue list.
const sqlListExitRulesForStates = `
		SELECT id, flow_state_id, sort_order, name, colour
		FROM   flows_states_exit_rules
		WHERE  flow_state_id = ANY($1)
		  AND  archived_at IS NULL
		ORDER  BY flow_state_id, sort_order, created_at;
	`

// sqlListTransitionsForFlows returns the allowed-edge set for a batch
// of flows in one round-trip. Used by loadTransitions.
const sqlListTransitionsForFlows = `
		SELECT flow_id, from_state_id, to_state_id
		FROM   flows_transitions
		WHERE  flow_id = ANY($1)
		ORDER  BY flow_id, from_state_id, to_state_id;
	`

// ── service.go: flow state CRUD ────────────────────────────────────────────

// sqlPatchFlowState rewrites the mutable fields of one flow state,
// scoped to subscription via the artefact_types join. COALESCE handles
// nil-as-no-change for everything except description, which uses a
// $9 boolean flag so callers can clear it to NULL.
const sqlPatchFlowState = `
		UPDATE flows_states fs
		SET    colour      = COALESCE($1, fs.colour),
		       name        = COALESCE($4, fs.name),
		       sort_order  = COALESCE($5, fs.sort_order),
		       is_initial  = COALESCE($6, fs.is_initial),
		       kind        = COALESCE($7, fs.kind),
		       is_pullable = COALESCE($8, fs.is_pullable),
		       description = CASE WHEN $9::boolean THEN $10 ELSE fs.description END
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  fs.id      = $2
		  AND  fs.flow_id = f.id
		  AND  at.subscription_id = $3
		  AND  at.archived_at IS NULL
		  AND  f.archived_at  IS NULL
		  AND  fs.archived_at IS NULL
		RETURNING fs.id, fs.name, fs.kind, fs.sort_order, fs.is_initial, fs.is_pullable, fs.colour, fs.description
	`

// sqlExistsFlowStateInTenant is the tenancy gate used by ListExitRules.
// Confirms the state exists, isn't archived, and belongs to the
// caller's subscription before we expose its exit-rule list.
const sqlExistsFlowStateInTenant = `
		SELECT EXISTS(
			SELECT 1
			FROM   flows_states fs
			JOIN   flows f         ON f.id = fs.flow_id
			JOIN   artefact_types at ON at.id = f.artefact_type_id
			WHERE  fs.id = $1
			  AND  at.subscription_id = $2
			  AND  fs.archived_at IS NULL
			  AND  f.archived_at  IS NULL
			  AND  at.archived_at IS NULL
		)
	`

// sqlListExitRulesForState returns active exit rules for one state in
// display order. Caller has already gated on tenancy via
// sqlExistsFlowStateInTenant.
const sqlListExitRulesForState = `
		SELECT id, sort_order, name, colour
		FROM   flows_states_exit_rules
		WHERE  flow_state_id = $1
		  AND  archived_at IS NULL
		ORDER  BY sort_order, created_at
	`

// sqlInsertExitRuleAppend folds the tenancy check + next-sort-order
// compute + insert into one query. The CTE chain (ok + next_order)
// gates on subscription and computes max(sort_order)+10 before the
// INSERT … SELECT lands the new row.
const sqlInsertExitRuleAppend = `
		WITH ok AS (
			SELECT fs.id
			FROM   flows_states fs
			JOIN   flows f         ON f.id = fs.flow_id
			JOIN   artefact_types at ON at.id = f.artefact_type_id
			WHERE  fs.id = $1
			  AND  at.subscription_id = $2
			  AND  fs.archived_at IS NULL
			  AND  f.archived_at  IS NULL
			  AND  at.archived_at IS NULL
		),
		next_order AS (
			SELECT COALESCE(MAX(sort_order), 0) + 10 AS so
			FROM   flows_states_exit_rules
			WHERE  flow_state_id = $1
			  AND  archived_at IS NULL
		)
		INSERT INTO flows_states_exit_rules (flow_state_id, sort_order, name, colour)
		SELECT ok.id, next_order.so, $3, $4
		FROM   ok, next_order
		RETURNING id, sort_order, name, colour
	`

// sqlPatchExitRule rewrites mutable fields on one exit rule, scoped to
// subscription. Colour uses a $3 boolean flag so callers can clear it
// to NULL or leave it untouched (same convention as sqlPatchFlowState).
const sqlPatchExitRule = `
		UPDATE flows_states_exit_rules r
		SET    name       = COALESCE($1, r.name),
		       sort_order = COALESCE($2, r.sort_order),
		       colour     = CASE WHEN $3::boolean THEN $4 ELSE r.colour END
		FROM   flows_states fs
		JOIN   flows f         ON f.id = fs.flow_id
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  r.id            = $5
		  AND  r.flow_state_id = fs.id
		  AND  at.subscription_id = $6
		  AND  r.archived_at IS NULL
		  AND  fs.archived_at IS NULL
		  AND  f.archived_at  IS NULL
		  AND  at.archived_at IS NULL
		RETURNING r.id, r.sort_order, r.name, r.colour
	`

// sqlArchiveExitRule soft-archives one exit rule scoped to subscription.
const sqlArchiveExitRule = `
		UPDATE flows_states_exit_rules r
		SET    archived_at = NOW()
		FROM   flows_states fs
		JOIN   flows f         ON f.id = fs.flow_id
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  r.id            = $1
		  AND  r.flow_state_id = fs.id
		  AND  at.subscription_id = $2
		  AND  r.archived_at IS NULL
	`

// sqlSelectMaxFlowStateSortOrder returns max(sort_order) for a flow,
// used by CreateState to compute the append position when the caller
// passes sort_order=0.
const sqlSelectMaxFlowStateSortOrder = `
		SELECT COALESCE(MAX(sort_order), 0) FROM flows_states WHERE flow_id = $1 AND archived_at IS NULL
	`

// sqlInsertFlowState appends a new state to a flow, tenancy-gated via
// the artefact_types join. Returns the hydrated state row.
const sqlInsertFlowState = `
		INSERT INTO flows_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
		SELECT f.id, $3, $4, $5, $6, $7
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  f.id = $1
		  AND  at.subscription_id = $2
		  AND  f.archived_at IS NULL
		  AND  at.archived_at IS NULL
		RETURNING id, name, kind, sort_order, is_initial, is_pullable, colour, description
	`

// sqlArchiveFlowState soft-archives one state scoped to subscription.
const sqlArchiveFlowState = `
		UPDATE flows_states fs
		SET    archived_at = NOW()
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  fs.id = $1
		  AND  fs.flow_id = f.id
		  AND  at.subscription_id = $2
		  AND  fs.archived_at IS NULL
	`

// sqlInsertTransition adds an allowed edge to a flow. The ON CONFLICT
// DO NOTHING + RETURNING shape lets the caller distinguish
// "already exists" from "flow not found" via pgx.ErrNoRows.
const sqlInsertTransition = `
		INSERT INTO flows_transitions (flow_id, from_state_id, to_state_id)
		SELECT f.id, $3, $4
		FROM   flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  f.id = $1
		  AND  at.subscription_id = $2
		  AND  f.archived_at IS NULL
		  AND  at.archived_at IS NULL
		ON CONFLICT (flow_id, from_state_id, to_state_id) DO NOTHING
		RETURNING from_state_id, to_state_id
	`

// sqlExistsTransition is the after-the-fact existence probe used to
// distinguish ErrTransitionExists from ErrFlowNotFound when
// sqlInsertTransition's RETURNING comes back empty.
const sqlExistsTransition = `
		SELECT EXISTS(SELECT 1 FROM flows_transitions WHERE flow_id=$1 AND from_state_id=$2 AND to_state_id=$3)
	`

// sqlDeleteTransition removes an allowed edge from a flow, scoped to
// subscription via the USING join.
const sqlDeleteTransition = `
		DELETE FROM flows_transitions ft
		USING  flows f
		JOIN   artefact_types at ON at.id = f.artefact_type_id
		WHERE  ft.flow_id      = f.id
		  AND  f.id            = $1
		  AND  at.subscription_id = $2
		  AND  ft.from_state_id   = $3
		  AND  ft.to_state_id     = $4
	`

// ── reset_load.go: snapshot diffing reads ──────────────────────────────────

// sqlSelectArtefactTypeNameInTenant gates the reset operation on the
// caller's subscription and fetches the type name for the audit/UI.
const sqlSelectArtefactTypeNameInTenant = `
		SELECT name FROM artefact_types
		 WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
	`

// sqlSelectDefaultFlowForArtefactType returns the live default flow
// for one artefact type (each type has exactly one default flow).
const sqlSelectDefaultFlowForArtefactType = `
		SELECT id, name FROM flows
		 WHERE artefact_type_id = $1 AND is_default = TRUE AND archived_at IS NULL
	`

// sqlListLiveFlowStateRows returns active flows_states rows for one
// flow ordered by sort_order — the "live" side of the reset diff.
const sqlListLiveFlowStateRows = `
		SELECT id, name, kind, sort_order, is_initial, is_pullable, colour
		FROM   flows_states
		WHERE  flow_id = $1 AND archived_at IS NULL
		ORDER  BY sort_order
	`

// sqlSelectFlowDefaultID returns the flows_defaults snapshot row id for
// an artefact type. pgx.ErrNoRows → ErrNoSnapshot in the caller.
const sqlSelectFlowDefaultID = `
		SELECT id FROM flows_defaults WHERE artefact_type_id = $1
	`

// sqlListSnapshotFlowStateRows returns flows_states_defaults rows for
// one flows_defaults snapshot ordered by sort_order — the "snapshot"
// side of the reset diff.
const sqlListSnapshotFlowStateRows = `
		SELECT id, name, kind, sort_order, is_initial, is_pullable, colour
		FROM   flows_states_defaults
		WHERE  flow_default_id = $1
		ORDER  BY sort_order
	`

// sqlListLiveTransitionsWithNames returns transitions plus from/to
// state names for one flow. Names drive the snapshot-edge matching
// since IDs differ between live and snapshot once any edits land.
const sqlListLiveTransitionsWithNames = `
		SELECT ft.from_state_id, ft.to_state_id, fs_from.name, fs_to.name
		FROM   flows_transitions ft
		JOIN   flows_states fs_from ON fs_from.id = ft.from_state_id
		JOIN   flows_states fs_to   ON fs_to.id   = ft.to_state_id
		WHERE  ft.flow_id = $1
	`

// sqlListSnapshotTransitionsWithNames mirrors
// sqlListLiveTransitionsWithNames for the flows_transitions_defaults /
// flows_states_defaults pair.
const sqlListSnapshotTransitionsWithNames = `
		SELECT ftd.from_state_id, ftd.to_state_id, fsd_from.name, fsd_to.name
		FROM   flows_transitions_defaults ftd
		JOIN   flows_states_defaults fsd_from ON fsd_from.id = ftd.from_state_id
		JOIN   flows_states_defaults fsd_to   ON fsd_to.id   = ftd.to_state_id
		WHERE  ftd.flow_default_id = $1
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
		UPDATE flows_states SET archived_at = now() WHERE id = $1
	`

// sqlUpdateFlowStateOrderAndFlags rewrites sort_order + is_initial +
// is_pullable on a kept-but-changed pill during ApplyReset.
const sqlUpdateFlowStateOrderAndFlags = `
		UPDATE flows_states SET sort_order = $1, is_initial = $2, is_pullable = $3 WHERE id = $4
	`

// sqlInsertFlowStateForReset adds a missing pill back to the live flow
// during ApplyReset. No subscription gate inside the tx — the parent
// flow + subscription gate was enforced by loadResetData upstream.
const sqlInsertFlowStateForReset = `
		INSERT INTO flows_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

// sqlDeleteFlowTransitionByFlowFromTo hard-deletes a transition during
// ApplyReset (transitions are never soft-archived; they're cheap to
// recreate).
const sqlDeleteFlowTransitionByFlowFromTo = `
		DELETE FROM flows_transitions WHERE flow_id = $1 AND from_state_id = $2 AND to_state_id = $3
	`

// sqlInsertFlowTransitionIdempotent adds a transition back during
// ApplyReset. ON CONFLICT DO NOTHING handles the case where a parallel
// reset (or a prior partial run) already restored the edge.
const sqlInsertFlowTransitionIdempotent = `
		INSERT INTO flows_transitions (flow_id, from_state_id, to_state_id)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
	`

// sqlListFlowStateNameIDs returns name → id pairs for live states on
// one flow. Used by ApplyReset post-mutation to remap snapshot edges
// to the new state ids before reinserting transitions.
const sqlListFlowStateNameIDs = `
		SELECT id, name FROM flows_states WHERE flow_id = $1 AND archived_at IS NULL
	`
