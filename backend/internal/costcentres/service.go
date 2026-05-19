// Package costcentres owns the cost_centres table (mmff_vector pool)
// — subscription-scoped finance reference data used by per-user
// cost-centre assignment and reporting roll-ups. Vector-admin
// scope decision: this is tenant-managed data (each subscription
// keeps its own cost-centre list), distinct from office_locations
// which is platform-global vector-admin-managed.
//
// SOLE-WRITER: every INSERT/UPDATE/DELETE on cost_centres flows
// through this package. Read-side helpers may scan the table from
// elsewhere (e.g. users.List joining cost_centre_id), but writes
// belong here so the audit trail + invariants stay in one place.
package costcentres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrNotFound — cost centre id doesn't exist in the actor's tenant.
	// Cross-tenant lookups return this rather than leaking existence.
	ErrNotFound = errors.New("cost centre not found")
	// ErrDuplicateCode — INSERT/UPDATE hit the partial-unique index
	// on (subscription_id, code) WHERE archived_at IS NULL.
	ErrDuplicateCode = errors.New("cost centre code already in use")
	// ErrInvalid — payload-level validation failure (empty code, empty
	// name). Handler maps to 400 with a usermessages key.
	ErrInvalid = errors.New("invalid cost centre input")
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// CreateInput is what the handler hands to Create. Code + Name are
// required; ParentID is optional. IsActive defaults to true unless
// the caller explicitly sets false.
type CreateInput struct {
	ParentID *uuid.UUID
	Code     string
	Name     string
	IsActive *bool
}

// UpdateInput is sparse — every field optional; nil = no change.
// Empty code or empty name is rejected as ErrInvalid (treat
// "clear the field" as not allowed for these mandatory cols).
type UpdateInput struct {
	ParentID *uuid.UUID
	Code     *string
	Name     *string
	IsActive *bool
}

// List returns every live (non-archived) cost centre in the
// subscription, ordered by code. Used by the admin page and the
// per-user cost-centre dropdown.
func (s *Service) List(ctx context.Context, subscriptionID uuid.UUID) ([]CostCentre, error) {
	rows, err := s.pool.Query(ctx, sqlListBySubscription, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("costcentres.List: %w", err)
	}
	defer rows.Close()

	out := []CostCentre{}
	for rows.Next() {
		var c CostCentre
		if err := rows.Scan(&c.ID, &c.SubscriptionID, &c.ParentID, &c.Code, &c.Name,
			&c.IsActive, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("costcentres.List scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Create inserts a new cost centre in the actor's tenant. Returns
// ErrInvalid for empty code/name, ErrDuplicateCode on partial-unique
// collision. The caller (handler) is responsible for permission
// checks before calling.
func (s *Service) Create(ctx context.Context, subscriptionID uuid.UUID, in CreateInput) (*CostCentre, error) {
	code := strings.TrimSpace(in.Code)
	name := strings.TrimSpace(in.Name)
	if code == "" || name == "" {
		return nil, ErrInvalid
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}

	var c CostCentre
	err := s.pool.QueryRow(ctx, sqlInsertCostCentre,
		subscriptionID, in.ParentID, code, name, active,
	).Scan(&c.ID, &c.SubscriptionID, &c.ParentID, &c.Code, &c.Name,
		&c.IsActive, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrDuplicateCode
		}
		return nil, fmt.Errorf("costcentres.Create: %w", err)
	}
	return &c, nil
}

// Update sparse-mutates a cost centre. Cross-tenant id reads return
// ErrNotFound (no existence leak). Empty Code or Name (after trim)
// rejects with ErrInvalid — these are mandatory columns.
func (s *Service) Update(ctx context.Context, id, subscriptionID uuid.UUID, in UpdateInput) (*CostCentre, error) {
	// Cross-tenant preflight.
	var existing CostCentre
	if err := s.pool.QueryRow(ctx, sqlSelectByID, id, subscriptionID).
		Scan(&existing.ID, &existing.SubscriptionID, &existing.ParentID,
			&existing.Code, &existing.Name, &existing.IsActive,
			&existing.ArchivedAt, &existing.CreatedAt, &existing.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("costcentres.Update preflight: %w", err)
	}
	if existing.ArchivedAt != nil {
		return nil, ErrNotFound
	}

	sets := []string{}
	args := []any{id, subscriptionID}
	i := 3

	if in.Code != nil {
		v := strings.TrimSpace(*in.Code)
		if v == "" {
			return nil, ErrInvalid
		}
		sets = append(sets, fmt.Sprintf("code = $%d", i))
		args = append(args, v)
		i++
	}
	if in.Name != nil {
		v := strings.TrimSpace(*in.Name)
		if v == "" {
			return nil, ErrInvalid
		}
		sets = append(sets, fmt.Sprintf("name = $%d", i))
		args = append(args, v)
		i++
	}
	if in.ParentID != nil {
		// nil pointer is "no change"; the value being uuid.Nil clears
		// the column. We accept both. (uuid.Nil is the zero value of
		// uuid.UUID; the handler converts JSON null → nil pointer
		// and JSON missing → also nil pointer — same as our policy.)
		if *in.ParentID == uuid.Nil {
			sets = append(sets, fmt.Sprintf("parent_id = NULL"))
		} else {
			sets = append(sets, fmt.Sprintf("parent_id = $%d", i))
			args = append(args, *in.ParentID)
			i++
		}
	}
	if in.IsActive != nil {
		sets = append(sets, fmt.Sprintf("is_active = $%d", i))
		args = append(args, *in.IsActive)
		i++
	}

	if len(sets) == 0 {
		return &existing, nil
	}

	query := fmt.Sprintf(sqlUpdateCostCentreTemplate, strings.Join(sets, ", "))
	if _, err := s.pool.Exec(ctx, query, args...); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrDuplicateCode
		}
		return nil, fmt.Errorf("costcentres.Update: %w", err)
	}

	// Re-read so we return the post-update shape.
	var updated CostCentre
	if err := s.pool.QueryRow(ctx, sqlSelectByID, id, subscriptionID).
		Scan(&updated.ID, &updated.SubscriptionID, &updated.ParentID,
			&updated.Code, &updated.Name, &updated.IsActive,
			&updated.ArchivedAt, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return nil, fmt.Errorf("costcentres.Update reread: %w", err)
	}
	return &updated, nil
}

// Archive soft-archives a cost centre. The FK from users.cost_centre_id
// is ON DELETE RESTRICT, so the row must stay queryable for historical
// assignments — archive (not delete) is the right verb.
func (s *Service) Archive(ctx context.Context, id, subscriptionID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, sqlArchiveCostCentre, id, subscriptionID)
	if err != nil {
		return fmt.Errorf("costcentres.Archive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// isUniqueViolation returns true for Postgres SQLSTATE 23505.
// Pulled out so Create + Update can share it without importing
// pgconn into every caller.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// pgx wraps pgconn.PgError; checking the SQLSTATE substring is
	// sufficient and avoids importing pgconn here.
	return strings.Contains(err.Error(), "SQLSTATE 23505") ||
		strings.Contains(err.Error(), "duplicate key value")
}
