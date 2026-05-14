// Package roles is the sole writer for the roles + role_permissions tables.
//
// All mutation paths for tenant-custom roles flow through Service. The five
// system roles (gadmin/padmin/team_lead/user/external) are immutable — Update
// may change only label/description, and AssignPermissions/RevokePermissions
// are rejected outright. The DB also enforces this via CHECK constraints
// (rank bands, is_system invariant), but the service rejects earlier with a
// clearer error.
//
// Self-elevation rule: an actor cannot grant any role a permission the actor
// does not themselves hold. This blocks the trivial "grant role X
// users.create.gadmin, then assign role X to myself" privilege escalation.
package roles

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// System role UUIDs from migration 088. These are the five seeded
// is_system rows and they cannot be deleted, archived, or have their
// permission grids edited.
var (
	SystemRoleGadmin   = uuid.MustParse("00000000-0000-0000-0000-00000000ad30")
	SystemRolePadmin   = uuid.MustParse("00000000-0000-0000-0000-00000000ad25")
	SystemRoleTeamLead = uuid.MustParse("00000000-0000-0000-0000-00000000ad20")
	SystemRoleUser     = uuid.MustParse("00000000-0000-0000-0000-00000000ad10")
	SystemRoleExternal = uuid.MustParse("00000000-0000-0000-0000-00000000ad05")
)

// systemRoleSet is the lookup used by mutation guards.
var systemRoleSet = map[uuid.UUID]struct{}{
	SystemRoleGadmin:   {},
	SystemRolePadmin:   {},
	SystemRoleTeamLead: {},
	SystemRoleUser:     {},
	SystemRoleExternal: {},
}

// Reserved tenant-rank bands. Tenant-custom roles must NOT use ranks
// 5/10/20/25/30 — those belong to system roles. The DB has the same
// CHECK constraint (roles_tenant_rank_band); we mirror it here for a
// clearer error before the round-trip.
var reservedSystemRanks = map[int]struct{}{5: {}, 10: {}, 20: {}, 25: {}, 30: {}}

// Sentinel errors. Same family/shape as polymorphicrefs.
var (
	// ErrNotFound — role doesn't exist OR belongs to another tenant.
	// Existence is sensitive; same error either way.
	ErrNotFound = errors.New("not found")

	// ErrSystemRoleImmutable — caller tried to mutate a row in the
	// is_system band beyond the permitted label/description fields.
	ErrSystemRoleImmutable = errors.New("system roles are immutable")

	// ErrReservedRank — tenant role attempted to use a system-reserved rank.
	ErrReservedRank = errors.New("rank reserved for system roles")

	// ErrSelfElevation — actor tried to grant a role a permission the
	// actor does not themselves hold.
	ErrSelfElevation = errors.New("cannot grant a permission you do not hold")

	// ErrCodeTaken — duplicate (subscription_id, code) for tenant rows
	// or duplicate code for system rows.
	ErrCodeTaken = errors.New("role code already exists in scope")
)

// PermissionResolver is the contract roles.Service consumes for
// reading an actor's effective permission CODES as a flat string slice.
// permissions.Resolver.PermissionCodesFor satisfies it; tests can pass
// a small fake. Decoupling here avoids an import cycle with
// internal/permissions and lets handler.go drop its direct DB lookup
// (PLA-0039 / Story 00529, B22.9).
type PermissionResolver interface {
	PermissionCodesFor(ctx context.Context, userID uuid.UUID) ([]string, error)
}

type Service struct {
	Pool     *pgxpool.Pool
	Audit    *audit.Logger
	Resolver PermissionResolver
}

func New(pool *pgxpool.Pool, a *audit.Logger) *Service {
	return &Service{Pool: pool, Audit: a}
}

// ResolveActorPermissionIDs returns the set of permission row IDs for
// the actor's effective code grid. Composes the cached resolver lookup
// (codes) with a single DB round-trip (codes → ids). Returns an empty
// set when the resolver is nil or the actor has no grid. Lives on the
// service so handler.go does not touch the DB.
func (s *Service) ResolveActorPermissionIDs(ctx context.Context, actorID uuid.UUID) (map[uuid.UUID]struct{}, error) {
	if s.Resolver == nil {
		return map[uuid.UUID]struct{}{}, nil
	}
	codes, err := s.Resolver.PermissionCodesFor(ctx, actorID)
	if err != nil {
		return nil, err
	}
	if len(codes) == 0 {
		return map[uuid.UUID]struct{}{}, nil
	}
	rows, err := s.Pool.Query(ctx, sqlSelectPermissionIDsByCode, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]struct{}, len(codes))
	for rows.Next() {
		var pid uuid.UUID
		if err := rows.Scan(&pid); err != nil {
			return nil, err
		}
		out[pid] = struct{}{}
	}
	return out, rows.Err()
}

