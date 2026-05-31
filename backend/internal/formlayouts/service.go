package formlayouts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/vectorfields"
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
	vf     *vectorfields.Service
}

func NewService(vaPool *pgxpool.Pool, vf *vectorfields.Service) *Service {
	return &Service{vaPool: vaPool, vf: vf}
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

// GetDraftOrCurrent is the BUILDER's load path: it returns the WIP draft
// for (node, type) if one exists, else the published current layout, else
// ErrNotFound. The runtime form renderer must NOT use this — it calls
// GetCurrent (drafts excluded) so a half-built draft never goes live.
func (s *Service) GetDraftOrCurrent(ctx context.Context, nodeID, typeID uuid.UUID) (*Layout, error) {
	draft, err := s.scanOne(ctx, sqlSelectDraftByNodeType, nodeID, typeID)
	if err == nil {
		return draft, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	return s.GetCurrent(ctx, nodeID, typeID)
}

func (s *Service) scanOne(ctx context.Context, q string, args ...any) (*Layout, error) {
	var l Layout
	var raw []byte
	err := s.vaPool.QueryRow(ctx, q, args...).Scan(
		&l.ID, &l.TopologyNodeID, &l.ArtefactTypeID, &l.WorkspaceID,
		&l.Version, &l.IsCurrent, &l.IsDraft, &raw, &l.CreatedAt, &l.UpdatedAt,
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
	// CompulsoryCustomKeys is the subset of CustomFieldKeys flagged compulsory
	// for this type (artefacts_types_fields_is_compulsory, mig 167). The
	// publish gate requires every one of these be PLACED on the layout, exactly
	// as it requires the compulsory CORE set — so a team can mark a custom field
	// "must appear on every form for this type" and the server enforces it.
	CompulsoryCustomKeys map[string]bool
	// Slot + Scope identify the artefact type's family (resolved by the
	// handler via TypeSlotScope). The save validator rejects any core field
	// placed on a type it does not apply to (mirrors the slot-gate trigger):
	// a layout cannot persist defect_severity onto a Story form. Slot is ""
	// for strategy types.
	Slot  string
	Scope string
}

// TypeSlotScope resolves an artefact type's slot + scope, subscription-scoped
// for defence-in-depth. slot is "" for strategy types (NULL in the DB). A
// cross-tenant or archived type id returns ErrNotFound.
func (s *Service) TypeSlotScope(ctx context.Context, typeID, subscriptionID uuid.UUID) (slot, scope string, err error) {
	var slotN, scopeN sql.NullString
	err = s.vaPool.QueryRow(ctx, sqlSelectTypeSlotScope, typeID, subscriptionID).
		Scan(&slotN, &scopeN)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return slotN.String, scopeN.String, nil
}

// Save validates the layout then upserts it: the prior current row for
// (node, type) is flipped is_current=false and a new version row inserted.
// SERVER IS THE GATE — mandatory core fields must be present; unknown field
// keys and malformed templates are rejected.
func (s *Service) Save(ctx context.Context, in SaveInput) (*Layout, error) {
	if verr := validateDoc(in.Doc, in.CustomFieldKeys, in.CompulsoryCustomKeys, in.Slot, in.Scope); verr != nil {
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

	// Publishing supersedes any WIP draft for this (node, type): drop it so
	// the builder doesn't reload a stale draft over the freshly-published
	// layout. No-op if no draft exists.
	if _, err = tx.Exec(ctx, sqlDeleteDraft,
		in.TopologyNodeID, in.ArtefactTypeID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetByID(ctx, newID)
}

// SaveDraft upserts the single WIP draft row for (node, type). A draft is
// NOT validated against the compulsory-field gate — it is intentionally
// allowed to be incomplete (that is the whole point of a draft). It does
// not burn a version, does not flip is_current, and is never read by the
// runtime form renderer. Field-key/template integrity is still checked so a
// malformed document can't be persisted.
func (s *Service) SaveDraft(ctx context.Context, in SaveInput) (*Layout, error) {
	// Validate structure (templates + known field keys) but SKIP the
	// compulsory-field gate — a draft may legitimately omit them.
	if verr := validateDocStructure(in.Doc, in.CustomFieldKeys, in.Slot, in.Scope); verr != nil {
		return nil, verr
	}

	in.Doc.Version = 0 // drafts are outside the published version sequence
	docJSON, err := json.Marshal(in.Doc)
	if err != nil {
		return nil, err
	}

	var createdBy any
	if in.CreatedBy != uuid.Nil {
		createdBy = in.CreatedBy
	}

	var draftID uuid.UUID
	err = s.vaPool.QueryRow(ctx, sqlUpsertDraft,
		in.TopologyNodeID, in.ArtefactTypeID, in.WorkspaceID,
		docJSON, createdBy).Scan(&draftID)
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, draftID)
}

// validateDocStructure enforces template integrity, known field keys, and
// the per-type-applicability gate (a core field may only be placed on a
// type it applies to — mirrors the slot-gate trigger). It does NOT enforce
// the compulsory-field gate, so it is shared by both the publish path
// (validateDoc, which layers the gate on top) and the draft path (which
// allows an incomplete document). Returns the set of placed field keys for
// the caller's gate check. slot is "" for strategy types.
func validateDocStructure(doc LayoutDoc, customKeys map[string]bool, slot, scope string) error {
	_, err := collectPlacedAndValidate(doc, customKeys, slot, scope)
	return err
}

func collectPlacedAndValidate(doc LayoutDoc, customKeys map[string]bool, slot, scope string) (map[string]bool, error) {
	placed := map[string]bool{}
	for _, row := range doc.Rows {
		spans, ok := templateSpans[row.Template]
		if !ok {
			return nil, &ValidationError{Err: ErrBadTemplate, Reason: fmt.Sprintf("unknown template %q", row.Template)}
		}
		if len(row.Cells) != len(spans) {
			return nil, &ValidationError{Err: ErrBadTemplate, Reason: fmt.Sprintf("template %q expects %d cells, got %d", row.Template, len(spans), len(row.Cells))}
		}
		for _, cell := range row.Cells {
			if cell.FieldKey == nil {
				continue // empty slot is fine
			}
			key := *cell.FieldKey
			if err := validateFieldKey(key, customKeys, slot, scope); err != nil {
				return nil, err
			}
			placed[key] = true
		}
	}
	return placed, nil
}

// validateDoc enforces template integrity, known field keys, the
// per-type-applicability gate (a core field may only be placed on a type it
// applies to — mirrors the slot-gate trigger), and the compulsory-field gate
// for BOTH core (CompulsoryFieldsForType) and custom (compulsoryCustom, from
// the per-binding is_compulsory marker). slot is "" for strategy types.
func validateDoc(doc LayoutDoc, customKeys, compulsoryCustom map[string]bool, slot, scope string) error {
	placed, err := collectPlacedAndValidate(doc, customKeys, slot, scope)
	if err != nil {
		return err
	}
	// SERVER IS THE GATE — the "Required fields" locked group. A saved layout
	// MUST place every compulsory core field for this artefact type. The
	// compulsory set is a SUPERSET of mandatoryCoreFieldKeys (title /
	// flow_state_name / owner are all in the universal compulsory set), so
	// this single check subsumes the old mandatory-only gate. We filter the
	// compulsory keys through skipFromBuilder so we never demand a field the
	// builder cannot even place (defence against rubric drift — the columns.go
	// rubric already drops those, but filtering here is belt-and-braces and
	// keeps the gate honest if the rubric regresses).
	//
	// mandatoryCoreFieldKeys / isMandatoryCore are intentionally kept alive —
	// IsMandatory is still surfaced to the client for the red-dot UX, distinct
	// from the broader compulsory locked group.
	compulsory := artefactitems.CompulsoryFieldsForType(slot, scope)
	var missingCompulsory []string
	for k := range compulsory {
		if skipFromBuilder(k) {
			continue
		}
		if !placed[k] {
			missingCompulsory = append(missingCompulsory, k)
		}
	}
	// Custom compulsory fields (per-binding is_compulsory, mig 167) are gated
	// the same way: every one must be placed. These keys are already validated
	// as bound to the type (collectPlacedAndValidate → validateFieldKey), so an
	// unplaced one is a genuine "you marked this required, place it" failure.
	for k := range compulsoryCustom {
		if !placed[k] {
			missingCompulsory = append(missingCompulsory, k)
		}
	}
	if len(missingCompulsory) > 0 {
		sort.Strings(missingCompulsory) // stable order for the wire detail + tests
		return &ValidationError{
			Err:     ErrMissingMandatory,
			Missing: missingCompulsory,
			Reason:  fmt.Sprintf("layout must place compulsory field(s): %v", missingCompulsory),
		}
	}
	return nil
}

func validateFieldKey(key string, customKeys map[string]bool, slot, scope string) error {
	if len(key) > 7 && key[:7] == "custom:" {
		if customKeys != nil && !customKeys[key] {
			return &ValidationError{Err: ErrUnknownField, Field: key, Reason: fmt.Sprintf("unknown custom field %q", key)}
		}
		return nil
	}
	spec, ok := artefactitems.CoreColumnSpecForName(key)
	if !ok {
		return &ValidationError{Err: ErrUnknownField, Field: key, Reason: fmt.Sprintf("unknown core field %q", key)}
	}
	// SERVER IS THE GATE: a core field may only be placed on a type it
	// applies to. Rejects e.g. defect_severity on a Story form — mirrors the
	// slot-gate trigger so the layout can never reference a field the DB
	// would refuse to store on that type.
	if !spec.AppliesToType(slot, scope) {
		return &ValidationError{Err: ErrUnknownField, Field: key, Reason: fmt.Sprintf("core field %q does not apply to this artefact type", key)}
	}
	return nil
}

// CoreFields returns the core-field descriptors for the builder sidebar,
// scoped to the artefact type identified by (slot, scope). Only columns
// that legitimately apply to the type are returned — a Defect never sees
// strategic/risk columns, an Epic never sees Steps-to-Reproduce. The
// per-type filter (artefactitems.CoreColumnsForType) mirrors the live
// slot-gate trigger (migs 158 + 162); see columns.go ColumnSpec.Family.
// Custom fields bound to the type are appended by the handler (it owns the
// catalogue join).
//
// slot is "" for strategy types (they are scope-gated, not slot-gated).
func (s *Service) CoreFields(slot, scope string) []CoreFieldDescriptor {
	cols := artefactitems.CoreColumnsForType(slot, scope)
	compulsory := artefactitems.CompulsoryFieldsForType(slot, scope)
	out := make([]CoreFieldDescriptor, 0, len(cols))
	for _, c := range cols {
		// Skip pure-audit / id-internal columns the builder shouldn't offer.
		if skipFromBuilder(c.Name) {
			continue
		}
		out = append(out, CoreFieldDescriptor{
			FieldKey:      c.Name,
			Label:         labelOr(c.Label, c.Name),
			DataType:      inferDataType(c.Name),
			Kind:          "core",
			Group:         c.Group,
			IsMandatory:   isMandatoryCore(c.Name),
			IsCompulsory:  compulsory[c.Name],
			ValueLocation: ValueLocationCore,
		})
	}
	return out
}

// CustomFields returns the custom-field descriptors bound to an artefact
// type (for the builder sidebar's Custom section), the valid-key set used by
// Save's validation, and the compulsory subset (per-binding is_compulsory,
// mig 167) the publish gate requires be placed. FieldKey is
// "custom:<library_id>".
func (s *Service) CustomFields(ctx context.Context, typeID, subscriptionID uuid.UUID) ([]CoreFieldDescriptor, map[string]bool, map[string]bool, error) {
	// Phase 4 Task 5: custom fields now read from the unified 3-layer field
	// model (vector_fields_context ⋈ vector_fields_library) via the
	// vectorfields reader, replacing the legacy sqlListCustomFieldsForType
	// query against artefacts_types_fields/artefacts_fields_library. The
	// reader already filters vector_fields_library_archived_at IS NULL and
	// orders by position then name — the return triple shape is unchanged so
	// handlers and the save validator are untouched.
	entries, err := s.vf.ContextForType(ctx, subscriptionID, "artefact", typeID)
	if err != nil {
		return nil, nil, nil, err
	}

	var out []CoreFieldDescriptor
	keys := map[string]bool{}
	compulsory := map[string]bool{}
	for _, e := range entries {
		keys[e.FieldKey] = true
		if e.IsCompulsory {
			compulsory[e.FieldKey] = true
		}
		out = append(out, CoreFieldDescriptor{
			FieldKey: e.FieldKey,
			Label:    e.Label,
			// vector_fields_library_type was backfilled verbatim from
			// artefacts_fields_library_field_type, so apply the SAME
			// customDataType mapping the legacy path applied for exact parity.
			DataType:    customDataType(e.DataType),
			Kind:        "custom",
			Group:       "Custom",
			IsMandatory: false,
			// Per-binding compulsory marker (mig 167). Drives the locked-group
			// save gate for custom fields, mirroring the core compulsory set.
			IsCompulsory:  e.IsCompulsory,
			ValueLocation: e.ValueLocation,
		})
	}
	return out, keys, compulsory, nil
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
//
// parent_id and topology_node_id are deliberately NOT skipped: they carry
// user-facing labels ("Parent", "Topology Node") in the column catalogue
// and are Addable display fields a padmin legitimately places on a form.
// They render as reference pickers, not raw UUIDs. (Earlier they were
// swept into this list with the genuinely-internal FK/audit columns,
// which hid them from the builder sidebar.)
func skipFromBuilder(name string) bool {
	switch name {
	case "id", "subscription_id", "created_at", "updated_at", "archived_at",
		"artefact_type_id", "flow_state_id", "priority_id", "sprint_id",
		"milestone_id", "owner_id", "root_feature_id",
		"type_prefix", "submitted_by_user_id",
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
		"owner", "parent_id", "topology_node_id":
		return "select"
	default:
		return "textbox"
	}
}
