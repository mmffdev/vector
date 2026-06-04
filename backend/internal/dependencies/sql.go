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

// ── Read endpoints (B23.2.1) ────────────────────────────────────

// sqlListMapsForWorkspaceNode returns live maps for one topology
// node inside one workspace. Caller supplies the workspace_id from
// the sentinel clamp; topology_node_id is the URL filter. Ordered
// by name so the composer renders a stable list.
const sqlListMapsForWorkspaceNode = `
	SELECT` + sqlMapColumns + `
	  FROM artefact_dependency_maps
	 WHERE artefact_dependency_maps_id_workspace     = $1
	   AND artefact_dependency_maps_id_topology_node = $2
	   AND artefact_dependency_maps_archived_at      IS NULL
	 ORDER BY artefact_dependency_maps_name ASC`

// sqlListMapsForWorkspace is the same query without the topology
// filter — used when the caller wants every map they can see in
// the workspace (cross-node aggregate read).
const sqlListMapsForWorkspace = `
	SELECT` + sqlMapColumns + `
	  FROM artefact_dependency_maps
	 WHERE artefact_dependency_maps_id_workspace = $1
	   AND artefact_dependency_maps_archived_at  IS NULL
	 ORDER BY artefact_dependency_maps_name ASC`

// sqlGetMapWithEdgeCount augments the standard map row read with a
// COUNT of live edges. Used by GET /maps/{id} so the composer can
// render the "X edges" badge without a second round-trip.
const sqlGetMapWithEdgeCount = `
	SELECT` + sqlMapColumns + `,
	       (
	           SELECT COUNT(*)
	             FROM artefact_dependency_edges e
	            WHERE e.artefact_dependency_edges_id_map      = m.artefact_dependency_maps_id
	              AND e.artefact_dependency_edges_archived_at IS NULL
	       ) AS edge_count
	  FROM artefact_dependency_maps m
	 WHERE m.artefact_dependency_maps_id           = $1
	   AND m.artefact_dependency_maps_id_workspace = $2`

// sqlListBucketProjection returns every live edge in one map that
// touches the focused artefact. Caller sorts into the three buckets
// (requires / parallel / unlocks) in Go from kind + side. One round
// trip vs three: the composer expects all three buckets together,
// so a single scan over the map's edges is cheaper.
//
//   $1 = map id
//   $2 = focused artefact id
const sqlListBucketProjection = `
	SELECT` + sqlEdgeColumns + `
	  FROM artefact_dependency_edges
	 WHERE artefact_dependency_edges_id_map = $1
	   AND artefact_dependency_edges_archived_at IS NULL
	   AND (artefact_dependency_edges_id_from_artefact = $2
	     OR artefact_dependency_edges_id_to_artefact   = $2)
	 ORDER BY artefact_dependency_edges_created_at ASC`

// sqlListAllEdgesForMap returns every live edge in a map regardless
// of which artefact is focused. Powers the map-view bulk fetch:
// one round-trip per map instead of N (artefacts) × M (maps)
// per-focus calls. Sentinel clamp is enforced by the service
// caller's GetMap() workspace check before this runs — the SQL
// itself trusts the map_id already passed that gate.
//
//   $1 = map id
const sqlListAllEdgesForMap = `
	SELECT` + sqlEdgeColumns + `
	  FROM artefact_dependency_edges
	 WHERE artefact_dependency_edges_id_map = $1
	   AND artefact_dependency_edges_archived_at IS NULL
	 ORDER BY artefact_dependency_edges_created_at ASC`

// ── Transitive reachability (B23.3.1) ───────────────────────────

