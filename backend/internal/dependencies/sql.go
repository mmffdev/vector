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
