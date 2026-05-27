// Package flowboard is the service layer for the FlowBoard Kanban component
// (spec: docs/superpowers/specs/2026-05-27-flowboard-design.md).
//
// # Layer discipline
//
// This file owns business logic ONLY. It has no net/http imports and
// never constructs HTTP responses. All SQL strings live in sql.go;
// all HTTP wiring lives in handler.go.
//
// # Tables owned by this service
//
// Three tables in vector_artefacts (migrations 132 / 133 / 134):
//   - topology_nodes_members    — team membership per topology node
//   - topology_nodes_wip_limits — WIP-limit policy keyed by flow state
//   - users_flowboard_prefs     — per-user card-field preferences per artefact type
package flowboard

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotMember is returned by UpsertWipLimit when the caller does not have
// a row in topology_nodes_members for the target topology node. Handlers
// map this to HTTP 403.
var ErrNotMember = errors.New("flowboard: caller is not a member of this topology node")

// ErrNodeNotFound is returned by NodeWorkspaceID when the given topology node
// does not exist in the database. Handlers collapse this to HTTP 403 (same as
// cross-scope) to avoid leaking whether a node exists to an unauthorised caller.
var ErrNodeNotFound = errors.New("flowboard: topology node not found")

// WipLimitDTO is the wire shape returned by GET and PUT WIP-limit endpoints.
// Limit is a pointer so JSON null represents "no limit" (Rally-convention:
// blank/null = unlimited). UpdatedBy is the UUID of the last writer.
type WipLimitDTO struct {
	FlowStateID   uuid.UUID  `json:"flow_state_id"`
	FlowStateName string     `json:"flow_state_name"`
	Limit         *int       `json:"limit"`
	UpdatedAt     time.Time  `json:"updated_at"`
	UpdatedBy     *uuid.UUID `json:"updated_by"`
}

// serviceIface is the narrow contract the Handler needs from the service
// layer. The concrete *Service satisfies it; tests can inject a stub.
type serviceIface interface {
	NodeWorkspaceID(ctx context.Context, nodeID uuid.UUID) (uuid.UUID, error)
	ListWipLimits(ctx context.Context, nodeID, workspaceID uuid.UUID) ([]WipLimitDTO, error)
	UpsertWipLimit(ctx context.Context, nodeID, flowStateID, callerUserID, workspaceID uuid.UUID, limit *int) (WipLimitDTO, error)
}

// Service provides business logic for FlowBoard operations.
// It is the sole writer for topology_nodes_wip_limits and
// users_flowboard_prefs, and the read surface for
// topology_nodes_members.
type Service struct {
	pool *pgxpool.Pool
}

// NewService constructs a Service backed by the given vector_artefacts pool.
// pool may be nil during testing; every method that touches the DB will
// return an error when pool is nil, matching the nil-pool pattern used by
// artefactitems and topology services in this codebase.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// NodeWorkspaceID returns the workspace UUID that owns the given topology node.
// Returns ErrNodeNotFound when no such node exists — callers should treat this
// the same as a cross-scope mismatch (403, no existence leak).
func (s *Service) NodeWorkspaceID(ctx context.Context, nodeID uuid.UUID) (uuid.UUID, error) {
	if s.pool == nil {
		return uuid.Nil, errors.New("flowboard: no database pool")
	}
	var wsID uuid.UUID
	err := s.pool.QueryRow(ctx, sqlSelectNodeWorkspace, nodeID).Scan(&wsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNodeNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	return wsID, nil
}

// ListWipLimits returns all WIP-limit rows for the given topology node,
// sentinel-clamped by workspaceID. Returns an empty (non-nil) slice when
// no rows exist — no rows is valid (no limits configured yet).
//
// Returns an error when the pool is nil or the query fails.
func (s *Service) ListWipLimits(ctx context.Context, nodeID, workspaceID uuid.UUID) ([]WipLimitDTO, error) {
	if s.pool == nil {
		return []WipLimitDTO{}, nil
	}
	rows, err := s.pool.Query(ctx, sqlSelectWipLimitsByNode, nodeID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]WipLimitDTO, 0)
	for rows.Next() {
		var dto WipLimitDTO
		var updatedBy *uuid.UUID
		if err := rows.Scan(
			&dto.FlowStateID,
			&dto.FlowStateName,
			&dto.Limit,
			&dto.UpdatedAt,
			&updatedBy,
		); err != nil {
			return nil, err
		}
		dto.UpdatedBy = updatedBy
		out = append(out, dto)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// UpsertWipLimit writes or updates the WIP limit for a single
// (nodeID, flowStateID) pair, setting updated_at = now() and
// updated_by = callerUserID on every write.
//
// Permission gate: returns ErrNotMember when callerUserID has no row in
// topology_nodes_members for nodeID. The caller (handler) maps this to 403.
//
// limit == nil persists as SQL NULL (unlimited semantics per spec §3.2).
func (s *Service) UpsertWipLimit(
	ctx context.Context,
	nodeID, flowStateID, callerUserID, workspaceID uuid.UUID,
	limit *int,
) (WipLimitDTO, error) {
	if s.pool == nil {
		return WipLimitDTO{}, errors.New("flowboard: no database pool")
	}

	// Membership gate — must happen before the UPSERT write.
	var exists int
	err := s.pool.QueryRow(ctx, sqlCheckMembership, nodeID, callerUserID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return WipLimitDTO{}, ErrNotMember
	}
	if err != nil {
		return WipLimitDTO{}, err
	}

	// UPSERT the limit row and return the resulting state.
	var dto WipLimitDTO
	var updatedBy *uuid.UUID
	err = s.pool.QueryRow(ctx, sqlUpsertWipLimit,
		nodeID,
		flowStateID,
		limit,
		workspaceID,
		callerUserID,
	).Scan(
		&dto.FlowStateID,
		&dto.Limit,
		&dto.UpdatedAt,
		&updatedBy,
	)
	if err != nil {
		return WipLimitDTO{}, err
	}
	dto.UpdatedBy = updatedBy
	return dto, nil
}
