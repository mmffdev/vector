// Package workspaces is the SOLE writer for the workspaces and
// workspace_roles tables. Every INSERT/UPDATE/DELETE against either
// table must pass through this package.
//
// PLA-0006 introduces a workspace tier above org_nodes: a subscription
// holds 1..N workspaces; each workspace owns its own org_nodes tree.
// The workspace is the top-level tenant container — clamp predicate,
// role grants, and addressable scoping all narrow through here. A
// single corrupting writer outside this boundary therefore has blast
// radius across the whole product. See docs/c_c_topology.md for the
// MVP decisions and the workspace section of the same file for the
// service surface.
//
// The boundary is enforced by:
//   1. This package being the only place that holds the SQL strings
//      for those two tables in Go code.
//   2. dev/scripts/lint_writer_boundary.py, which scans every .go
//      file under backend/ for INSERT/UPDATE/DELETE against any
//      guarded table and fails CI if a hit lives outside the allowed
//      package directory.
//
// SQL migrations are exempt (the lint scopes to .go files); migration
// 099's bootstrap INSERT into workspaces (Default workspace seed) is
// the documented exception, mirroring orgdesign migration 085.
package workspaces

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// TopologySeeder is the subset of topology.Service used to seed a root
// topology node after a workspace is created. Defined as an interface so
// workspaces.Service does not import topology.Service directly (cycle guard).
// SeedRootNode must execute against a pgx.Tx targeting the vector_artefacts DB.
type TopologySeeder interface {
	SeedRootNode(ctx context.Context, workspaceID, subscriptionID uuid.UUID, name string, tx pgx.Tx) error
}

// ArtefactTypeSeeder is the subset of artefacttypes.Service used to seed
// default work types after a workspace is created. Defined as an interface
// so workspaces.Service does not import artefacttypes directly (cycle guard).
type ArtefactTypeSeeder interface {
	SeedDefaultWorkspaceTypes(ctx context.Context, subscriptionID, workspaceID uuid.UUID) error
}

// Role is the closed vocabulary for workspace_roles.role.
// Mirrored by the CHECK constraint in migration 098.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

// IsValid reports whether r is one of the three allowed role names.
func (r Role) IsValid() bool {
	switch r {
	case RoleAdmin, RoleEditor, RoleViewer:
		return true
	}
	return false
}

// Workspace is one row of the workspaces table returned by reads.
type Workspace struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	Name           string     `json:"name"`
	Slug           string     `json:"slug"`
	Description    *string    `json:"description"`
	CreatedBy      uuid.UUID  `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	ArchivedBy     *uuid.UUID `json:"archived_by"`
}

// IsArchived returns true when the workspace is in limbo. Archive
// preserves grants, child org_nodes, and all FK relationships — the
// only gate is this flag. Mirrors org_nodes archive semantics.
func (w Workspace) IsArchived() bool { return w.ArchivedAt != nil }

// WorkspaceRoleGrant is one row of workspace_roles. Active grants
// have RevokedAt == nil; revoked rows are kept for audit.
type WorkspaceRoleGrant struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	WorkspaceID    uuid.UUID  `json:"workspace_id"`
	UserID         uuid.UUID  `json:"user_id"`
	Role           Role       `json:"role"`
	CanRedelegate  bool       `json:"can_redelegate"`
	GrantedBy      uuid.UUID  `json:"granted_by"`
	GrantedAt      time.Time  `json:"granted_at"`
	RevokedAt      *time.Time `json:"revoked_at"`
	RevokedBy      *uuid.UUID `json:"revoked_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// PermissionResolver is the subset of permissions.Resolver this
// package needs. Defined as an interface so tests can pass an
// in-memory fake without standing up a real DB-backed cache.
//
// Returning (false, nil) is the "permission missing" path; an error
// is reserved for plumbing failures.
type PermissionResolver interface {
	Has(ctx context.Context, userID uuid.UUID, code permissions.Code) (bool, error)
}

