package devtools

// sql.go — all raw SQL for the devtools package, kept here as named
// sqlVerbResource constants per the PLA-0048 / RF1.1.1 sql-in-sqlfile-only
// rule (docs/c_c_naming_conventions.md §1.3). The runtime calls
// (tx.Query / tx.QueryRow / tx.Exec) stay in flow_reseed.go; only the SQL
// string literals live here so a table move is one find-and-replace.

// --- Type selection (ScopedCanonicalTypeIDs) ---------------------------------
// The WHERE clause is assembled dynamically from the scope, so this constant
// holds only the stable SELECT/FROM/ORDER head; the caller appends the
// parameterised predicate. (It still reads as SQL for the lint, and keeps the
// column list in one place.)
const sqlSelectScopedTypesHead = `
	SELECT artefacts_types_id,
	       artefacts_types_name,
	       artefacts_types_id_subscription,
	       artefacts_types_id_workspace
	FROM artefacts_types
	WHERE `

const sqlSelectScopedTypesTail = `
	ORDER BY artefacts_types_name`

// --- Snapshot rebuild (RebuildSnapshotForType) -------------------------------

const sqlUpsertFlowDefault = `
	INSERT INTO flows_defaults (flows_defaults_id_artefact_type, flows_defaults_name)
	VALUES ($1, $2)
	ON CONFLICT (flows_defaults_id_artefact_type)
	DO UPDATE SET flows_defaults_name = EXCLUDED.flows_defaults_name
	RETURNING flows_defaults_id`

const sqlDeleteFlowStatesDefaults = `
	DELETE FROM flows_states_defaults
	WHERE flows_states_defaults_id_flow_default = $1`

const sqlInsertFlowStateDefault = `
	INSERT INTO flows_states_defaults (
		flows_states_defaults_id_flow_default,
		flows_states_defaults_name,
		flows_states_defaults_kind,
		flows_states_defaults_sort_order,
		flows_states_defaults_is_initial,
		flows_states_defaults_is_pullable)
	VALUES ($1, $2, $3, $4, $5, $6)
	RETURNING flows_states_defaults_id`

const sqlInsertFlowTransitionDefault = `
	INSERT INTO flows_transitions_defaults (
		flows_transitions_defaults_id_flow_default,
		flows_transitions_defaults_id_state_from,
		flows_transitions_defaults_id_state_to)
	VALUES ($1, $2, $3)`

// --- Live flow rebuild (ReseedFlowToSpine) -----------------------------------

const sqlDemoteOldInitialStates = `
	UPDATE flows_states
	SET flows_states_is_initial = false
	WHERE flows_states_id_flow = $1
	  AND flows_states_is_initial = true
	  AND flows_states_archived_at IS NULL`

const sqlInsertLiveFlowState = `
	INSERT INTO flows_states (
		flows_states_id_flow,
		flows_states_name,
		flows_states_kind,
		flows_states_sort_order,
		flows_states_is_initial,
		flows_states_is_pullable)
	VALUES ($1, $2, $3, $4, $5, $6)
	RETURNING flows_states_id`

const sqlRepointArtefactsToInitial = `
	UPDATE artefacts
	SET artefacts_id_flow_state = $1
	WHERE artefacts_id_flow_state IN (
		SELECT flows_states_id
		FROM flows_states
		WHERE flows_states_id_flow = $2
		  AND flows_states_id <> ALL($3)
	)`

const sqlDeleteFlowTransitionsForFlow = `
	DELETE FROM flows_transitions
	WHERE flows_transitions_id_flow = $1`

const sqlDeleteOldFlowStates = `
	DELETE FROM flows_states
	WHERE flows_states_id_flow = $1
	  AND flows_states_id <> ALL($2)`

const sqlInsertLiveFlowTransition = `
	INSERT INTO flows_transitions (
		flows_transitions_id_flow,
		flows_transitions_id_state_from,
		flows_transitions_id_state_to)
	VALUES ($1, $2, $3)`

// --- Live flow enumeration (liveFlowIDsForType) ------------------------------
// includeCustom appends an `AND flows_is_default = true` filter at runtime, so
// the body is split into head + tail around the optional clause.

const sqlSelectLiveFlowsHead = `
	SELECT flows_id
	FROM flows
	WHERE flows_id_artefact_type = $1
	  AND flows_archived_at IS NULL`

const sqlSelectLiveFlowsDefaultOnly = `
	  AND flows_is_default = true`

const sqlSelectLiveFlowsTail = `
	ORDER BY flows_is_default DESC, flows_created_at`

// --- Preview (PreviewReseed) -------------------------------------------------

