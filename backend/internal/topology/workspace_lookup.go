package topology

// PoolWorkspaceLookup is the production WorkspaceLookup adapter. Reads
// workspaces + active workspace roles via a *pgxpool.Pool (or any
// PoolQuerier in tests).
//
// Split out of middleware.go on 2026-05-21 (per COD002 / W1 finding):
// middleware.go was conflating context helpers, HTTP middleware, and
// this DB lookup adapter in one 436-line file. The adapter is a pure
// data-access surface — it has no HTTP semantics and no business logic
// — so it belongs next to the SQL it runs, not next to the middleware
// that consumes it.
//
// Reads are not constrained by the workspaces sole-writer lint
// (writer_boundary scopes to writes only), so this helper is allowed
// to embed workspace_id queries outside the workspaces package.

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WorkspaceLookup is the read surface the workspace clamp consumes.
// Defined as an interface so tests can swap a fake without standing
// up workspaces.Service. Production wiring (cmd/server/main.go) passes
// PoolWorkspaceLookup, an adapter that runs pure SELECTs against
// `workspaces` and `roles_workspaces` — those reads sit safely outside
// the workspaces sole-writer boundary, which gates writes only.
type WorkspaceLookup interface {
	// FirstLiveWorkspace returns the actor's first live workspace in
	// their tenant ordered by created_at ASC (Default lands first).
	// Returns ErrNoWorkspace when the tenant has zero live workspaces.
	FirstLiveWorkspace(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error)

	// ResolveSlug looks up a live workspace by slug inside the tenant.
	// Returns ErrWorkspaceNotFound when missing.
	ResolveSlug(ctx context.Context, subscriptionID uuid.UUID, slug string) (uuid.UUID, error)

	// ResolveRef accepts either a UUID or a slug as `ref` and resolves
	// it to a live workspace_id inside the tenant. UUIDs are the
	// canonical identifier (stable across renames and reslugs); slugs
	// are accepted for human-friendly URLs. Returns ErrWorkspaceNotFound
	// when missing.
	ResolveRef(ctx context.Context, subscriptionID uuid.UUID, ref string) (uuid.UUID, error)

	// HasActiveRole reports whether userID holds any active grant on
	// workspaceID. Used to enforce AC#3: in-tenant requests for a
	// workspace the actor has no role on return 403, not an empty list.
	HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error)
}

// PoolQuerier is the *pgxpool.Pool subset PoolWorkspaceLookup needs.
// Defined as an interface so tests of the lookup itself can pass a
// fixture-backed connection rather than a full pool.
type PoolQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PoolWorkspaceLookup is the production WorkspaceLookup adapter — it
// runs the three lookups against any PoolQuerier (typically *pgxpool.Pool).
type PoolWorkspaceLookup struct {
	Pool PoolQuerier
}

// FirstLiveWorkspace implements WorkspaceLookup.
func (l PoolWorkspaceLookup) FirstLiveWorkspace(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := l.Pool.QueryRow(ctx, sqlSelectFirstLiveWorkspaceID, subscriptionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNoWorkspace
	}
	return id, err
}

// ResolveSlug implements WorkspaceLookup.
func (l PoolWorkspaceLookup) ResolveSlug(ctx context.Context, subscriptionID uuid.UUID, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := l.Pool.QueryRow(ctx, sqlSelectWorkspaceIDBySlug, subscriptionID, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrWorkspaceNotFound
	}
	return id, err
}

// ResolveRef implements WorkspaceLookup. A well-formed UUID resolves
// by id (canonical, survives slug changes); anything else falls back
// to ResolveSlug. Both branches end with the same tenant + live
// gating so a UUID from another tenant returns ErrWorkspaceNotFound,
// not a cross-tenant leak.
func (l PoolWorkspaceLookup) ResolveRef(ctx context.Context, subscriptionID uuid.UUID, ref string) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		var got uuid.UUID
		qerr := l.Pool.QueryRow(ctx, sqlSelectWorkspaceIDByIDAndSubscription,
			id, subscriptionID).Scan(&got)
		if errors.Is(qerr, pgx.ErrNoRows) {
			return uuid.Nil, ErrWorkspaceNotFound
		}
		return got, qerr
	}
	return l.ResolveSlug(ctx, subscriptionID, ref)
}

// HasActiveRole implements WorkspaceLookup.
func (l PoolWorkspaceLookup) HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := l.Pool.QueryRow(ctx, sqlExistsActiveWorkspaceRole, workspaceID, userID).Scan(&ok)
	return ok, err
}