// IsSystemRole returns true if the given role id is one of the five
// seeded system rows. Exposed for use by other packages (e.g. the
// users service when checking role-ceiling moves).
func IsSystemRole(id uuid.UUID) bool {
	_, ok := systemRoleSet[id]
	return ok
}

// List returns all roles visible to actorTenant — that is, every system
// role plus every non-archived tenant-custom role belonging to actorTenant.
func (s *Service) List(ctx context.Context, actorTenant uuid.UUID) ([]roletypes.RoleRow, error) {
	rows, err := s.Pool.Query(ctx, sqlListRolesVisibleToTenant, actorTenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRoleRows(rows)
}

// Get returns a single role by id, scoped to actorTenant. System roles
// are visible to every tenant; tenant rows in another subscription return
// ErrNotFound (no existence leak).
func (s *Service) Get(ctx context.Context, id, actorTenant uuid.UUID) (*roletypes.RoleRow, error) {
	r := &roletypes.RoleRow{}
	err := s.Pool.QueryRow(ctx, sqlSelectRoleByIDInTenant, id, actorTenant).
		Scan(&r.ID, &r.SubscriptionID, &r.Code, &r.Label, &r.Description, &r.Rank,
			&r.IsSystem, &r.IsExternal, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt, &r.CreatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

type CreateInput struct {
	Code        string
	Label       string
	Description string
	Rank        int
	IsExternal  bool
}

// Create inserts a tenant-custom role under actorTenant. System rows can
// only be created by SQL migration; this method always sets is_system=false
// and subscription_id=actorTenant.
func (s *Service) Create(ctx context.Context, in CreateInput, actorTenant, actor uuid.UUID, ip string) (*roletypes.RoleRow, error) {
	if _, reserved := reservedSystemRanks[in.Rank]; reserved {
		return nil, ErrReservedRank
	}
	if in.Rank <= 0 {
		return nil, fmt.Errorf("rank must be positive: got %d", in.Rank)
	}
	if in.Code == "" {
		return nil, fmt.Errorf("code is required")
	}
	if in.Label == "" {
		return nil, fmt.Errorf("label is required")
	}

	r := &roletypes.RoleRow{}
	err := s.Pool.QueryRow(ctx, sqlInsertTenantRole,
		actorTenant, in.Code, in.Label, in.Description, in.Rank, in.IsExternal, actor,
	).Scan(&r.ID, &r.SubscriptionID, &r.Code, &r.Label, &r.Description, &r.Rank,
		&r.IsSystem, &r.IsExternal, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt, &r.CreatedBy)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrCodeTaken
		}
		return nil, err
	}

	rid := r.ID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "role.created",
		Resource: strPtr("role"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{
			"code": r.Code, "label": r.Label, "rank": r.Rank, "is_external": r.IsExternal,
		},
	})
	return r, nil
}

type UpdateInput struct {
	Label       *string
	Description *string
	Rank        *int
}

// Update edits a role. For system roles only Label and Description are
// permitted; any attempt to change Rank on a system row returns
// ErrSystemRoleImmutable.
func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput, actorTenant, actor uuid.UUID, ip string) (*roletypes.RoleRow, error) {
	existing, err := s.Get(ctx, id, actorTenant)
	if err != nil {
		return nil, err
	}

	if existing.IsSystem && in.Rank != nil {
		return nil, ErrSystemRoleImmutable
	}
	if !existing.IsSystem && in.Rank != nil {
		if _, reserved := reservedSystemRanks[*in.Rank]; reserved {
			return nil, ErrReservedRank
		}
		if *in.Rank <= 0 {
			return nil, fmt.Errorf("rank must be positive")
		}
	}
	// Tenant rows: only owners can edit (DB enforces tenant scope via Get;
	// system rows are gadmin-only; the handler layer enforces that).

	label := existing.Label
	if in.Label != nil {
		label = *in.Label
	}
	description := existing.Description
	if in.Description != nil {
		description = *in.Description
	}
	rank := existing.Rank
	if in.Rank != nil {
		rank = *in.Rank
	}

	r := &roletypes.RoleRow{}
	err = s.Pool.QueryRow(ctx, sqlUpdateRole, id, label, description, rank).
		Scan(&r.ID, &r.SubscriptionID, &r.Code, &r.Label, &r.Description, &r.Rank,
			&r.IsSystem, &r.IsExternal, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt, &r.CreatedBy)
	if err != nil {
		return nil, err
	}

	rid := r.ID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "role.updated",
		Resource: strPtr("role"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{
			"label_changed": in.Label != nil, "rank_changed": in.Rank != nil,
		},
	})
	return r, nil
}

