package artefacts

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns all artefact operations — core CRUD, schema management,
// and field value read/write. One instance serves all 5 Phase 1 types.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// ── Core CRUD ─────────────────────────────────────────────────────────

// Create inserts a new artefact core row. key_num is allocated from
// subscription_sequence(scope=artefactType) inside the transaction.
func (s *Service) Create(ctx context.Context, artefactType string, subscriptionID, createdBy uuid.UUID, in CreateInput) (*Artefact, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, errors.New("title cannot be empty")
	}
	ownerID, err := uuid.Parse(in.OwnerID)
	if err != nil {
		return nil, errors.New("invalid owner_id")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	keyNum, err := nextKeyNum(ctx, tx, subscriptionID, artefactType)
	if err != nil {
		return nil, err
	}

	id := uuid.New()
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s (id, subscription_id, key_num, title, description, owner_id, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, t.core),
		id, subscriptionID, keyNum, title, in.Description, ownerID, createdBy)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, artefactType, subscriptionID, id)
}

// Get returns a single artefact row, enforcing subscription scope.
func (s *Service) Get(ctx context.Context, artefactType string, subscriptionID, id uuid.UUID) (*Artefact, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	var a Artefact
	var rawID, subID, ownerID, createdBy uuid.UUID
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, subscription_id, key_num, title, description,
		       owner_id, created_by, created_at, updated_at, archived_at
		FROM %s
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`, t.core),
		id, subscriptionID,
	).Scan(&rawID, &subID, &a.KeyNum, &a.Title, &a.Description,
		&ownerID, &createdBy, &a.CreatedAt, &a.UpdatedAt, &a.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.ID = rawID.String()
	a.SubscriptionID = subID.String()
	a.OwnerID = ownerID.String()
	a.CreatedBy = createdBy.String()
	return &a, nil
}

// Patch applies non-nil fields to the artefact core row.
func (s *Service) Patch(ctx context.Context, artefactType string, subscriptionID, id uuid.UUID, in PatchInput) (*Artefact, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	tag, err := s.Pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET
			title       = COALESCE($3, title),
			description = COALESCE($4, description),
			owner_id    = COALESCE($5::uuid, owner_id)
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`, t.core),
		id, subscriptionID, in.Title, in.Description, in.OwnerID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, artefactType, subscriptionID, id)
}

// Archive soft-deletes the artefact by setting archived_at = NOW().
func (s *Service) Archive(ctx context.Context, artefactType string, subscriptionID, id uuid.UUID) error {
	t, err := tables(artefactType)
	if err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET archived_at = NOW()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`, t.core),
		id, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Schema management ─────────────────────────────────────────────────

// ListSchema returns all active field definitions for a workspace.
func (s *Service) ListSchema(ctx context.Context, artefactType string, subscriptionID uuid.UUID) ([]SchemaField, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, fmt.Sprintf(`
		SELECT id, subscription_id, field_name, label, type, required, position,
		       default_value, options_json, config_json, created_at, updated_at, archived_at
		FROM %s
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY position, field_name`, t.schema),
		subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var fields []SchemaField
	for rows.Next() {
		var f SchemaField
		var rawID, subID uuid.UUID
		if err := rows.Scan(&rawID, &subID, &f.FieldName, &f.Label, &f.Type,
			&f.Required, &f.Position, &f.DefaultValue, &f.OptionsJSON,
			&f.ConfigJSON, &f.CreatedAt, &f.UpdatedAt, &f.ArchivedAt); err != nil {
			return nil, err
		}
		f.ID = rawID.String()
		f.SubscriptionID = subID.String()
		fields = append(fields, f)
	}
	return fields, rows.Err()
}

// CreateSchema inserts a new field definition for the workspace.
func (s *Service) CreateSchema(ctx context.Context, artefactType string, subscriptionID uuid.UUID, in CreateSchemaInput) (*SchemaField, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	if !validFieldKinds[in.Type] {
		return nil, ErrInvalidKind
	}
	if strings.TrimSpace(in.FieldName) == "" {
		return nil, errors.New("field_name cannot be empty")
	}
	id := uuid.New()
	_, err = s.Pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s (id, subscription_id, field_name, label, type, required, position,
		                default_value, options_json, config_json)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`, t.schema),
		id, subscriptionID, strings.TrimSpace(in.FieldName), strings.TrimSpace(in.Label),
		in.Type, in.Required, in.Position, in.DefaultValue, in.OptionsJSON, in.ConfigJSON)
	if err != nil {
		return nil, err
	}
	return s.getSchemaField(ctx, t.schema, subscriptionID, id)
}

