package dependencies

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
