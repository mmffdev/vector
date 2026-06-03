package dependencies

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// Service is the sole writer for the artefact dependency substrate.
// Holds the vector_artefacts pool (vaPool) only — Sentinel is read
// from request context, NOT injected at construction time, matching
// the live artefactpriorities / artefactitems / topology pattern.
//
// Future stories (B23.1.5+) add methods directly to this struct so
// the same service governs reads, writes, and the dependency-impact
// preflight.
type Service struct {
	pool *pgxpool.Pool
}

// NewService constructs the service against the vector_artefacts
// pool. The pool may legitimately be nil in pre-cutover envs; methods
// guard against that and return a clear error rather than panic.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// VerifySchema runs a no-op SELECT against each of the three
// substrate tables. Intended to be called once at boot from
// cmd/server/main.go so the process fails fast if the operator
// forgot to apply migrations 173–175. Returns ErrSchemaMissing
// (wrapped) when any of the tables is absent; nil otherwise.
//
// Called once at boot; not on every request — repeating this on hot
// paths would just add round-trip latency for no detection benefit
// (the migrations either ran at boot or they didn't).
func (s *Service) VerifySchema(ctx context.Context) error {
	if s.pool == nil {
		// In pre-cutover envs the substrate genuinely is unavailable
		// — methods reject calls at the seam, but VerifySchema is a
		// boot hook and silently passing here lets servers without
		// vaPool boot. Subsequent method calls will return an error
		// at the seam instead.
		return nil
	}
	for _, q := range []string{sqlPingMaps, sqlPingEdges, sqlPingEdgeEvents} {
		if _, err := s.pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("%w: %v", ErrSchemaMissing, err)
		}
	}
	return nil
}

// requirePool is the shared guard used by every method that touches
// the DB. Returned error wraps a sentinel so callers can branch on it.
func (s *Service) requirePool() error {
	if s.pool == nil {
		return errors.New("dependencies: vector_artefacts pool not available")
	}
	return nil
}

// ── Map CRUD ────────────────────────────────────────────────────
//
// All three methods read the caller clamp from ctx via sentinel.FromCtx.
// Topology-scope enforcement is application-layer, not SQL-layer:
// inserts validate the requested topology_node_id is in
// AllowedSubtreeIDs; reads/updates of an existing row validate the
// row's persisted topology_node_id against the same set. This matches
// the live "server is the gate" discipline — the wire payload must
// never name a node the caller can't see, and the row's topology
// owner is the authoritative scope, not whatever the caller passed.