const sqlPreviewFlowSplit = `
	SELECT
		COUNT(*) FILTER (WHERE flows_is_default),
		COUNT(*) FILTER (WHERE NOT flows_is_default)
	FROM flows
	WHERE flows_id_artefact_type = ANY($1)
	  AND flows_archived_at IS NULL`

// sqlPreviewArtefactRepoint counts live artefacts sitting on a state of an
// in-scope flow. The %s is replaced at runtime by either `flows_is_default =
// true` (default-only) or `TRUE` (include custom) — both are constant SQL
// fragments defined below, never caller input.
const sqlPreviewArtefactRepoint = `
	SELECT COUNT(*)
	FROM artefacts a
	WHERE a.artefacts_id_flow_state IN (
		SELECT fs.flows_states_id
		FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = ANY($1)
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_archived_at IS NULL
		  AND %s
	)`

const (
	sqlFragFlowDefaultOnly = `flows_is_default = true`
	sqlFragFlowAny         = `TRUE`
)

// --- Cascading dropdowns (dropdowns.go) --------------------------------------
// Read-only selects that feed the Subscription → Workspace → Topology Node →
// Artefact Type cascade. Each is a single SELECT with one WHERE filter; every
// level below subscriptions is live-only (archived_at IS NULL).

const sqlListSubscriptions = `
	SELECT subscriptions_id, subscriptions_name
	FROM subscriptions
	ORDER BY subscriptions_name`

const sqlListWorkspaces = `
	SELECT master_record_workspaces_id, master_record_workspaces_name
	FROM master_record_workspaces
	WHERE master_record_workspaces_id_subscription = $1
	  AND master_record_workspaces_archived_at IS NULL
	ORDER BY master_record_workspaces_name`

const sqlListTopologyNodes = `
	SELECT topology_nodes_id, topology_nodes_name
	FROM topology_nodes
	WHERE topology_nodes_id_workspace = $1
	  AND topology_nodes_archived_at IS NULL
	ORDER BY topology_nodes_name`

const sqlListArtefactTypes = `
	SELECT artefacts_types_id, artefacts_types_name
	FROM artefacts_types
	WHERE artefacts_types_id_workspace = $1
	  AND artefacts_types_archived_at IS NULL
	ORDER BY artefacts_types_name`

// --- Fixture cleanup (fixture_cleanup.go) ------------------------------------
// A one-time dev-DB cleanup of two synthetic fixture clusters:
//   A) artefact TYPES whose name matches ^FlowLayer[AB]_ (162 types, 162 flows,
//      0 live artefacts). flows.flows_id_artefact_type is ON DELETE RESTRICT, so
//      the flows (and their states/transitions, which cascade off flows) must be
//      deleted BEFORE the type rows. flows_states carries a self-referential
//      ON DELETE RESTRICT template FK; every templating state of a FlowLayer
//      state is itself a FlowLayer state, so deleting all FlowLayer flows_states
//      in one statement leaves no surviving referrer and RESTRICT is satisfied.
//   B) the live artefacts of types named exactly OldStory / OldRoot /
//      Pending re-classification, then those 3 type rows. fields_values +
//      search_outbox cascade off artefacts; children (artefacts_id_parent) and
//      dependency-map roots are ON DELETE SET NULL; dependency EDGES are RESTRICT
//      (guarded — verified 0).

// Guard counts (PreviewFixtureCleanup + RunFixtureCleanup pre-flight).

const sqlCountFlowLayerTypes = `
	SELECT count(*)
	FROM artefacts_types
	WHERE artefacts_types_name ~ '^FlowLayer[AB]_'`

const sqlCountFlowLayerFlows = `
	SELECT count(*)
	FROM flows f
	JOIN artefacts_types t ON t.artefacts_types_id = f.flows_id_artefact_type
	WHERE t.artefacts_types_name ~ '^FlowLayer[AB]_'`

// Guard: any artefact parked on a FlowLayer flow_state (RESTRICT on
// artefacts_id_flow_state). Verified 0; a non-zero count aborts the run.
const sqlCountFlowLayerArtefacts = `
	SELECT count(*)
	FROM artefacts a
	WHERE a.artefacts_id_artefact_type IN (
		SELECT artefacts_types_id FROM artefacts_types
		WHERE artefacts_types_name ~ '^FlowLayer[AB]_')`

const sqlCountOldPendingArtefacts = `
	SELECT count(*)
	FROM artefacts a
	JOIN artefacts_types t ON t.artefacts_types_id = a.artefacts_id_artefact_type
	WHERE t.artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification')`

const sqlCountOldPendingTypes = `
	SELECT count(*)
	FROM artefacts_types
	WHERE artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification')`

