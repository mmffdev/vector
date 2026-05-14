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

// List returns all live artefact types for the given subscription,
// ordered by (scope, sort_order, name).
func (s *Service) List(ctx context.Context, subscriptionID uuid.UUID) ([]ArtefactType, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	const q = `
		SELECT
			artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at
		FROM artefacts_types
		WHERE artefacts_types_id_subscription = $1
		  AND artefacts_types_archived_at IS NULL
		ORDER BY artefacts_types_scope, artefacts_types_sort_order, artefacts_types_name`

	rows, err := s.pool.Query(ctx, q, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("artefacttypes.List: %w", err)
	}
	defer rows.Close()

	var out []ArtefactType
	for rows.Next() {
		var t ArtefactType
		if err := rows.Scan(
			&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix,
			&t.Description, &t.Colour,
			&t.ParentTypeID, &t.AllowsChildren, &t.LayerDepth,
			&t.SortOrder, &t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("artefacttypes.List scan: %w", err)
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

	q := fmt.Sprintf(`
		UPDATE artefacts_types
		SET %s
		WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2 AND artefacts_types_archived_at IS NULL
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix, artefacts_types_description, artefacts_types_colour,
			artefacts_types_id_parent_type, artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at, artefacts_types_created_at, artefacts_types_updated_at`,
		strings.Join(setClauses, ", "),
	)

	var t ArtefactType
	err := s.pool.QueryRow(ctx, q, args...).Scan(
		&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix,
		&t.Description, &t.Colour,
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
