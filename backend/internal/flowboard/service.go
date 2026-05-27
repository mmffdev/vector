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
//   - topology_nodes_members   — team membership per topology node
//   - topology_nodes_wip_limits — WIP-limit policy keyed by flow state
//   - users_flowboard_prefs    — per-user card-field preferences per artefact type
package flowboard

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

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