// Guard: dependency EDGES (RESTRICT, both directions) touching any OldStory /
// OldRoot / Pending artefact. Verified 0; a non-zero count aborts the run.
const sqlCountOldPendingDepEdges = `
	SELECT count(*)
	FROM artefact_dependency_edges e
	WHERE e.artefact_dependency_edges_id_from_artefact IN (
		SELECT a.artefacts_id FROM artefacts a
		JOIN artefacts_types t ON t.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE t.artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification'))
	   OR e.artefact_dependency_edges_id_to_artefact IN (
		SELECT a.artefacts_id FROM artefacts a
		JOIN artefacts_types t ON t.artefacts_types_id = a.artefacts_id_artefact_type
		WHERE t.artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification'))`

// Cluster A mutations — delete in FK-safe order.
//  1. flows_states of FlowLayer flows (clears the self-ref template RESTRICT and
//     the artefacts_id_flow_state RESTRICT in one statement; flows_transitions
//     cascade off flows_states).
const sqlDeleteFlowLayerFlowStates = `
	DELETE FROM flows_states
	WHERE flows_states_id_flow IN (
		SELECT f.flows_id FROM flows f
		JOIN artefacts_types t ON t.artefacts_types_id = f.flows_id_artefact_type
		WHERE t.artefacts_types_name ~ '^FlowLayer[AB]_')`

//  2. flows of FlowLayer types (clears flows_id_artefact_type RESTRICT before the
//     type delete; flows_states already gone, remaining children cascade).
const sqlDeleteFlowLayerFlows = `
	DELETE FROM flows
	WHERE flows_id_artefact_type IN (
		SELECT artefacts_types_id FROM artefacts_types
		WHERE artefacts_types_name ~ '^FlowLayer[AB]_')`

// 3. the FlowLayer type rows themselves.
const sqlDeleteFlowLayerTypes = `
	DELETE FROM artefacts_types
	WHERE artefacts_types_name ~ '^FlowLayer[AB]_'`

// Cluster B mutations.
//  1. delete the live artefacts (fields_values + search_outbox cascade; children
//     and dependency-map roots auto-orphan via SET NULL).
const sqlDeleteOldPendingArtefacts = `
	DELETE FROM artefacts
	WHERE artefacts_id_artefact_type IN (
		SELECT artefacts_types_id FROM artefacts_types
		WHERE artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification'))`

// 2. delete the 3 type rows (now artefact-free).
const sqlDeleteOldPendingTypes = `
	DELETE FROM artefacts_types
	WHERE artefacts_types_name IN ('OldStory', 'OldRoot', 'Pending re-classification')`

// --- Backup snapshots (handler.go STEP 0, before any /run mutation) -----------
// Each /run handler snapshots the tables it is about to mutate into timestamped
// backup tables so the operation is reversible by a human. pgx cannot
// parametrise identifiers, so the timestamp suffix is interpolated via
// fmt.Sprintf into these `%s` templates — the suffix is generated by Go from
// time.Now().UTC().Format("20060102_150405"), i.e. a vetted [A-Za-z0-9_] string,
// never caller input, so the interpolation is injection-safe.
//
// `CREATE TABLE <name>_bak_<ts> AS TABLE <name>` copies every row (no indexes /
// constraints — a plain data snapshot, which is all a restore-point needs).

// Flow-reseed backup set: the six flow definition tables (live + defaults) plus
// a slim artefacts status snapshot (only the columns the reseed repoints).
const (
	sqlBackupFlows                    = `CREATE TABLE flows_bak_%s AS TABLE flows`
	sqlBackupFlowsStates              = `CREATE TABLE flows_states_bak_%s AS TABLE flows_states`
	sqlBackupFlowsTransitions         = `CREATE TABLE flows_transitions_bak_%s AS TABLE flows_transitions`
	sqlBackupFlowsDefaults            = `CREATE TABLE flows_defaults_bak_%s AS TABLE flows_defaults`
	sqlBackupFlowsStatesDefaults      = `CREATE TABLE flows_states_defaults_bak_%s AS TABLE flows_states_defaults`
	sqlBackupFlowsTransitionsDefaults = `CREATE TABLE flows_transitions_defaults_bak_%s AS TABLE flows_transitions_defaults`
	sqlBackupArtefactsFlowState       = `CREATE TABLE artefacts_flowstate_bak_%s AS SELECT artefacts_id, artefacts_id_flow_state FROM artefacts`
)

// Fixture-cleanup backup set: the full artefacts table + artefacts_types plus
// the same flow tables (the cleanup deletes FlowLayer flows/states and Old*
// artefacts + types, so all of these are in the blast radius).
const (
	sqlBackupArtefactsFull  = `CREATE TABLE artefacts_bak_%s AS TABLE artefacts`
	sqlBackupArtefactsTypes = `CREATE TABLE artefacts_types_bak_%s AS TABLE artefacts_types`
)
