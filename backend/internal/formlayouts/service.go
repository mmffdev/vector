package formlayouts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

var (
	// ErrNotFound — no current layout for the (node, type).
	ErrNotFound = errors.New("form layout not found")
	// ErrMissingMandatory — a save omitted a mandatory core field.
	ErrMissingMandatory = errors.New("layout missing mandatory core field")
	// ErrUnknownField — a cell references a field key not in the catalogue.
	ErrUnknownField = errors.New("layout references unknown field")
	// ErrBadTemplate — a row template or cell count is invalid.
	ErrBadTemplate = errors.New("layout has an invalid grid template")
)

// Service is the sole writer of topology_node_form_layouts. Runs on
// vaPool (vector_artefacts).
type Service struct {
	vaPool *pgxpool.Pool
}

func NewService(vaPool *pgxpool.Pool) *Service {
	return &Service{vaPool: vaPool}
}

// ValidationError carries the structured 422 detail for a rejected save.
type ValidationError struct {
	Err     error
	Missing []string
	Field   string
	Reason  string
}

func (e *ValidationError) Error() string { return e.Reason }
func (e *ValidationError) Unwrap() error { return e.Err }

// GetCurrent returns the live layout for (node, type) or ErrNotFound.
func (s *Service) GetCurrent(ctx context.Context, nodeID, typeID uuid.UUID) (*Layout, error) {
	return s.scanOne(ctx, sqlSelectCurrentLayoutByNodeType, nodeID, typeID)
}

// GetByID returns a specific version row (used by the runtime form to
// render an artefact stamped with artefacts_id_form_layout).
func (s *Service) GetByID(ctx context.Context, layoutID uuid.UUID) (*Layout, error) {
	return s.scanOne(ctx, sqlSelectLayoutByID, layoutID)
}

func (s *Service) scanOne(ctx context.Context, q string, args ...any) (*Layout, error) {
	var l Layout
	var raw []byte
	err := s.vaPool.QueryRow(ctx, q, args...).Scan(
		&l.ID, &l.TopologyNodeID, &l.ArtefactTypeID, &l.WorkspaceID,
		&l.Version, &l.IsCurrent, &raw, &l.CreatedAt, &l.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &l.Doc); err != nil {
		return nil, fmt.Errorf("unmarshal layout_json: %w", err)
	}
	return &l, nil
}

// SaveInput is the upsert payload.
type SaveInput struct {
	WorkspaceID    uuid.UUID
	TopologyNodeID uuid.UUID
	ArtefactTypeID uuid.UUID
	CreatedBy      uuid.UUID
	Doc            LayoutDoc
	// CustomFieldKeys is the set of valid custom: keys bound to the type
	// (resolved by the handler from the catalogue) — used for validation.
	CustomFieldKeys map[string]bool
}

