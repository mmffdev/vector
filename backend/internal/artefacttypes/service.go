package artefacttypes

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var hexColourRE = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// Service owns DB operations for the artefacts_types settings surface.
// It operates against vector_artefacts only.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// List returns all live artefact types in the caller's subscription,
// ordered by (scope, sort_order, name). Subscription-clamped only —
// admin/migration callers that don't have a workspace context use
// this entry point. User-facing requests should call ListByWorkspace
// (PLA-0053 / story 00579).
func (s *Service) List(ctx context.Context, subscriptionID uuid.UUID) ([]ArtefactType, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	// DISTINCT ON (scope, name) dedups duplicate seed rows produced by
	// historical seed-replays during the Pillar refactors — see
	// TD-ARTEFACT-TYPES-DUP-SEED in docs/c_tech_debt.md. Within a
	// (scope, name) collision, the row with the smallest UUID wins so
	// the picker UI binds to a stable canonical id across reloads. The
	// outer ORDER BY keeps the caller-facing ordering identical to the
	// pre-dedup shape so the picker layout is unchanged.
	const q = `
		WITH live AS (
			SELECT DISTINCT ON (artefacts_types_scope, artefacts_types_name)
				artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour, artefacts_types_slot,
				artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
				artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
			FROM artefacts_types
			WHERE artefacts_types_id_subscription = $1
			  AND artefacts_types_archived_at IS NULL
			ORDER BY artefacts_types_scope, artefacts_types_name, artefacts_types_id
		)
		SELECT
			artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour, artefacts_types_slot,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
		FROM live
		ORDER BY artefacts_types_scope, artefacts_types_sort_order, artefacts_types_name`

	return s.queryArtefactTypes(ctx, q, subscriptionID)
}

// ListByWorkspace returns all live artefact types in a single workspace,
// ordered by (scope, sort_order, name). PLA-0053 / story 00579 — the
// workspace clamp comes from the JWT-anchored claim seeded by
// sentinel.Middleware (PLA062 S05.4, replaced WorkspaceClampMiddleware).
// Handler resolves workspace via sentinel.WorkspaceIDFromCtx and
// passes it here; subscription_id is still passed for defence-in-depth
// (an artefact_type with a stale or forged workspace_id from a
// different subscription is still excluded by the AND clause).
func (s *Service) ListByWorkspace(ctx context.Context, subscriptionID, workspaceID uuid.UUID) ([]ArtefactType, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	// DISTINCT ON (scope, name) dedups duplicate seed rows — see the
	// matching block in List() and TD-ARTEFACT-TYPES-DUP-SEED in
	// docs/c_tech_debt.md. Same rationale: smallest UUID wins so the
	// FE picker binds to a stable canonical row.
	const q = `
		WITH live AS (
			SELECT DISTINCT ON (artefacts_types_scope, artefacts_types_name)
				artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour, artefacts_types_slot,
				artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
				artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
			FROM artefacts_types
			WHERE artefacts_types_id_subscription = $1
			  AND artefacts_types_id_workspace    = $2
			  AND artefacts_types_archived_at IS NULL
			ORDER BY artefacts_types_scope, artefacts_types_name, artefacts_types_id
		)
		SELECT
			artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour, artefacts_types_slot,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
		FROM live
		ORDER BY artefacts_types_scope, artefacts_types_sort_order, artefacts_types_name`

	return s.queryArtefactTypes(ctx, q, subscriptionID, workspaceID)
}

