package permissions

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/models"
)

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

func (s *Service) Grant(ctx context.Context, in GrantInput, actor uuid.UUID, ip string) (*models.UserWorkspacePermission, error) {
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

func (s *Service) Revoke(ctx context.Context, id uuid.UUID, actor uuid.UUID, ip string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM user_workspace_permissions WHERE id = $1`, id)
	if err != nil {
		return err
	}
	rid := id.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "permission.revoked",
		Resource: strPtr("user_workspace_permission"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
	})
	return nil
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID) ([]models.UserWorkspacePermission, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at
		FROM user_workspace_permissions WHERE user_id = $1`, userID)
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

func (s *Service) ListForWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]models.UserWorkspacePermission, error) {
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

func strPtr(s string) *string    { return &s }
func nilIfEmpty(s string) *string { if s == "" { return nil }; return &s }
