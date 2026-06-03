package dependencies

// SQL constants for the dependencies service. Kept in their own file
// per the lint:sql-in-sqlfile-only rule.
//
// Column prefixes follow the §2.3 / §2.4 convention — every column on
// each table is `<table_name>_<column>`. The three substrate tables
// (artefact_dependency_maps, artefact_dependency_edges,
// artefact_dependency_edge_events) live in vector_artefacts; pool
// routing is vaPool per docs/c_c_db_routing.md.

// ── Schema sanity check ─────────────────────────────────────────
//
// At boot the service runs these no-op selects to confirm the three
// tables exist with the expected primary-key column. Each query is
// shaped to short-circuit immediately (LIMIT 0) so it costs nothing
// at run time but fails fast if the migrations were never applied.
const (
	sqlPingMaps       = `SELECT artefact_dependency_maps_id        FROM artefact_dependency_maps        LIMIT 0`
	sqlPingEdges      = `SELECT artefact_dependency_edges_id       FROM artefact_dependency_edges       LIMIT 0`
	sqlPingEdgeEvents = `SELECT artefact_dependency_edge_events_id FROM artefact_dependency_edge_events LIMIT 0`
)

// Column selectors for each persisted table. Reused by future Map
// CRUD (B23.1.5), edge insert (B23.1.6), and the read endpoints
// (B23.2.1). Kept here so future story-by-story PRs append SQL bodies
// against a single, stable column list.
const sqlMapColumns = `
	artefact_dependency_maps_id,
	artefact_dependency_maps_id_subscription,
	artefact_dependency_maps_id_workspace,
	artefact_dependency_maps_id_topology_node,
	artefact_dependency_maps_id_root_artefact,
	artefact_dependency_maps_name,
	artefact_dependency_maps_created_at,
	artefact_dependency_maps_updated_at,
	artefact_dependency_maps_archived_at,
	artefact_dependency_maps_created_by
`

const sqlEdgeColumns = `
	artefact_dependency_edges_id,
	artefact_dependency_edges_id_map,
	artefact_dependency_edges_id_from_artefact,
	artefact_dependency_edges_id_to_artefact,
	artefact_dependency_edges_kind,
	artefact_dependency_edges_created_at,
	artefact_dependency_edges_updated_at,
	artefact_dependency_edges_archived_at,
	artefact_dependency_edges_created_by
`

// ── Map CRUD ────────────────────────────────────────────────────
//
// All writes guard on (subscription_id, workspace_id) so a forged map
// id from another tenant never matches even before the topology-node
// scope check runs in the service layer.

const sqlInsertMap = `
	INSERT INTO artefact_dependency_maps (
		artefact_dependency_maps_id_subscription,
		artefact_dependency_maps_id_workspace,
		artefact_dependency_maps_id_topology_node,
		artefact_dependency_maps_id_root_artefact,
		artefact_dependency_maps_name,
		artefact_dependency_maps_created_by
	) VALUES ($1, $2, $3, $4, $5, $6)
	RETURNING` + sqlMapColumns

const sqlGetMapByID = `
	SELECT` + sqlMapColumns + `
	  FROM artefact_dependency_maps
	 WHERE artefact_dependency_maps_id           = $1
	   AND artefact_dependency_maps_id_workspace = $2`

const sqlUpdateMapName = `
	UPDATE artefact_dependency_maps
	   SET artefact_dependency_maps_name       = $1,
	       artefact_dependency_maps_updated_at = now()
	 WHERE artefact_dependency_maps_id           = $2
	   AND artefact_dependency_maps_id_workspace = $3
	   AND artefact_dependency_maps_archived_at IS NULL
	 RETURNING` + sqlMapColumns

const sqlArchiveMap = `
	UPDATE artefact_dependency_maps
	   SET artefact_dependency_maps_archived_at = now(),
	       artefact_dependency_maps_updated_at  = now()
	 WHERE artefact_dependency_maps_id           = $1
	   AND artefact_dependency_maps_id_workspace = $2
	   AND artefact_dependency_maps_archived_at IS NULL
	 RETURNING` + sqlMapColumns

// sqlGetMapForUpdate is the workspace-clamped SELECT … FOR UPDATE
// used by edge insert (B23.1.6) and edge archive (B23.1.7). The
// row-level lock serialises every concurrent edge mutation against
// the same map so the cycle check and uniqueness checks run on a
// stable snapshot.
const sqlGetMapForUpdate = sqlGetMapByID + `
	  FOR UPDATE`

