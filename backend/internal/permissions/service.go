package permissions

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/models"
)

// ErrNotFound is returned when the workspace, target user, or permission row
// either doesn't exist OR belongs to a different tenant. Existence is sensitive
// — same error either way (mirrors entityrefs.ErrEntityNotFound).
var ErrNotFound = errors.New("not found")

type Service struct {
	Pool  *pgxpool.Pool
	Audit *audit.Logger
}

func New(pool *pgxpool.Pool, a *audit.Logger) *Service {
	return &Service{Pool: pool, Audit: a}
}

type GrantInput struct {
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	CanView     bool
	CanEdit     bool
	CanAdmin    bool
}

// Grant inserts (or upserts) a permission row. Both the workspace and the
// target user must belong to actorTenant; cross-tenant attempts return
// ErrNotFound so the caller cannot probe for existence.
func (s *Service) Grant(ctx context.Context, in GrantInput, actorTenant, actor uuid.UUID, ip string) (*models.UserWorkspacePermission, error) {
	// Pre-flight: workspace and target user must be in actor's tenant.
	if err := s.assertWorkspaceInTenant(ctx, in.WorkspaceID, actorTenant); err != nil {
		return nil, err
	}
	if err := s.assertUserInTenant(ctx, in.UserID, actorTenant); err != nil {
		return nil, err
	}

	p := &models.UserWorkspacePermission{}
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO user_workspace_permissions (user_id, workspace_id, can_view, can_edit, can_admin, granted_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, workspace_id) DO UPDATE
		  SET can_view = EXCLUDED.can_view,
		      can_edit = EXCLUDED.can_edit,
		      can_admin = EXCLUDED.can_admin,
		      granted_by = EXCLUDED.granted_by,
		      updated_at = NOW()
		RETURNING id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at`,
		in.UserID, in.WorkspaceID, in.CanView, in.CanEdit, in.CanAdmin, actor,
	).Scan(&p.ID, &p.UserID, &p.WorkspaceID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	wid := p.WorkspaceID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "permission.granted",
		Resource: strPtr("workspace"), ResourceID: &wid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{
			"target_user": in.UserID, "can_view": in.CanView, "can_edit": in.CanEdit, "can_admin": in.CanAdmin,
		},
	})
	return p, nil
}

// Revoke deletes the permission row by id, but only if it belongs to a
// workspace in actorTenant. Returns ErrNotFound if no row matched.
func (s *Service) Revoke(ctx context.Context, id, actorTenant, actor uuid.UUID, ip string) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_workspace_permissions p
		 USING workspace w
		 WHERE p.id = $1
		   AND p.workspace_id = w.id
		   AND w.tenant_id = $2`, id, actorTenant)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	rid := id.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "permission.revoked",
		Resource: strPtr("user_workspace_permission"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
	})
	return nil
}

// ListForUser returns permissions for userID, scoped to workspaces in
// actorTenant. If userID is in another tenant, the result is an empty slice
// — same shape as a real user with no permissions, so existence isn't leaked.
func (s *Service) ListForUser(ctx context.Context, userID, actorTenant uuid.UUID) ([]models.UserWorkspacePermission, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT p.id, p.user_id, p.workspace_id, p.can_view, p.can_edit, p.can_admin,
		       p.granted_by, p.created_at, p.updated_at
		  FROM user_workspace_permissions p
		  JOIN workspace w ON w.id = p.workspace_id
		 WHERE p.user_id = $1
		   AND w.tenant_id = $2`, userID, actorTenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.UserWorkspacePermission{}
	for rows.Next() {
		p := models.UserWorkspacePermission{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.WorkspaceID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ListForWorkspace returns permissions for workspaceID. If the workspace is
// in another tenant, returns ErrNotFound (the workspace itself is the
// resource being addressed, so this is a 404, not an empty list).
func (s *Service) ListForWorkspace(ctx context.Context, workspaceID, actorTenant uuid.UUID) ([]models.UserWorkspacePermission, error) {
	if err := s.assertWorkspaceInTenant(ctx, workspaceID, actorTenant); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at
		FROM user_workspace_permissions WHERE workspace_id = $1`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.UserWorkspacePermission{}
	for rows.Next() {
		p := models.UserWorkspacePermission{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.WorkspaceID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *Service) assertWorkspaceInTenant(ctx context.Context, workspaceID, tenantID uuid.UUID) error {
	var got uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`SELECT tenant_id FROM workspace WHERE id = $1`, workspaceID,
	).Scan(&got)
	if err == pgx.ErrNoRows || (err == nil && got != tenantID) {
		return ErrNotFound
	}
	return err
}

func (s *Service) assertUserInTenant(ctx context.Context, userID, tenantID uuid.UUID) error {
	var got uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`SELECT tenant_id FROM users WHERE id = $1`, userID,
	).Scan(&got)
	if err == pgx.ErrNoRows || (err == nil && got != tenantID) {
		return ErrNotFound
	}
	return err
}

func strPtr(s string) *string    { return &s }
func nilIfEmpty(s string) *string { if s == "" { return nil }; return &s }
