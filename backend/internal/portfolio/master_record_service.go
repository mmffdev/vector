// Package portfolio is the SOLE writer for the master_record_portfolios
// table (PLA-0026 / Story 00490, B1). One row exists per workspace and
// holds the persistent portfolio model record (model identity + adoption
// metadata). The row is inserted by the adoption saga (B6) at adoption
// time; absence means "no model adopted" — there is no auto-seed trigger.
//
// master_record_portfolios lives in vector_artefacts (separate Postgres
// database from mmff_vector). The Service holds the vector_artefacts
// pool; cross-DB validation against mmff_vector (e.g. workspace exists,
// adopted_by_user_id belongs to the workspace's tenant) is handled at
// the saga / handler boundary, not inside this service — keeping the
// sole-writer scope tight.
//
// Writer-boundary contract: every INSERT / UPDATE / DELETE against
// master_record_portfolios MUST go through this package. Enforced by
// dev/scripts/lint_writer_boundary.py.
package portfolio

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/models"
)

var (
	ErrNotFound     = errors.New("portfolio master record not found")
	ErrPoolMissing  = errors.New("vector_artefacts pool not configured")
	ErrInvalidInput = errors.New("invalid input")
)

// MasterRecord is the wire shape returned to callers. Field names mirror
// the columns on master_record_portfolios. Pointer types are nullable on
// the wire.
type MasterRecord struct {
	WorkspaceID       uuid.UUID  `json:"workspace_id"`
	ModelID           *uuid.UUID `json:"model_id"`
	ModelName         string     `json:"model_name"`
	ModelDescription  *string    `json:"model_description"`
	AdoptedAt         time.Time  `json:"adopted_at"`
	AdoptedByUserID   *uuid.UUID `json:"adopted_by_user_id"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ArchivedAt        *time.Time `json:"archived_at"`
}

// UpsertInput is the saga's adoption payload (B6). model_name is the
// only required field; the rest are nullable.
type UpsertInput struct {
	WorkspaceID      uuid.UUID
	ModelID          *uuid.UUID
	ModelName        string
	ModelDescription *string
	AdoptedByUserID  *uuid.UUID
}

// PatchInput is the partial update payload. Pointer fields are
// "absent = no change". Empty-string for nullable text fields clears
// them, matching the work-items / tenant-settings PATCH convention.
type PatchInput struct {
	ModelID          *string `json:"model_id,omitempty"`
	ModelName        *string `json:"model_name,omitempty"`
	ModelDescription *string `json:"model_description,omitempty"`
	AdoptedByUserID  *string `json:"adopted_by_user_id,omitempty"`
}

// Violation is a per-field validation error (mirrors tenantsettings).
type Violation struct {
	Field   string
	Message string
}

// ValidationError aggregates one or more field violations.
type ValidationError struct {
	Violations []Violation
}

func (v *ValidationError) Error() string {
	if len(v.Violations) == 0 {
		return "validation failed"
	}
	parts := make([]string, 0, len(v.Violations))
	for _, vv := range v.Violations {
		parts = append(parts, fmt.Sprintf("%s: %s", vv.Field, vv.Message))
	}
	return "validation failed — " + strings.Join(parts, "; ")
}

// Service is the sole-writer surface for master_record_portfolios.
type Service struct {
	// vectorArtefactsPool reads + writes vector_artefacts. May be nil
	// when VECTOR_ARTEFACTS_DB_URL is unset; in that case all methods
	// return ErrPoolMissing rather than panicking.
	vectorArtefactsPool *pgxpool.Pool

	// vectorPool reads mmff_vector for tenancy + workspace-membership
	// probes used by CanReadMasterRecord. Optional: when nil, the read
	// authz path falls back to "padmin/gadmin only" so unit tests that
	// bypass the DB still exercise the deny path without panicking.
	// Wired via WithVectorPool to avoid breaking the legacy
	// NewService(vaPool) signature used by the adoption saga.
	vectorPool *pgxpool.Pool
}

// NewService builds a Service backed by the given vector_artefacts pool.
// Pass nil to construct a no-op Service that surfaces ErrPoolMissing on
// every call — useful for boot configurations where the artefacts DB is
// optional (see artefactitemsv2 for the same pattern).
//
// To enable the read authz path (CanReadMasterRecord), chain
// .WithVectorPool(pool) — the master-record HTTP handler requires it.
func NewService(vaPool *pgxpool.Pool) *Service {
	return &Service{vectorArtefactsPool: vaPool}
}

// WithVectorPool attaches the mmff_vector pool used by CanReadMasterRecord
// for tenancy + workspace-membership probes. Returns the Service for
// fluent wiring at boot.
func (s *Service) WithVectorPool(p *pgxpool.Pool) *Service {
	s.vectorPool = p
	return s
}

// CanReadMasterRecord reports whether u may read workspaceID's master
// record. Returns:
//
//	(true,  nil) — caller is allowed.
//	(false, nil) — workspace not in caller's tenant OR caller is not a
//	               member of the workspace; treat as 404 (leak-resistant
//	               existence semantics).
//	(_,     err) — DB error.
//
// Tenant admins (padmin / gadmin) bypass the workspace_roles probe but
// still require the workspace to belong to their tenant. When vectorPool
// is nil (unit tests bypassing the DB), only padmin/gadmin pass.
func (s *Service) CanReadMasterRecord(
	ctx context.Context, u *models.User, workspaceID uuid.UUID,
) (bool, error) {
	if u == nil {
		return false, nil
	}
	// Without a vector pool we cannot prove tenancy; only padmin/gadmin
	// pass. This path exists for unit tests that bypass the DB.
	if s.vectorPool == nil {
		return u.Role == models.RolePAdmin || u.Role == models.RoleGAdmin, nil
	}

	// Tenancy: workspace must belong to caller's subscription.
	var ownerSub uuid.UUID
	err := s.vectorPool.QueryRow(ctx, sqlSelectWorkspaceSubscriptionID, workspaceID).
		Scan(&ownerSub)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if ownerSub != u.SubscriptionID {
		return false, nil
	}

	// Tenant admins always pass.
	if u.Role == models.RolePAdmin || u.Role == models.RoleGAdmin {
		return true, nil
	}

	// Per-workspace membership: any active roles_workspaces grant
	// (viewer / editor / admin) suffices.
	var member bool
	err = s.vectorPool.QueryRow(ctx, sqlExistsActiveWorkspaceMembership,
		workspaceID, u.ID,
	).Scan(&member)
	if err != nil {
		return false, err
	}
	return member, nil
}

// Get returns the master_record_portfolios row for workspaceID, or
// ErrNotFound if none exists. No auto-seed: callers (the saga, the
// handler) must distinguish "no model adopted" from a hard error.
func (s *Service) Get(ctx context.Context, workspaceID uuid.UUID) (*MasterRecord, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrPoolMissing
	}
	row, err := s.read(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return row, err
}

func (s *Service) read(ctx context.Context, workspaceID uuid.UUID) (*MasterRecord, error) {
	var x MasterRecord
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectMasterRecord, workspaceID).Scan(
		&x.WorkspaceID, &x.ModelID, &x.ModelName, &x.ModelDescription,
		&x.AdoptedAt, &x.AdoptedByUserID,
		&x.CreatedAt, &x.UpdatedAt, &x.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &x, nil
}

// Upsert is the saga's adoption write (B6). On conflict by workspace_id
// it overwrites model identity + adoption metadata and clears
// archived_at — adoption resurrects an archived record.
func (s *Service) Upsert(ctx context.Context, in UpsertInput) (*MasterRecord, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrPoolMissing
	}
	if in.WorkspaceID == uuid.Nil {
		return nil, &ValidationError{Violations: []Violation{{Field: "workspace_id", Message: "required"}}}
	}
	name := strings.TrimSpace(in.ModelName)
	if name == "" {
		return nil, &ValidationError{Violations: []Violation{{Field: "model_name", Message: "required"}}}
	}
	if len(name) > 256 {
		return nil, &ValidationError{Violations: []Violation{{Field: "model_name", Message: "must be 256 characters or fewer"}}}
	}
	if in.ModelDescription != nil && len(*in.ModelDescription) > 4000 {
		return nil, &ValidationError{Violations: []Violation{{Field: "model_description", Message: "must be 4000 characters or fewer"}}}
	}

	if _, err := s.vectorArtefactsPool.Exec(ctx, sqlUpsertMasterRecord,
		in.WorkspaceID, in.ModelID, name, in.ModelDescription, in.AdoptedByUserID,
	); err != nil {
		return nil, err
	}
	return s.read(ctx, in.WorkspaceID)
}

// Patch applies a partial update. Validation failures return a
// *ValidationError; pgx.ErrNoRows surfaces as ErrNotFound.
func (s *Service) Patch(ctx context.Context, workspaceID uuid.UUID, in PatchInput) (*MasterRecord, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrPoolMissing
	}
	if _, err := s.Get(ctx, workspaceID); err != nil {
		return nil, err
	}

	violations := []Violation{}
	sets := []string{}
	args := []any{}
	addSet := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}

	if in.ModelID != nil {
		v := strings.TrimSpace(*in.ModelID)
		if v == "" {
			addSet("master_record_portfolios_id_library_portfolio_model", nil)
		} else {
			id, err := uuid.Parse(v)
			if err != nil {
				violations = append(violations, Violation{Field: "model_id", Message: "must be a valid UUID"})
			} else {
				addSet("master_record_portfolios_id_library_portfolio_model", id)
			}
		}
	}
	if in.ModelName != nil {
		v := strings.TrimSpace(*in.ModelName)
		if v == "" {
			violations = append(violations, Violation{Field: "model_name", Message: "required"})
		} else if len(v) > 256 {
			violations = append(violations, Violation{Field: "model_name", Message: "must be 256 characters or fewer"})
		} else {
			addSet("master_record_portfolios_model_name", v)
		}
	}
	if in.ModelDescription != nil {
		if len(*in.ModelDescription) > 4000 {
			violations = append(violations, Violation{Field: "model_description", Message: "must be 4000 characters or fewer"})
		} else if *in.ModelDescription == "" {
			addSet("master_record_portfolios_model_description", nil)
		} else {
			addSet("master_record_portfolios_model_description", *in.ModelDescription)
		}
	}
	if in.AdoptedByUserID != nil {
		v := strings.TrimSpace(*in.AdoptedByUserID)
		if v == "" {
			addSet("master_record_portfolios_id_user_adopter", nil)
		} else {
			id, err := uuid.Parse(v)
			if err != nil {
				violations = append(violations, Violation{Field: "adopted_by_user_id", Message: "must be a valid UUID"})
			} else {
				addSet("master_record_portfolios_id_user_adopter", id)
			}
		}
	}

	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}
	if len(sets) == 0 {
		return s.read(ctx, workspaceID)
	}

	args = append(args, workspaceID)
	q := fmt.Sprintf(sqlUpdateMasterRecordTemplate, strings.Join(sets, ", "), len(args))
	if _, err := s.vectorArtefactsPool.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	return s.read(ctx, workspaceID)
}

// Archive soft-archives the row by stamping archived_at. Idempotent:
// re-archiving an already-archived row is a no-op (the row is matched
// regardless of state).
func (s *Service) Archive(ctx context.Context, workspaceID uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrPoolMissing
	}
	tag, err := s.vectorArtefactsPool.Exec(ctx, sqlArchiveMasterRecord, workspaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete is intentionally absent. The table is soft-archive only; hard
// deletes are reserved for tenant teardown which is a privileged
// migration path, not application code.
