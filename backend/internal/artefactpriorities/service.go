package artefactpriorities

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns artefact_priorities CRUD against vector_artefacts.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// ListByWorkspace returns live (non-archived) priorities in a workspace
// sorted by (sort_order, name). Used by the frontend catalogue provider.
func (s *Service) ListByWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]Priority, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	rows, err := s.pool.Query(ctx, sqlListByWorkspace, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("artefactpriorities.ListByWorkspace: %w", err)
	}
	defer rows.Close()

	var out []Priority
	for rows.Next() {
		var p Priority
		if err := rows.Scan(
			&p.ID, &p.WorkspaceID, &p.Name, &p.Slot,
			&p.SortOrder, &p.Colour, &p.ArchivedAt,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("artefactpriorities.ListByWorkspace scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Create inserts a new custom (slot=null) priority. Name is required.
func (s *Service) Create(ctx context.Context, workspaceID uuid.UUID, in CreateInput) (*Priority, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 64 {
		return nil, fmt.Errorf("%w: name must be 1-64 chars", ErrInvalidInput)
	}

	var p Priority
	err := s.pool.QueryRow(ctx, sqlInsert,
		workspaceID, name, in.SortOrder, in.Colour,
	).Scan(
		&p.ID, &p.WorkspaceID, &p.Name, &p.Slot,
		&p.SortOrder, &p.Colour, &p.ArchivedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("artefactpriorities.Create: %w", err)
	}
	return &p, nil
}

// Patch applies a partial update to a priority. The workspace clamp is
// applied via the WHERE so a cross-workspace ID acts as not-found.
//
// Slotted rows (system seeds) accept name/sort_order/colour changes but
// the slot itself is not exposed on PatchInput — gadmin can rename
// "Critical" to "Showstopper-Critical" but cannot reassign its slot
// or repurpose it as a custom row.
func (s *Service) Patch(ctx context.Context, id, workspaceID uuid.UUID, in PatchInput) (*Priority, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}

	sets := []string{"updated_at = now()"}
	args := []any{id, workspaceID}
	n := 3
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" || len(name) > 64 {
			return nil, fmt.Errorf("%w: name must be 1-64 chars", ErrInvalidInput)
		}
		sets = append(sets, fmt.Sprintf("name = $%d", n))
		args = append(args, name)
		n++
	}
	if in.SortOrder != nil {
		sets = append(sets, fmt.Sprintf("sort_order = $%d", n))
		args = append(args, *in.SortOrder)
		n++
	}
	if in.Colour != nil {
		sets = append(sets, fmt.Sprintf("colour = $%d", n))
		if *in.Colour == "" {
			args = append(args, nil)
		} else {
			args = append(args, *in.Colour)
		}
		n++
	}

	q := fmt.Sprintf(sqlPatchTemplate, strings.Join(sets, ", "))

	var p Priority
	err := s.pool.QueryRow(ctx, q, args...).Scan(
		&p.ID, &p.WorkspaceID, &p.Name, &p.Slot,
		&p.SortOrder, &p.Colour, &p.ArchivedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("artefactpriorities.Patch: %w", err)
	}
	return &p, nil
}

// Archive soft-archives a priority. Slotted rows are protected — the
// 4 system priorities cannot be archived because removing them would
// silently break filtering/sort. Returns ErrSlottedRow in that case.
func (s *Service) Archive(ctx context.Context, id, workspaceID uuid.UUID) error {
	if s.pool == nil {
		return errors.New("vector_artefacts pool not available")
	}

	var slot *string
	err := s.pool.QueryRow(ctx, sqlReadSlot, id, workspaceID).Scan(&slot)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("artefactpriorities.Archive lookup: %w", err)
	}
	if slot != nil {
		return ErrSlottedRow
	}

	_, err = s.pool.Exec(ctx, sqlArchive, id, workspaceID)
	if err != nil {
		return fmt.Errorf("artefactpriorities.Archive: %w", err)
	}
	return nil
}