// Archive soft-archives a tenant-custom role. System roles cannot be
// archived. Returns ErrSystemRoleImmutable if attempted.
func (s *Service) Archive(ctx context.Context, id uuid.UUID, actorTenant, actor uuid.UUID, ip string) error {
	existing, err := s.Get(ctx, id, actorTenant)
	if err != nil {
		return err
	}
	if existing.IsSystem {
		return ErrSystemRoleImmutable
	}
	_, err = s.Pool.Exec(ctx, sqlArchiveRole, id)
	if err != nil {
		return err
	}

	rid := id.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "role.archived",
		Resource: strPtr("role"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
	})
	return nil
}

// AssignPermissions grants permissionIDs to roleID. System roles' grids
// are frozen — attempting to mutate one returns ErrSystemRoleImmutable.
//
// Self-elevation gate: every permission ID being granted MUST be already
// held by the actor (via the actor's role's grid). actorPermissionIDs is
// the resolved set the caller has — caller is expected to have looked it
// up via the (forthcoming) middleware cache.
func (s *Service) AssignPermissions(
	ctx context.Context,
	roleID uuid.UUID,
	permissionIDs []uuid.UUID,
	actorTenant, actor uuid.UUID,
	actorPermissionIDs map[uuid.UUID]struct{},
	ip string,
) error {
	role, err := s.Get(ctx, roleID, actorTenant)
	if err != nil {
		return err
	}
	if role.IsSystem {
		return ErrSystemRoleImmutable
	}
	for _, pid := range permissionIDs {
		if _, ok := actorPermissionIDs[pid]; !ok {
			return ErrSelfElevation
		}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, pid := range permissionIDs {
		_, err := tx.Exec(ctx, sqlUpsertRolePermission, roleID, pid, actor)
		if err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	rid := roleID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "role.permissions_granted",
		Resource: strPtr("role"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{"permission_ids": uuidStrings(permissionIDs)},
	})
	return nil
}

// RevokePermissions removes permissionIDs from roleID. Same immutability
// rule as AssignPermissions — system grids are frozen. No self-elevation
// check needed (revocation cannot escalate).
func (s *Service) RevokePermissions(
	ctx context.Context,
	roleID uuid.UUID,
	permissionIDs []uuid.UUID,
	actorTenant, actor uuid.UUID,
	ip string,
) error {
	role, err := s.Get(ctx, roleID, actorTenant)
	if err != nil {
		return err
	}
	if role.IsSystem {
		return ErrSystemRoleImmutable
	}

	_, err = s.Pool.Exec(ctx, sqlDeleteRolePermissions, roleID, permissionIDs)
	if err != nil {
		return err
	}

	rid := roleID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "role.permissions_revoked",
		Resource: strPtr("role"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{"permission_ids": uuidStrings(permissionIDs)},
	})
	return nil
}

// ListPermissionsForRole returns the permission IDs currently granted
// to roleID. Tenant-scoped via Get for system/role visibility.
func (s *Service) ListPermissionsForRole(ctx context.Context, roleID, actorTenant uuid.UUID) ([]uuid.UUID, error) {
	if _, err := s.Get(ctx, roleID, actorTenant); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, sqlListPermissionIDsForRole, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var pid uuid.UUID
		if err := rows.Scan(&pid); err != nil {
			return nil, err
		}
		out = append(out, pid)
	}
	return out, nil
}

// ListPermissionsCatalogue returns every row from the permissions
// catalogue ordered by (category, code). The catalogue is server-wide
// (not tenant-scoped); the visibility check is the actor's
// roles.list permission, enforced at the route layer.
func (s *Service) ListPermissionsCatalogue(ctx context.Context) ([]roletypes.PermissionRow, error) {
	rows, err := s.Pool.Query(ctx, sqlListPermissionsCatalogue)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []roletypes.PermissionRow{}
	for rows.Next() {
		var p roletypes.PermissionRow
		if err := rows.Scan(&p.ID, &p.Code, &p.Label, &p.Category, &p.Description, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── helpers ─────────────────────────────────────────────────

func scanRoleRows(rows pgx.Rows) ([]roletypes.RoleRow, error) {
	out := []roletypes.RoleRow{}
	for rows.Next() {
		r := roletypes.RoleRow{}
		if err := rows.Scan(
			&r.ID, &r.SubscriptionID, &r.Code, &r.Label, &r.Description, &r.Rank,
			&r.IsSystem, &r.IsExternal, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt, &r.CreatedBy,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func isUniqueViolation(err error) bool {
	// pgx wraps PgError; SQLSTATE 23505 = unique_violation.
	type sqlStater interface{ SQLState() string }
	var s sqlStater
	if errors.As(err, &s) {
		return s.SQLState() == "23505"
	}
	return false
}

func strPtr(s string) *string { return &s }
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