// sqlReachabilityDownstream returns every artefact reachable from $1
// by walking finish_to_start edges forward across ALL live maps in
// the caller's subscription. Cross-map walk per RES058 §9 — a path
// can travel through multiple overlapping maps the caller can see.
//
// Visibility flag (joined here so the redaction split happens in
// one round-trip): a.artefacts_id_topology_node = ANY($3) reports
// whether the row is in the caller's allowed subtree. Out-of-scope
// rows still appear in the result set so the caller can count them
// for the redacted_count summary.
//
//   $1 = focused artefact id
//   $2 = subscription id (caller TenantID)
//   $3 = caller AllowedSubtreeIDs uuid[]
//   $4 = max depth (defensive cap — recursion stops earlier via UNION
//        on a clean graph but the cap guards against pathological data)
const sqlReachabilityDownstream = `
	WITH RECURSIVE walk(node, depth) AS (
	    SELECT e.artefact_dependency_edges_id_to_artefact, 1
	      FROM artefact_dependency_edges e
	      JOIN artefact_dependency_maps  m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	     WHERE e.artefact_dependency_edges_id_from_artefact = $1
	       AND e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	       AND m.artefact_dependency_maps_archived_at       IS NULL
	       AND m.artefact_dependency_maps_id_subscription   = $2
	    UNION
	    SELECT e.artefact_dependency_edges_id_to_artefact, w.depth + 1
	      FROM artefact_dependency_edges e
	      JOIN artefact_dependency_maps  m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	      JOIN walk w ON w.node = e.artefact_dependency_edges_id_from_artefact
	     WHERE e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	       AND m.artefact_dependency_maps_archived_at       IS NULL
	       AND m.artefact_dependency_maps_id_subscription   = $2
	       AND w.depth < $4
	)
	SELECT w.node,
	       MIN(w.depth) AS depth,
	       COALESCE(a.artefacts_id_topology_node = ANY($3::uuid[]), FALSE) AS visible
	  FROM walk w
	  LEFT JOIN artefacts a
	         ON a.artefacts_id              = w.node
	        AND a.artefacts_id_subscription = $2
	        AND a.artefacts_archived_at IS NULL
	 GROUP BY w.node, a.artefacts_id_topology_node
	 ORDER BY depth ASC, w.node ASC`

// sqlReachabilityUpstream — same walk in the reverse direction
// (predecessors). Walks from the focused artefact backward along
// finish_to_start edges. Same visibility join as downstream.
const sqlReachabilityUpstream = `
	WITH RECURSIVE walk(node, depth) AS (
	    SELECT e.artefact_dependency_edges_id_from_artefact, 1
	      FROM artefact_dependency_edges e
	      JOIN artefact_dependency_maps  m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	     WHERE e.artefact_dependency_edges_id_to_artefact   = $1
	       AND e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	       AND m.artefact_dependency_maps_archived_at       IS NULL
	       AND m.artefact_dependency_maps_id_subscription   = $2
	    UNION
	    SELECT e.artefact_dependency_edges_id_from_artefact, w.depth + 1
	      FROM artefact_dependency_edges e
	      JOIN artefact_dependency_maps  m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	      JOIN walk w ON w.node = e.artefact_dependency_edges_id_to_artefact
	     WHERE e.artefact_dependency_edges_kind             = 'finish_to_start'
	       AND e.artefact_dependency_edges_archived_at      IS NULL
	       AND m.artefact_dependency_maps_archived_at       IS NULL
	       AND m.artefact_dependency_maps_id_subscription   = $2
	       AND w.depth < $4
	)
	SELECT w.node,
	       MIN(w.depth) AS depth,
	       COALESCE(a.artefacts_id_topology_node = ANY($3::uuid[]), FALSE) AS visible
	  FROM walk w
	  LEFT JOIN artefacts a
	         ON a.artefacts_id              = w.node
	        AND a.artefacts_id_subscription = $2
	        AND a.artefacts_archived_at IS NULL
	 GROUP BY w.node, a.artefacts_id_topology_node
	 ORDER BY depth ASC, w.node ASC`

// ── Candidate search (B23.2.2) ──────────────────────────────────

