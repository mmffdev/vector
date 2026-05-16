package workspaces

// workspace_roles operations (PLA-0006 / story 00376). Mirrors the
// org_node_roles surface in orgdesign: insert-or-return-existing
// grants, single-admin partial-unique invariant, soft-revoke via
// revoked_at + revoked_by stamp, list of active grants.
//
// The single-admin partial unique index workspace_roles_single_admin
// (migration 098) provides the DB-level invariant. We surface it as a
// typed ErrSingleAdminViolation before the round-trip so callers see
// the same shape orgdesign returns.
//
// Permission gates — workspace_roles management is an admin-tier
// action; we re-use workspace.rename (the closest "manage this
// workspace" perm in the migration 100 catalogue) as the gate. A
// future story can split this out into workspace.grant / .revoke if
// the product needs finer-grained delegation.

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// GrantRole inserts (or returns an existing) workspace_roles row.
// Idempotent: same (workspaceID, userID) with an active grant
// returns the existing row's id — the role parameter is NOT updated
// in that case (a re-grant with a different role must explicitly
// revoke + re-grant).
//
// Single-admin invariant: when role==RoleAdmin and an active admin
// grant already exists for this workspace, returns
// ErrSingleAdminViolation. The DB also enforces this via the
// partial unique index; we check first for the typed error.
//
// Permission gate: workspace.rename (treated as the "manage this
// workspace" perm in the MVP grant matrix).
func (s *Service) GrantRole(
	ctx context.Context,
	subscriptionID, workspaceID, userID uuid.UUID,
	role Role,
	actorID uuid.UUID,
) (uuid.UUID, error) {
	if !role.IsValid() {
		return uuid.Nil, ErrInvalidRole
	}
	if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.rename")); err != nil {
		return uuid.Nil, err
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadWorkspace(ctx, tx, workspaceID, subscriptionID, false); err != nil {
		return uuid.Nil, err
	}

	// Idempotent: same (workspace, user) with an active grant returns it.
	var existingID uuid.UUID
	err = tx.QueryRow(ctx, sqlSelectActiveGrantForUserOnWorkspace,
		workspaceID, userID).Scan(&existingID)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return uuid.Nil, err
		}
		return existingID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}

	if role == RoleAdmin {
		var hasAdmin bool
		if err := tx.QueryRow(ctx, sqlExistsActiveAdminGrantOnWorkspace,
			workspaceID).Scan(&hasAdmin); err != nil {
			return uuid.Nil, err
		}
		if hasAdmin {
			return uuid.Nil, ErrSingleAdminViolation
		}
	}

	var newID uuid.UUID
	err = tx.QueryRow(ctx, sqlInsertWorkspaceRoleGrant,
		subscriptionID, workspaceID, userID, string(role), actorID).Scan(&newID)
	if err != nil {
		// Defence in depth: the partial unique index can still fire
		// under concurrent grants — translate to the typed error.
		if isUniqueViolation(err) && role == RoleAdmin {
			return uuid.Nil, ErrSingleAdminViolation
		}
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}

	gid := newID.String()
	wid := workspaceID.String()
	uid := userID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &actorID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.role_granted",
		Resource:       strPtr("workspace_role"),
		ResourceID:     &gid,
		Metadata: map[string]any{
			"workspace_id": wid,
			"user_id":      uid,
			"role":         string(role),
		},
	})
	return newID, nil
}

// RevokeRole stamps revoked_at + revoked_by on an active grant for
// (workspaceID, userID). Already-revoked grants and missing grants
// both return ErrGrantNotFound — callers may choose to treat the
// action as idempotent at the API layer.
//
// Permission gate: workspace.rename.
func (s *Service) RevokeRole(
	ctx context.Context,
	subscriptionID, workspaceID, userID, actorID uuid.UUID,
) error {
	if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.rename")); err != nil {
		return err
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadWorkspace(ctx, tx, workspaceID, subscriptionID, true); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, sqlRevokeWorkspaceRoleGrant,
		actorID, workspaceID, userID, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	wid := workspaceID.String()
	uid := userID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &actorID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.role_revoked",
		Resource:       strPtr("workspace_role"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"workspace_id": wid,
			"user_id":      uid,
		},
	})
	return nil
}

// ListRoles returns every active grant on workspaceID, ordered by
// granted_at ASC. Cross-tenant access returns an empty slice via the
// load-workspace tenant check (no existence leak).
//
// Reads are not permission-gated — the route layer's clamp predicate
// decides what the actor sees. Mirrors orgdesign reads.
func (s *Service) ListRoles(ctx context.Context, subscriptionID, workspaceID uuid.UUID) ([]WorkspaceRoleGrant, error) {
	// Tenant + existence check up-front.
	if _, err := s.Get(ctx, subscriptionID, workspaceID); err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, sqlListActiveWorkspaceRoles,
		workspaceID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WorkspaceRoleGrant{}
	for rows.Next() {
		var g WorkspaceRoleGrant
		if err := rows.Scan(
			&g.ID, &g.SubscriptionID, &g.WorkspaceID, &g.UserID, &g.Role,
			&g.CanRedelegate, &g.GrantedBy, &g.GrantedAt,
			&g.RevokedAt, &g.RevokedBy, &g.CreatedAt, &g.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