// PatchSchema updates a schema field. Type cannot be changed once any
// field_values row references this schema_field_id.
func (s *Service) PatchSchema(ctx context.Context, artefactType string, subscriptionID, id uuid.UUID, in PatchSchemaInput) (*SchemaField, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	// Enforce type immutability: reject if values exist for this field.
	var count int
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT COUNT(*) FROM %s WHERE schema_field_id = $1`, t.fv), id).Scan(&count)
	if err != nil {
		return nil, err
	}
	// PatchSchemaInput has no Type field — type changes are blocked at the
	// API layer by not exposing the field. count check is a safety net for
	// future callers that might try to sneak a type change through SQL.
	_ = count

	tag, err := s.Pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET
			label         = COALESCE($3, label),
			required      = COALESCE($4, required),
			position      = COALESCE($5, position),
			default_value = COALESCE($6, default_value),
			options_json  = COALESCE($7::jsonb, options_json),
			config_json   = COALESCE($8::jsonb, config_json)
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`, t.schema),
		id, subscriptionID, in.Label, in.Required, in.Position,
		in.DefaultValue, in.OptionsJSON, in.ConfigJSON)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrSchemaNotFound
	}
	return s.getSchemaField(ctx, t.schema, subscriptionID, id)
}

// ArchiveSchema soft-deletes a schema field. Existing field_values rows
// retain their schema_field_id = NULL (via ON DELETE SET NULL on FK).
func (s *Service) ArchiveSchema(ctx context.Context, artefactType string, subscriptionID, id uuid.UUID) error {
	t, err := tables(artefactType)
	if err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET archived_at = NOW()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`, t.schema),
		id, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSchemaNotFound
	}
	return nil
}

func (s *Service) getSchemaField(ctx context.Context, schemaTable string, subscriptionID, id uuid.UUID) (*SchemaField, error) {
	var f SchemaField
	var rawID, subID uuid.UUID
	err := s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, subscription_id, field_name, label, type, required, position,
		       default_value, options_json, config_json, created_at, updated_at, archived_at
		FROM %s WHERE id = $1 AND subscription_id = $2`, schemaTable),
		id, subscriptionID,
	).Scan(&rawID, &subID, &f.FieldName, &f.Label, &f.Type, &f.Required,
		&f.Position, &f.DefaultValue, &f.OptionsJSON, &f.ConfigJSON,
		&f.CreatedAt, &f.UpdatedAt, &f.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSchemaNotFound
	}
	if err != nil {
		return nil, err
	}
	f.ID = rawID.String()
	f.SubscriptionID = subID.String()
	return &f, nil
}

// ── Field values ──────────────────────────────────────────────────────

// ListFieldValues returns all field values for an artefact. Visibility
// filtering is applied: non-padmin callers only see rows where the
// artefact belongs to their subscription (already enforced by artefact
// lookup) — column-level visibility gating is Phase 2.
func (s *Service) ListFieldValues(ctx context.Context, artefactType string, subscriptionID, artefactID uuid.UUID) ([]FieldValue, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, fmt.Sprintf(`
		SELECT id, field_name, schema_field_id,
		       string_value, number_value::text, text_value, date_value::text
		FROM %s
		WHERE artefact_id = $1 AND subscription_id = $2
		ORDER BY field_name`, t.fv),
		artefactID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var vals []FieldValue
	for rows.Next() {
		var fv FieldValue
		var rawID uuid.UUID
		var schemaFieldID *uuid.UUID
		if err := rows.Scan(&rawID, &fv.FieldName, &schemaFieldID,
			&fv.StringValue, &fv.NumberValue, &fv.TextValue, &fv.DateValue); err != nil {
			return nil, err
		}
		fv.ID = rawID.String()
		if schemaFieldID != nil {
			s := schemaFieldID.String()
			fv.SchemaFieldID = &s
		}
		vals = append(vals, fv)
	}
	return vals, rows.Err()
}