// sqlCandidateSearch returns artefacts visible to the caller that are
// NOT already linked to the focused artefact in the named map. The
// exclusion subquery walks every live edge in this map where the
// focused artefact is either endpoint and collects the OTHER
// endpoint id — those are the artefacts the composer would otherwise
// allow duplicate-adding into a second bucket.
//
//   $1 = subscription id (caller TenantID)
//   $2 = topology subtree (AllowedSubtreeIDs)
//   $3 = map id
//   $4 = focused artefact id (excluded from results + from exclusion set)
//   $5 = search text (case-insensitive substring on title; empty = match all)
//   $6 = LIMIT
//
// Rich projection mirrors backend/internal/artefactitems/sql.go's
// list shape so the composer can render directly from one call.
// artefacts_types JOIN gives type_prefix for the formatted-id badge;
// timebox columns are direct reads off artefacts. No FlowState /
// priority joins — the dropdown doesn't render those.
const sqlCandidateSearch = `
	SELECT a.artefacts_id,
	       a.artefacts_id_artefact_type,
	       a.artefacts_id_topology_node,
	       a.artefacts_title,
	       a.artefacts_number,
	       at.artefacts_types_prefix,
	       at.artefacts_types_slot,
	       at.artefacts_types_name,
	       COALESCE(a.artefacts_description, ''),
	       a.artefacts_id_timebox_sprint,
	       a.artefacts_timebox_sprint_label,
	       a.artefacts_id_timebox_release,
	       a.artefacts_id_timebox_milestone
	  FROM artefacts a
	  JOIN artefacts_types at ON at.artefacts_types_id = a.artefacts_id_artefact_type
	 WHERE a.artefacts_id              <> $4
	   AND a.artefacts_id_subscription = $1
	   AND a.artefacts_id_topology_node = ANY($2::uuid[])
	   AND a.artefacts_archived_at IS NULL
	   AND ($5 = '' OR a.artefacts_title ILIKE '%' || $5 || '%')
	   AND a.artefacts_id NOT IN (
	       SELECT CASE
	                WHEN e.artefact_dependency_edges_id_from_artefact = $4
	                THEN e.artefact_dependency_edges_id_to_artefact
	                ELSE e.artefact_dependency_edges_id_from_artefact
	              END
	         FROM artefact_dependency_edges e
	        WHERE e.artefact_dependency_edges_id_map = $3
	          AND e.artefact_dependency_edges_archived_at IS NULL
	          AND ($4 IN (e.artefact_dependency_edges_id_from_artefact,
	                     e.artefact_dependency_edges_id_to_artefact))
	   )
	 ORDER BY a.artefacts_title ASC
	 LIMIT $6`

// ── dependency-impact preflight (B23.1.8) ───────────────────────

// sqlImpactForArtefact returns one row per dependency map that has
// at least one live edge involving the given artefact, grouped by
// map. Used by both the standalone GET endpoint and the archive
// preflight in artefactitems.ArchiveWorkItem.
//
//   $1 = artefact id
//   $2 = workspace id (caller clamp — only maps in this workspace surface)
const sqlImpactForArtefact = `
	SELECT m.artefact_dependency_maps_id,
	       m.artefact_dependency_maps_name,
	       COUNT(e.artefact_dependency_edges_id) AS edges
	  FROM artefact_dependency_edges e
	  JOIN artefact_dependency_maps  m ON m.artefact_dependency_maps_id = e.artefact_dependency_edges_id_map
	 WHERE (e.artefact_dependency_edges_id_from_artefact = $1
	     OR e.artefact_dependency_edges_id_to_artefact   = $1)
	   AND e.artefact_dependency_edges_archived_at IS NULL
	   AND m.artefact_dependency_maps_archived_at  IS NULL
	   AND m.artefact_dependency_maps_id_workspace = $2
	 GROUP BY m.artefact_dependency_maps_id,
	          m.artefact_dependency_maps_name
	 ORDER BY edges DESC,
	          m.artefact_dependency_maps_name ASC`
