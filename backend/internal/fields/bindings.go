package fields

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Sentinel errors specific to type bindings.
//
// ErrBindingNotFound — PATCH against a (field_id, type_id) tuple that has no row.
// ErrUnknownArtefactType — any artefact_type_id submitted is missing, archived,
// or belongs to another tenant. Wire format is 404 (existence-leak guard —
// same posture as saved-views).
var (
	ErrBindingNotFound     = errors.New("fields: binding not found")
	ErrUnknownArtefactType = errors.New("fields: unknown artefact type")
)

// TypeBinding is the wire/service shape of one row in artefacts_types_fields,
// optionally enriched with the type label + scope so the GET response can
// render without a separate fetch.
type TypeBinding struct {
	ArtefactTypeID    uuid.UUID
	ArtefactTypeName  string // joined from artefacts_types — empty on inbound writes
	ArtefactTypeScope string // "work" | "strategy" — joined from artefacts_types
	Position          int
	Required          bool
	DefaultValue      *string
}

// BindingPatch is the partial-update body for UpdateBinding.
type BindingPatch struct {
	Position     *int
	Required     *bool
	DefaultValue *string // pointer-to-pointer would be the only way to express
	// "set to NULL"; we use the simpler convention: empty string ("") means
	// "set NULL". The editor's text input maps blank → "" which the service
	// rewrites to NULL on the way to SQL.
}

// ListBindingsForField returns every binding for the field, joined with
// the type label + scope so the caller can render without a second fetch.
// Tenant clamp: only bindings where the type shares subID with the field.
func (s *Service) ListBindingsForField(
	ctx context.Context,
	subID, fieldID uuid.UUID,
) ([]TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}
	rows, err := s.artefactsPool.Query(ctx, sqlListBindingsForField, fieldID, subID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TypeBinding{}
	for rows.Next() {
		var b TypeBinding
		if err := rows.Scan(
			&b.ArtefactTypeID,
			&b.ArtefactTypeName,
			&b.ArtefactTypeScope,
			&b.Position,
			&b.Required,
			&b.DefaultValue,
		); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ReplaceBindingsForField replaces the full set atomically. Diffs against
// the current set, upserts the requested rows, deletes the rows that are
// no longer in the set. All inside one transaction.
//
// Returns ErrUnknownArtefactType if any requested artefact_type_id is
// missing, archived, or in another tenant.
func (s *Service) ReplaceBindingsForField(
	ctx context.Context,
	subID, fieldID uuid.UUID,
	wanted []TypeBinding,
) ([]TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}

	// 1. Validate every requested type belongs to this tenant + is alive.
	wantedIDs := make([]uuid.UUID, len(wanted))
	for i, b := range wanted {
		wantedIDs[i] = b.ArtefactTypeID
	}
	if len(wantedIDs) > 0 {
		rows, err := s.artefactsPool.Query(ctx, sqlValidateArtefactTypesInTenant, wantedIDs, subID)
		if err != nil {
			return nil, err
		}
		valid := map[uuid.UUID]struct{}{}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			valid[id] = struct{}{}
		}
		rows.Close()
		for _, id := range wantedIDs {
			if _, ok := valid[id]; !ok {
				return nil, ErrUnknownArtefactType
			}
		}
	}

	// 2. One transaction: upsert each wanted row, delete rows not in the set.
	tx, err := s.artefactsPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, b := range wanted {
		if _, err := tx.Exec(ctx, sqlUpsertBinding,
			b.ArtefactTypeID, fieldID, b.Position, b.Required, b.DefaultValue,
		); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, sqlDeleteBindingsNotIn, fieldID, wantedIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// 3. Read back the new state with the joined labels so the caller can
	//    render the response immediately.
	return s.ListBindingsForField(ctx, subID, fieldID)
}

// UpdateBinding patches one binding's position / required / default_value.
// Pointer fields: nil → don't change. For default_value the wire convention
// is "empty string means NULL" but here we accept the pointer as-is and let
// the SQL COALESCE handle it; the caller (handler) is responsible for
// the empty-string→nil translation if the user wants to clear the value.
func (s *Service) UpdateBinding(
	ctx context.Context,
	subID, fieldID, typeID uuid.UUID,
	p BindingPatch,
) (*TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}

	// Tenant clamp: validate the type before touching the binding row.
	rows, err := s.artefactsPool.Query(ctx, sqlValidateArtefactTypesInTenant, []uuid.UUID{typeID}, subID)
	if err != nil {
		return nil, err
	}
	valid := false
	for rows.Next() {
		valid = true
	}
	rows.Close()
	if !valid {
		return nil, ErrUnknownArtefactType
	}

	// Patch + RETURNING.
	row := s.artefactsPool.QueryRow(ctx, sqlPatchBinding,
		fieldID, typeID, p.Position, p.Required, p.DefaultValue,
	)
	var b TypeBinding
	if err := row.Scan(
		&b.ArtefactTypeID,
		&b.Position,
		&b.Required,
		&b.DefaultValue,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrBindingNotFound
		}
		return nil, err
	}

	// Re-fetch with the joined label so the response is enriched.
	row = s.artefactsPool.QueryRow(ctx, sqlFetchOneBinding, fieldID, typeID)
	if err := row.Scan(
		&b.ArtefactTypeID,
		&b.ArtefactTypeName,
		&b.ArtefactTypeScope,
		&b.Position,
		&b.Required,
		&b.DefaultValue,
	); err != nil {
		return nil, err
	}
	return &b, nil
}
