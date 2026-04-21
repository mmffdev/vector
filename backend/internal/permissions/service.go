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
	UserID    uuid.UUID
	ProjectID uuid.UUID
	CanView   bool
	CanEdit   bool
	CanAdmin  bool
}

func (s *Service) Grant(ctx context.Context, in GrantInput, actor uuid.UUID, ip string) (*models.UserProjectPermission, error) {
	p := &models.UserProjectPermission{}
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO user_project_permissions (user_id, project_id, can_view, can_edit, can_admin, granted_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, project_id) DO UPDATE
		  SET can_view = EXCLUDED.can_view,
		      can_edit = EXCLUDED.can_edit,
		      can_admin = EXCLUDED.can_admin,
		      granted_by = EXCLUDED.granted_by,
		      updated_at = NOW()
		RETURNING id, user_id, project_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at`,
		in.UserID, in.ProjectID, in.CanView, in.CanEdit, in.CanAdmin, actor,
	).Scan(&p.ID, &p.UserID, &p.ProjectID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	pid := p.ProjectID.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "permission.granted",
		Resource: strPtr("project"), ResourceID: &pid,
		IPAddress: nilIfEmpty(ip),
		Metadata: map[string]any{
			"target_user": in.UserID, "can_view": in.CanView, "can_edit": in.CanEdit, "can_admin": in.CanAdmin,
		},
	})
	return p, nil
}

func (s *Service) Revoke(ctx context.Context, id uuid.UUID, actor uuid.UUID, ip string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM user_project_permissions WHERE id = $1`, id)
	if err != nil {
		return err
	}
	rid := id.String()
	s.Audit.Log(ctx, audit.Entry{
		UserID: &actor, Action: "permission.revoked",
		Resource: strPtr("user_project_permission"), ResourceID: &rid,
		IPAddress: nilIfEmpty(ip),
	})
	return nil
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID) ([]models.UserProjectPermission, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, project_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at
		FROM user_project_permissions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.UserProjectPermission{}
	for rows.Next() {
		p := models.UserProjectPermission{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.ProjectID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *Service) ListForProject(ctx context.Context, projectID uuid.UUID) ([]models.UserProjectPermission, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, project_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at
		FROM user_project_permissions WHERE project_id = $1`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.UserProjectPermission{}
	for rows.Next() {
		p := models.UserProjectPermission{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.ProjectID, &p.CanView, &p.CanEdit, &p.CanAdmin, &p.GrantedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func strPtr(s string) *string    { return &s }
func nilIfEmpty(s string) *string { if s == "" { return nil }; return &s }