// Save validates the layout then upserts it: the prior current row for
// (node, type) is flipped is_current=false and a new version row inserted.
// SERVER IS THE GATE — mandatory core fields must be present; unknown field
// keys and malformed templates are rejected.
func (s *Service) Save(ctx context.Context, in SaveInput) (*Layout, error) {
	if verr := validateDoc(in.Doc, in.CustomFieldKeys); verr != nil {
		return nil, verr
	}

	tx, err := s.vaPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Next version = max existing + 1 for this (node, type).
	var nextVersion int
	err = tx.QueryRow(ctx, sqlNextLayoutVersion,
		in.TopologyNodeID, in.ArtefactTypeID).Scan(&nextVersion)
	if err != nil {
		return nil, err
	}

	// Retire the prior current row (if any).
	if _, err = tx.Exec(ctx, sqlRetireCurrentLayout,
		in.TopologyNodeID, in.ArtefactTypeID); err != nil {
		return nil, err
	}

	// Stamp version into the doc so the persisted JSON is self-describing.
	in.Doc.Version = nextVersion
	docJSON, err := json.Marshal(in.Doc)
	if err != nil {
		return nil, err
	}

	var newID uuid.UUID
	var createdBy any
	if in.CreatedBy != uuid.Nil {
		createdBy = in.CreatedBy
	}
	err = tx.QueryRow(ctx, sqlInsertLayout,
		in.TopologyNodeID, in.ArtefactTypeID, in.WorkspaceID,
		nextVersion, docJSON, createdBy).Scan(&newID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetByID(ctx, newID)
}

// validateDoc enforces template integrity, known field keys, and the
// mandatory-core-field gate.
func validateDoc(doc LayoutDoc, customKeys map[string]bool) error {
	placed := map[string]bool{}
	for _, row := range doc.Rows {
		spans, ok := templateSpans[row.Template]
		if !ok {
			return &ValidationError{Err: ErrBadTemplate, Reason: fmt.Sprintf("unknown template %q", row.Template)}
		}
		if len(row.Cells) != len(spans) {
			return &ValidationError{Err: ErrBadTemplate, Reason: fmt.Sprintf("template %q expects %d cells, got %d", row.Template, len(spans), len(row.Cells))}
		}
		for _, cell := range row.Cells {
			if cell.FieldKey == nil {
				continue // empty slot is fine
			}
			key := *cell.FieldKey
			if err := validateFieldKey(key, customKeys); err != nil {
				return err
			}
			placed[key] = true
		}
	}
	var missing []string
	for _, k := range mandatoryCoreFieldKeys {
		if !placed[k] {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return &ValidationError{
			Err:     ErrMissingMandatory,
			Missing: missing,
			Reason:  fmt.Sprintf("layout must place mandatory core field(s): %v", missing),
		}
	}
	return nil
}

func validateFieldKey(key string, customKeys map[string]bool) error {
	if len(key) > 7 && key[:7] == "custom:" {
		if customKeys != nil && !customKeys[key] {
			return &ValidationError{Err: ErrUnknownField, Field: key, Reason: fmt.Sprintf("unknown custom field %q", key)}
		}
		return nil
	}
	if !artefactitems.IsKnownArtefactItemColumn(key) {
		return &ValidationError{Err: ErrUnknownField, Field: key, Reason: fmt.Sprintf("unknown core field %q", key)}
	}
	return nil
}

// CoreFields returns the core-field descriptors for the builder sidebar,
// derived from the authoritative artefactitems column catalogue. Custom
// fields bound to the type are appended by the handler (it owns the
// catalogue join).
func (s *Service) CoreFields() []CoreFieldDescriptor {
	out := make([]CoreFieldDescriptor, 0, len(artefactitems.ArtefactItemColumns))
	for _, c := range artefactitems.ArtefactItemColumns {
		// Skip pure-audit / id-internal columns the builder shouldn't offer.
		if skipFromBuilder(c.Name) {
			continue
		}
		out = append(out, CoreFieldDescriptor{
			FieldKey:    c.Name,
			Label:       labelOr(c.Label, c.Name),
			DataType:    inferDataType(c.Name),
			Kind:        "core",
			Group:       c.Group,
			IsMandatory: isMandatoryCore(c.Name),
		})
	}
	return out
}

// CustomFields returns the custom-field descriptors bound to an artefact
// type (for the builder sidebar's Custom section) plus the valid-key set
// used by Save's validation. FieldKey is "custom:<library_id>".
func (s *Service) CustomFields(ctx context.Context, typeID, subscriptionID uuid.UUID) ([]CoreFieldDescriptor, map[string]bool, error) {
	rows, err := s.vaPool.Query(ctx, sqlListCustomFieldsForType, typeID, subscriptionID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var out []CoreFieldDescriptor
	keys := map[string]bool{}
	for rows.Next() {
		var libID, name, label, fieldType string
		var required bool
		if err := rows.Scan(&libID, &name, &label, &fieldType, &required); err != nil {
			return nil, nil, err
		}
		key := "custom:" + libID
		keys[key] = true
		out = append(out, CoreFieldDescriptor{
			FieldKey:    key,
			Label:       labelOr(label, name),
			DataType:    customDataType(fieldType),
			Kind:        "custom",
			Group:       "Custom",
			IsMandatory: false,
		})
	}
	return out, keys, rows.Err()
}

// customDataType maps an artefacts_fields_library_field_type to the
// renderer input kind. Catalogue types are already close to the
// renderer's vocabulary; this normalises the few that differ.
func customDataType(fieldType string) string {
	switch fieldType {
	case "richtext", "rich_text", "longtext", "long_text":
		return "richtext"
	case "number", "integer", "decimal":
		return "number"
	case "date", "datetime":
		return "date"
	case "boolean", "bool", "checkbox":
		return "boolean"
	case "select", "dropdown", "enum", "single_select":
		return "select"
	default:
		return "textbox"
	}
}

func labelOr(label, name string) string {
	if label != "" {
		return label
	}
	return name
}

// skipFromBuilder hides internal id/audit columns from the sidebar.
func skipFromBuilder(name string) bool {
	switch name {
	case "id", "subscription_id", "created_at", "updated_at", "archived_at",
		"artefact_type_id", "flow_state_id", "priority_id", "sprint_id",
		"milestone_id", "owner_id", "parent_id", "root_feature_id",
		"topology_node_id", "type_prefix", "submitted_by_user_id",
		"flow_state_change_owner_user_id":
		return true
	}
	return false
}

// inferDataType maps a core column name to the renderer's input kind.
// Coarse-grained for the PoC — refined as the renderer matures.
func inferDataType(name string) string {
	switch name {
	case "description", "description_doc", "notes", "notes_doc",
		"defect_steps_to_reproduce", "defect_steps_to_reproduce_doc":
		return "richtext"
	case "story_points", "rollup_points", "estimate_hours",
		"estimate_remaining", "estimate_initial_value",
		"risk_impact_score", "risk_probability_score",
		"strategic_preliminary_estimate_value":
		return "number"
	case "due_date", "planned_start_date", "planned_finish_date",
		"actual_start_date", "actual_end_date", "work_accepted_date":
		return "date"
	case "is_blocked", "is_expedite", "is_ready", "affects_doc",
		"defect_is_release_note", "defect_is_regression":
		return "boolean"
	case "flow_state_name", "status", "priority", "sprint", "release_id",
		"owner":
		return "select"
	default:
		return "textbox"
	}
}