// CreateMap inserts a new dependency map. Clamp-derived fields
// (subscription_id, workspace_id, created_by) come from the request
// context — callers cannot forge them via the request body.
func (s *Service) CreateMap(ctx context.Context, in CreateMapInput) (Map, error) {
	if err := s.requirePool(); err != nil {
		return Map{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil || c.TenantID == uuid.Nil {
		return Map{}, ErrEndpointNotInScope
	}
	if !nodeInScope(c, in.TopologyNodeID) {
		return Map{}, ErrEndpointNotInScope
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 200 {
		return Map{}, ErrInvalidInput
	}

	var createdBy any
	if c.UserID != uuid.Nil {
		createdBy = c.UserID
	}

	row := s.pool.QueryRow(ctx, sqlInsertMap,
		c.TenantID,
		c.WorkspaceID,
		in.TopologyNodeID,
		in.RootArtefactID,
		name,
		createdBy,
	)
	out, err := scanMap(row)
	if err != nil {
		return Map{}, fmt.Errorf("dependencies.CreateMap: %w", err)
	}
	return out, nil
}

// RenameMap updates an existing map's name. 404 if the map is missing,
// archived, or in a different workspace; 403 if the persisted
// topology_node_id is no longer in the caller's clamp.
func (s *Service) RenameMap(ctx context.Context, mapID uuid.UUID, in RenameMapInput) (Map, error) {
	if err := s.requirePool(); err != nil {
		return Map{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil {
		return Map{}, ErrEndpointNotInScope
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 200 {
		return Map{}, ErrInvalidInput
	}

	existing, err := s.getMapByID(ctx, mapID, c.WorkspaceID)
	if err != nil {
		return Map{}, err
	}
	if existing.ArchivedAt != nil {
		return Map{}, ErrNotFound
	}
	if !nodeInScope(c, existing.TopologyNodeID) {
		return Map{}, ErrEndpointNotInScope
	}

	row := s.pool.QueryRow(ctx, sqlUpdateMapName, name, mapID, c.WorkspaceID)
	out, err := scanMap(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Map{}, ErrNotFound
	}
	if err != nil {
		return Map{}, fmt.Errorf("dependencies.RenameMap: %w", err)
	}
	return out, nil
}

// ArchiveMap soft-deletes a map. Idempotent — a second call against
// an already-archived map returns the current row (with its existing
// archived_at) and no error.
func (s *Service) ArchiveMap(ctx context.Context, mapID uuid.UUID) (Map, error) {
	if err := s.requirePool(); err != nil {
		return Map{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil {
		return Map{}, ErrEndpointNotInScope
	}

	existing, err := s.getMapByID(ctx, mapID, c.WorkspaceID)
	if err != nil {
		return Map{}, err
	}
	if !nodeInScope(c, existing.TopologyNodeID) {
		return Map{}, ErrEndpointNotInScope
	}
	if existing.ArchivedAt != nil {
		return existing, nil
	}

	row := s.pool.QueryRow(ctx, sqlArchiveMap, mapID, c.WorkspaceID)
	out, err := scanMap(row)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a race with another archive attempt — re-read.
		return s.getMapByID(ctx, mapID, c.WorkspaceID)
	}
	if err != nil {
		return Map{}, fmt.Errorf("dependencies.ArchiveMap: %w", err)
	}
	return out, nil
}

// GetMap returns a single map by id in the caller's workspace. Used
// by handlers that need to validate map existence + scope before
// performing an unrelated action; reads stay workspace-clamped.
func (s *Service) GetMap(ctx context.Context, mapID uuid.UUID) (Map, error) {
	if err := s.requirePool(); err != nil {
		return Map{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil {
		return Map{}, ErrEndpointNotInScope
	}
	out, err := s.getMapByID(ctx, mapID, c.WorkspaceID)
	if err != nil {
		return Map{}, err
	}
	if !nodeInScope(c, out.TopologyNodeID) {
		return Map{}, ErrEndpointNotInScope
	}
	return out, nil
}

// getMapByID is the workspace-clamped SELECT. Distinguishes "no row"
// (ErrNotFound) from genuine DB errors.
func (s *Service) getMapByID(ctx context.Context, mapID, workspaceID uuid.UUID) (Map, error) {
	row := s.pool.QueryRow(ctx, sqlGetMapByID, mapID, workspaceID)
	out, err := scanMap(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Map{}, ErrNotFound
	}
	if err != nil {
		return Map{}, fmt.Errorf("dependencies.getMapByID: %w", err)
	}
	return out, nil
}

// scanMap pulls a Map out of the canonical sqlMapColumns projection.
// Kept here so every read site uses the same Scan order.
func scanMap(row pgx.Row) (Map, error) {
	var m Map
	err := row.Scan(
		&m.ID,
		&m.SubscriptionID,
		&m.WorkspaceID,
		&m.TopologyNodeID,
		&m.RootArtefactID,
		&m.Name,
		&m.CreatedAt,
		&m.UpdatedAt,
		&m.ArchivedAt,
		&m.CreatedBy,
	)
	return m, err
}

// nodeInScope reports whether the topology node id sits inside the
// caller's resolved clamp. Linear scan over AllowedSubtreeIDs is
// fine in practice — the clamp is typically a few hundred uuids and
// the alternative (build a map per request) costs more than the scan.
//
// A nil AllowedSubtreeIDs means "subtree not resolved" — fail closed.
func nodeInScope(c sentinel.Clamp, node uuid.UUID) bool {
	if node == uuid.Nil {
		return false
	}
	if c.AllowedSubtreeIDs == nil {
		return false
	}
	for _, id := range c.AllowedSubtreeIDs {
		if id == node {
			return true
		}
	}
	return false
}

// ── Edge insert (B23.1.6) ───────────────────────────────────────

// CreateEdge inserts one edge into a dependency map. Runs entirely
// inside a tx that holds FOR UPDATE on the parent map row, so the
// cycle check + uniqueness check + insert + audit are atomic per
// map. Concurrent inserts against the same map serialise here;
// inserts across different maps run in parallel.
//
// Error vocabulary mirrors the AC:
//   ErrSelfLoop           — from == to
//   ErrInvalidInput       — unknown kind
//   ErrNotFound           — map missing, archived, or wrong workspace
//   ErrEndpointNotInScope — caller cannot see one or both endpoints
//   ErrCycle              — finish_to_start would close a directed cycle
//   ErrDuplicateEdge      — partial unique index violation
func (s *Service) CreateEdge(ctx context.Context, in CreateEdgeInput) (Edge, error) {
	if err := s.requirePool(); err != nil {
		return Edge{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil || c.TenantID == uuid.Nil {
		return Edge{}, ErrEndpointNotInScope
	}
	if !in.Kind.IsValid() {
		return Edge{}, ErrInvalidInput
	}
	if in.FromArtefactID == in.ToArtefactID {
		return Edge{}, ErrSelfLoop
	}
	if in.FromArtefactID == uuid.Nil || in.ToArtefactID == uuid.Nil || in.MapID == uuid.Nil {
		return Edge{}, ErrInvalidInput
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. SELECT … FOR UPDATE the parent map (per-map write serialisation).
	mapRow, err := scanMap(tx.QueryRow(ctx, sqlGetMapForUpdate, in.MapID, c.WorkspaceID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Edge{}, ErrNotFound
	}
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: load map: %w", err)
	}
	if mapRow.ArchivedAt != nil {
		return Edge{}, ErrNotFound
	}
	if !nodeInScope(c, mapRow.TopologyNodeID) {
		return Edge{}, ErrEndpointNotInScope
	}

	// 2. Both endpoints must be visible inside the caller clamp.
	endpoints := []uuid.UUID{in.FromArtefactID, in.ToArtefactID}
	if c.AllowedSubtreeIDs == nil || len(c.AllowedSubtreeIDs) == 0 {
		return Edge{}, ErrEndpointNotInScope
	}
	var visible int
	err = tx.QueryRow(ctx, sqlCountVisibleArtefacts,
		endpoints, c.TenantID, c.AllowedSubtreeIDs,
	).Scan(&visible)
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: visibility check: %w", err)
	}
	if visible < len(endpoints) {
		return Edge{}, ErrEndpointNotInScope
	}

	// 3. Cycle guard for directed kind only. Parallel edges are
	//    associative and do not participate in DAG semantics
	//    (RES058 §3 / merged design).
	if in.Kind == EdgeKindFinishToStart {
		var wouldCycle bool
		err = tx.QueryRow(ctx, sqlCycleWouldFormFromTo,
			in.MapID, in.FromArtefactID, in.ToArtefactID,
		).Scan(&wouldCycle)
		if err != nil {
			return Edge{}, fmt.Errorf("dependencies.CreateEdge: cycle check: %w", err)
		}
		if wouldCycle {
			return Edge{}, ErrCycle
		}
	}

	// 4. INSERT the edge row. Uniqueness is enforced by the three
	//    partial unique indexes; we map the SQLSTATE 23505 violation
	//    to ErrDuplicateEdge so the handler returns 409 with a
	//    stable error code.
	var createdBy any
	if c.UserID != uuid.Nil {
		createdBy = c.UserID
	}
	edge, err := scanEdge(tx.QueryRow(ctx, sqlInsertEdge,
		in.MapID,
		in.FromArtefactID,
		in.ToArtefactID,
		string(in.Kind),
		createdBy,
	))
	if isUniqueViolation(err) {
		return Edge{}, ErrDuplicateEdge
	}
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: insert: %w", err)
	}

	// 5. Same-tx audit event. Snapshot the Sentinel clamp into the
	//    event so forensic queries can answer "from which scope did
	//    this edge land". Payload carries the edge facets for replay.
	scopeSnapshot, err := json.Marshal(map[string]any{
		"subscription_id": c.TenantID,
		"workspace_id":    c.WorkspaceID,
		"focus_node_id":   c.FocusNodeID,
		"role":            c.Role,
	})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: marshal scope snapshot: %w", err)
	}
	eventPayload, err := json.Marshal(map[string]any{
		"map_id":            in.MapID,
		"from_artefact_id":  in.FromArtefactID,
		"to_artefact_id":    in.ToArtefactID,
		"kind":              string(in.Kind),
	})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: marshal event payload: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlInsertEdgeEvent,
		edge.ID,
		"created",
		createdBy,
		string(scopeSnapshot),
		string(eventPayload),
	); err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: insert audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Edge{}, fmt.Errorf("dependencies.CreateEdge: commit: %w", err)
	}
	return edge, nil
}

// scanEdge pulls an Edge row out of the canonical sqlEdgeColumns
// projection. Mirrors scanMap so every read site reads the columns
// in the same order.
func scanEdge(row pgx.Row) (Edge, error) {
	var e Edge
	var kindRaw string
	err := row.Scan(
		&e.ID,
		&e.MapID,
		&e.FromArtefactID,
		&e.ToArtefactID,
		&kindRaw,
		&e.CreatedAt,
		&e.UpdatedAt,
		&e.ArchivedAt,
		&e.CreatedBy,
	)
	if err != nil {
		return Edge{}, err
	}
	e.Kind = EdgeKind(kindRaw)
	return e, nil
}

// isUniqueViolation tests for postgres SQLSTATE 23505 (unique
// constraint violation). Used to distinguish the duplicate-edge case
// from generic insert errors so the handler can surface a 409 with a
// stable error code rather than a 500.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ── Edge archive (B23.1.7) ──────────────────────────────────────

// ArchiveEdge soft-deletes one edge. Idempotent: a second call
// against an already-archived row returns the existing row with
// no new audit event written (call count stays correct without
// surprise extra rows in the audit log).
//
// Scope check: edge's parent map must be in caller's workspace AND
// the map's topology_node must be in caller's AllowedSubtreeIDs.
// Endpoint visibility is intentionally NOT re-checked — once an
// edge exists in a scope the caller can write to, archiving it does
// not leak information about the endpoints (the response is just
// the edge row, which the caller could already read).
func (s *Service) ArchiveEdge(ctx context.Context, edgeID uuid.UUID) (Edge, error) {
	if err := s.requirePool(); err != nil {
		return Edge{}, err
	}
	c := sentinel.FromCtx(ctx)
	if c.WorkspaceID == uuid.Nil || c.TenantID == uuid.Nil {
		return Edge{}, ErrEndpointNotInScope
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Read edge + parent map's topology_node together so the scope
	// check runs without a second round trip.
	var (
		e          Edge
		kindRaw    string
		mapNodeID  uuid.UUID
	)
	err = tx.QueryRow(ctx, sqlGetEdgeForArchive, edgeID, c.WorkspaceID).Scan(
		&e.ID,
		&e.MapID,
		&e.FromArtefactID,
		&e.ToArtefactID,
		&kindRaw,
		&e.CreatedAt,
		&e.UpdatedAt,
		&e.ArchivedAt,
		&e.CreatedBy,
		&mapNodeID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Edge{}, ErrNotFound
	}
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: load edge: %w", err)
	}
	e.Kind = EdgeKind(kindRaw)
	if !nodeInScope(c, mapNodeID) {
		return Edge{}, ErrEndpointNotInScope
	}

	// Idempotent: already archived → return existing row, skip the
	// audit-event write so a re-call doesn't accumulate rows.
	if e.ArchivedAt != nil {
		return e, nil
	}

	updated, err := scanEdge(tx.QueryRow(ctx, sqlArchiveEdge, edgeID))
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a race with another archive — return what's now in the DB.
		// Commit the (empty) tx so the readback can see the new state.
		if err := tx.Commit(ctx); err != nil {
			return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: commit (race): %w", err)
		}
		return s.readEdge(ctx, edgeID)
	}
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: update: %w", err)
	}

	// Same-tx audit event.
	var createdBy any
	if c.UserID != uuid.Nil {
		createdBy = c.UserID
	}
	scopeSnapshot, err := json.Marshal(map[string]any{
		"subscription_id": c.TenantID,
		"workspace_id":    c.WorkspaceID,
		"focus_node_id":   c.FocusNodeID,
		"role":            c.Role,
	})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: marshal scope: %w", err)
	}
	eventPayload, err := json.Marshal(map[string]any{
		"map_id":           updated.MapID,
		"from_artefact_id": updated.FromArtefactID,
		"to_artefact_id":   updated.ToArtefactID,
		"kind":             string(updated.Kind),
	})
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: marshal payload: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlInsertEdgeEvent,
		edgeID,
		"archived",
		createdBy,
		string(scopeSnapshot),
		string(eventPayload),
	); err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: insert audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Edge{}, fmt.Errorf("dependencies.ArchiveEdge: commit: %w", err)
	}
	return updated, nil
}

// readEdge is the simple read used by ArchiveEdge's race-recovery
// path. Workspace-clamped via the join in sqlGetEdgeForArchive.
func (s *Service) readEdge(ctx context.Context, edgeID uuid.UUID) (Edge, error) {
	c := sentinel.FromCtx(ctx)
	var (
		e         Edge
		kindRaw   string
		mapNodeID uuid.UUID
	)
	err := s.pool.QueryRow(ctx, sqlGetEdgeForArchive, edgeID, c.WorkspaceID).Scan(
		&e.ID, &e.MapID, &e.FromArtefactID, &e.ToArtefactID, &kindRaw,
		&e.CreatedAt, &e.UpdatedAt, &e.ArchivedAt, &e.CreatedBy,
		&mapNodeID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Edge{}, ErrNotFound
	}
	if err != nil {
		return Edge{}, fmt.Errorf("dependencies.readEdge: %w", err)
	}
	e.Kind = EdgeKind(kindRaw)
	return e, nil
}