// queryArtefactTypes is the shared row-scan loop for List + ListByWorkspace.
func (s *Service) queryArtefactTypes(ctx context.Context, q string, args ...any) ([]ArtefactType, error) {
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("artefacttypes.queryArtefactTypes: %w", err)
	}
	defer rows.Close()

	var out []ArtefactType
	for rows.Next() {
		var t ArtefactType
		if err := rows.Scan(
			&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix,
			&t.Description, &t.Colour, &t.Slot,
			&t.ParentTypeID, &t.AllowsChildren, &t.LayerDepth,
			&t.SortOrder, &t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("artefacttypes.queryArtefactTypes scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Patch applies a partial update to one artefact type, scoped to the
// caller's subscription so cross-tenant writes are not addressable.
//
// Validation rules (mirrors frontend):
//   - name: 1–64 chars after trim
//   - prefix: 1–4 uppercase alphanumeric chars
//   - colour: nil or #RRGGBB hex
func (s *Service) Patch(ctx context.Context, id, subscriptionID uuid.UUID, in PatchInput) (*ArtefactType, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}

	var violations []Violation

	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if len(n) == 0 || len(n) > 64 {
			violations = append(violations, Violation{"name", "Name must be 1–64 characters."})
		}
	}
	if in.Prefix != nil {
		p := strings.ToUpper(strings.TrimSpace(*in.Prefix))
		if len(p) == 0 || len(p) > 4 {
			violations = append(violations, Violation{"prefix", "Prefix must be 1–4 characters."})
		}
		upper := regexp.MustCompile(`^[A-Z0-9]+$`)
		if !upper.MatchString(p) {
			violations = append(violations, Violation{"prefix", "Prefix must be uppercase letters/digits only."})
		}
	}
	if in.Colour != nil && *in.Colour != "" {
		if !hexColourRE.MatchString(*in.Colour) {
			violations = append(violations, Violation{"colour", "Colour must be a 6-digit hex value (e.g. #3B82F6)."})
		}
	}
	// ParentTypeID: empty string = clear to NULL, UUID string = set.
	// Self-reference check happens below once we know the target id; we
	// can't validate cross-tenant or cross-scope without a lookup, so
	// the FK + the application-layer guard in the SET branch handle that.
	var parentTypeUUID *uuid.UUID
	if in.ParentTypeID != nil && *in.ParentTypeID != "" {
		pid, perr := uuid.Parse(*in.ParentTypeID)
		if perr != nil {
			violations = append(violations, Violation{"parent_type_id", "parent_type_id must be a valid UUID."})
		} else if pid == id {
			violations = append(violations, Violation{"parent_type_id", "An artefact type cannot be its own parent."})
		} else {
			parentTypeUUID = &pid
		}
	}
	// LayerDepth: empty string = clear to NULL, otherwise must parse as
	// a non-negative integer.
	var layerDepthInt *int
	if in.LayerDepth != nil && *in.LayerDepth != "" {
		var n int
		if _, perr := fmt.Sscanf(*in.LayerDepth, "%d", &n); perr != nil || n < 0 {
			violations = append(violations, Violation{"layer_depth", "Layer depth must be a non-negative integer."})
		} else {
			layerDepthInt = &n
		}
	}

	if len(violations) > 0 {
		msgs := make([]string, len(violations))
		for i, v := range violations {
			msgs[i] = v.Field + ": " + v.Message
		}
		return nil, &ValidationError{Violations: violations}
	}

	// Build SET clause dynamically from non-nil fields.
	setClauses := []string{"artefacts_types_updated_at = now()"}
	args := []any{id, subscriptionID}
	argN := 3

	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		setClauses = append(setClauses, fmt.Sprintf("artefacts_types_name = $%d", argN))
		args = append(args, n)
		argN++
	}
	if in.Prefix != nil {
		p := strings.ToUpper(strings.TrimSpace(*in.Prefix))
		setClauses = append(setClauses, fmt.Sprintf("artefacts_types_prefix = $%d", argN))
		args = append(args, p)
		argN++
	}
	if in.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("artefacts_types_description = $%d", argN))
		args = append(args, *in.Description)
		argN++
	}
	if in.Colour != nil {
		c := *in.Colour
		if c == "" {
			setClauses = append(setClauses, fmt.Sprintf("artefacts_types_colour = $%d", argN))
			args = append(args, nil)
		} else {
			setClauses = append(setClauses, fmt.Sprintf("artefacts_types_colour = $%d", argN))
			args = append(args, c)
		}
		argN++
	}
	if in.ParentTypeID != nil {
		setClauses = append(setClauses, fmt.Sprintf("artefacts_types_id_parent_type = $%d", argN))
		if parentTypeUUID == nil {
			args = append(args, nil) // explicit clear to NULL
		} else {
			args = append(args, *parentTypeUUID)
		}
		argN++
	}
	if in.LayerDepth != nil {
		setClauses = append(setClauses, fmt.Sprintf("artefacts_types_layer_depth = $%d", argN))
		if layerDepthInt == nil {
			args = append(args, nil)
		} else {
			args = append(args, *layerDepthInt)
		}
		argN++
	}

	q := fmt.Sprintf(`
		UPDATE artefacts_types
		SET %s
		WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2 AND artefacts_types_archived_at IS NULL
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour, artefacts_types_slot,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at`,
		strings.Join(setClauses, ", "),
	)

	var t ArtefactType
	err := s.pool.QueryRow(ctx, q, args...).Scan(
		&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix,
		&t.Description, &t.Colour, &t.Slot,
		&t.ParentTypeID, &t.AllowsChildren, &t.LayerDepth,
		&t.SortOrder, &t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("artefacttypes.Patch: %w", err)
	}
	return &t, nil
}

var ErrNotFound = errors.New("artefact type not found")

// Violation is a single field-level validation failure.
type Violation struct {
	Field   string
	Message string
}

// ValidationError carries field-level violations for a 422 response.
type ValidationError struct {
	Violations []Violation
}

func (e *ValidationError) Error() string {
	msgs := make([]string, len(e.Violations))
	for i, v := range e.Violations {
		msgs[i] = v.Field + ": " + v.Message
	}
	return strings.Join(msgs, "; ")
}