// ── Edge insert (B23.1.6) ───────────────────────────────────────

// sqlCountVisibleArtefacts returns how many of the requested artefact
// ids the caller is permitted to see:
//   $1 = uuid[] of artefact ids to check
//   $2 = subscription id (caller TenantID)
//   $3 = uuid[] of caller AllowedSubtreeIDs (topology node membership)
//
// Caller compares result to len($1). Less than the input length means
// at least one endpoint is invisible — return 403.
const sqlCountVisibleArtefacts = `
	SELECT COUNT(*)
	  FROM artefacts a
	 WHERE a.artefacts_id              = ANY($1::uuid[])
	   AND a.artefacts_id_subscription = $2
	   AND a.artefacts_id_topology_node = ANY($3::uuid[])
	   AND a.artefacts_archived_at IS NULL`

// sqlCycleWouldFormFromTo answers: if a finish_to_start edge from
// $2 → $3 were added to map $1, would that close a directed cycle?
//
// Walk forward from $3 along live finish_to_start edges in this map;
// if $2 is reachable, adding $2 → $3 would form a cycle.
//
//   $1 = map id
//   $2 = proposed `from` artefact (target we'd reach back to)
//   $3 = proposed `to`   artefact (seed of the walk)
//
// UNION (not UNION ALL) terminates on a corrupted graph that already
// has cycles — the recursion stops when no new nodes are produced.
const sqlCycleWouldFormFromTo = `
	WITH RECURSIVE reachable(node) AS (
	    SELECT e.artefact_dependency_edges_id_to_artefact
	      FROM artefact_dependency_edges e
	     WHERE e.artefact_dependency_edges_id_map           = $1
	       AND e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	       AND e.artefact_dependency_edges_id_from_artefact = $3
	    UNION
	    SELECT e.artefact_dependency_edges_id_to_artefact
	      FROM artefact_dependency_edges e
	      JOIN reachable r
	        ON e.artefact_dependency_edges_id_from_artefact = r.node
	     WHERE e.artefact_dependency_edges_id_map           = $1
	       AND e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	)
	SELECT EXISTS(SELECT 1 FROM reachable WHERE node = $2)`

const sqlInsertEdge = `
	INSERT INTO artefact_dependency_edges (
		artefact_dependency_edges_id_map,
		artefact_dependency_edges_id_from_artefact,
		artefact_dependency_edges_id_to_artefact,
		artefact_dependency_edges_kind,
		artefact_dependency_edges_created_by
	) VALUES ($1, $2, $3, $4, $5)
	RETURNING` + sqlEdgeColumns

const sqlInsertEdgeEvent = `
	INSERT INTO artefact_dependency_edge_events (
		artefact_dependency_edge_events_id_edge,
		artefact_dependency_edge_events_event_kind,
		artefact_dependency_edge_events_id_actor_user,
		artefact_dependency_edge_events_sentinel_scope_snapshot,
		artefact_dependency_edge_events_payload
	) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`

// ── Edge archive (B23.1.7) ──────────────────────────────────────

// sqlGetEdgeForArchive returns one edge row joined to its parent map
// for the workspace clamp + topology scope check. Read inside the
// archive tx so the scope check runs on a stable snapshot.
const sqlGetEdgeForArchive = `
	SELECT` + sqlEdgeColumns + `,
	       m.artefact_dependency_maps_id_topology_node
	  FROM artefact_dependency_edges  e
	  JOIN artefact_dependency_maps   m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	 WHERE e.artefact_dependency_edges_id    = $1
	   AND m.artefact_dependency_maps_id_workspace = $2`

// sqlArchiveEdge soft-deletes one edge. Returns the post-update row.
// Restricted to live (non-archived) edges so a second call against
// an already-archived row returns 0 rows (caller branches on
// pgx.ErrNoRows for the idempotent re-read path).
const sqlArchiveEdge = `
	UPDATE artefact_dependency_edges
	   SET artefact_dependency_edges_archived_at = now(),
	       artefact_dependency_edges_updated_at  = now()
	 WHERE artefact_dependency_edges_id = $1
	   AND artefact_dependency_edges_archived_at IS NULL
	 RETURNING` + sqlEdgeColumns