// Service is the sole writer for workspaces and workspace_roles.
//
// Pool is the pgxpool used for every read and write. Audit writes
// one row per mutation through audit.Logger, mirroring the style
// used by roles.Service. Perms is the permission resolver consulted
// by every mutation method to enforce the workspace.* gate matrix
// from migration 100; nil disables the gate (used by tests and the
// migration-time bootstrap path).
//
// VAPool is the optional pgxpool against the vector_artefacts DB
// (PLA-0026 / story 00502). When non-nil it is used by
// CheckCrossDBOrphans to scan every VA table that carries
// workspace_id BEFORE a workspace is deleted: if any row references
// the workspace, the deletion is refused with a 409 listing the
// offending tables. When nil (no VECTOR_ARTEFACTS_DB_URL configured,
// or unit tests) the scan is a no-op — the cross-DB guard is
// disabled by definition. Reads are not gated on this field.
type Service struct {
	Pool           *pgxpool.Pool
	Audit          *audit.Logger
	Perms          PermissionResolver
	VAPool         *pgxpool.Pool
	topoSeeder     TopologySeeder
	atSeeder       ArtefactTypeSeeder
}

// New constructs a Service. Audit and Perms may be nil in tests; the
// production wiring (cmd/main.go) MUST pass non-nil values for both.
// VAPool is set separately via WithVAPool — see service.go for the
// rationale (optional cross-DB pool, present only when the cutover
// DB is configured).
func New(pool *pgxpool.Pool, a *audit.Logger, p PermissionResolver) *Service {
	return &Service{Pool: pool, Audit: a, Perms: p}
}

// WithTopologySeeder wires in the topology seeder so Create auto-seeds a root
// topology node in vector_artefacts after each new workspace is committed.
// Optional — nil disables the seed (tests, environments without vaPool).
func (s *Service) WithTopologySeeder(ts TopologySeeder) *Service {
	s.topoSeeder = ts
	return s
}

// WithArtefactTypeSeeder wires in the artefact-type seeder so Create
// auto-seeds the 5 default work types after each new workspace is committed.
// Optional — nil disables the seed (tests, environments without vaPool).
func (s *Service) WithArtefactTypeSeeder(as ArtefactTypeSeeder) *Service {
	s.atSeeder = as
	return s
}

// WithVAPool attaches an optional vector_artefacts pgxpool to the
// service. Returns the receiver so callers can chain the call at
// construction time (e.g. workspaces.New(...).WithVAPool(vaPool)).
// Passing nil is allowed and is the documented "guard disabled"
// state — CheckCrossDBOrphans will short-circuit with an empty
// report and the workspace-deletion code path becomes unguarded.
// PLA-0026 / story 00502 (B13).
func (s *Service) WithVAPool(p *pgxpool.Pool) *Service {
	s.VAPool = p
	return s
}

// requirePermission is the single permission gate used by every
// mutation method. Returns ErrPermissionDenied if the actor does not
// hold the required code; nil-Perms is treated as "gate disabled"
// for tests / bootstrap. Plumbing errors propagate up untouched.
func (s *Service) requirePermission(ctx context.Context, actorID uuid.UUID, code permissions.Code) error {
	if s.Perms == nil {
		return nil
	}
	ok, err := s.Perms.Has(ctx, actorID, code)
	if err != nil {
		return err
	}
	if !ok {
		return ErrPermissionDenied
	}
	return nil
}

// auditLog is a thin nil-safe wrapper around s.Audit.Log so the
// command bodies stay readable. Drops silently when Audit is nil
// (tests, bootstrap) — same behaviour as roles.Service when used
// against a fixture pool that doesn't have an audit_log table.
func (s *Service) auditLog(ctx context.Context, e audit.Entry) {
	if s.Audit == nil {
		return
	}
	s.Audit.Log(ctx, e)
}