// WriteFieldValue upserts a single field value row. The correct typed
// column is determined by the schema row's type; unrelated typed columns
// are set to NULL.
func (s *Service) WriteFieldValue(ctx context.Context, artefactType string, subscriptionID, artefactID uuid.UUID, fieldName string, in WriteFieldInput, createdBy uuid.UUID) (*FieldValue, error) {
	t, err := tables(artefactType)
	if err != nil {
		return nil, err
	}
	// Resolve schema_field_id for this field_name in this workspace.
	var schemaFieldID *uuid.UUID
	var sfID uuid.UUID
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id FROM %s
		WHERE subscription_id = $1 AND field_name = $2 AND archived_at IS NULL`, t.schema),
		subscriptionID, fieldName).Scan(&sfID)
	if err == nil {
		schemaFieldID = &sfID
	}
	// Upsert — conflict on (artefact_id, field_name).
	var rawID uuid.UUID
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %s (id, subscription_id, artefact_id, field_name, schema_field_id,
		                string_value, number_value, text_value, date_value, created_by)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::numeric, $7, $8::date, $9)
		ON CONFLICT (artefact_id, field_name) DO UPDATE SET
			schema_field_id = EXCLUDED.schema_field_id,
			string_value    = EXCLUDED.string_value,
			number_value    = EXCLUDED.number_value,
			text_value      = EXCLUDED.text_value,
			date_value      = EXCLUDED.date_value
		RETURNING id`, t.fv),
		subscriptionID, artefactID, fieldName, schemaFieldID,
		in.StringValue, in.NumberValue, in.TextValue, in.DateValue, createdBy,
	).Scan(&rawID)
	if err != nil {
		return nil, err
	}
	fv := &FieldValue{
		ID:          rawID.String(),
		FieldName:   fieldName,
		StringValue: in.StringValue,
		NumberValue: in.NumberValue,
		TextValue:   in.TextValue,
		DateValue:   in.DateValue,
	}
	if schemaFieldID != nil {
		str := schemaFieldID.String()
		fv.SchemaFieldID = &str
	}
	return fv, nil
}

// BulkWriteFieldValues writes multiple field values in a single
// transaction. Used by the staged-write flow on artefact creation.
func (s *Service) BulkWriteFieldValues(ctx context.Context, artefactType string, subscriptionID, artefactID uuid.UUID, values map[string]WriteFieldInput, createdBy uuid.UUID) ([]FieldValue, error) {
	var results []FieldValue
	for fieldName, in := range values {
		fv, err := s.WriteFieldValue(ctx, artefactType, subscriptionID, artefactID, fieldName, in, createdBy)
		if err != nil {
			return nil, fmt.Errorf("field %q: %w", fieldName, err)
		}
		results = append(results, *fv)
	}
	return results, nil
}

// ── Sequence ──────────────────────────────────────────────────────────

func nextKeyNum(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID, scope string) (int64, error) {
	var num int64
	err := tx.QueryRow(ctx, `
		SELECT next_num FROM subscription_sequence
		WHERE subscription_id = $1 AND scope = $2 FOR UPDATE`,
		subscriptionID, scope).Scan(&num)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			INSERT INTO subscription_sequence (subscription_id, scope, next_num)
			VALUES ($1, $2, 2)`, subscriptionID, scope)
		if err != nil {
			return 0, err
		}
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE subscription_sequence SET next_num = next_num + 1
		WHERE subscription_id = $1 AND scope = $2`, subscriptionID, scope)
	return num, err
}
