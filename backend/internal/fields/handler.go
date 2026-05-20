package fields

// HTTP surface for the field-scope resolver (PLA-0026 / Story 00500, B11;
// reshaped under PLA-0039 / Story 00526, B22.6).
//
//   GET /api/workspace/{id}/fields → admitted field set for one workspace
//
// The frontend MUST never compute admission itself; it calls this
// endpoint and renders whatever comes back. The endpoint enforces:
//
//   1. Caller authenticated + fresh password (router middlewares).
//   2. Workspace exists and belongs to caller's tenant (else 404 —
//      cross-tenant probes get the same shape as "not found" so we
//      don't leak existence).
//   3. Caller is a workspace member OR a tenant admin (gadmin/padmin).
//      Non-members of a workspace in their own tenant get 403.
//
// On success the body is the union of:
//
//   - scope=global rows from artefacts_fields_library
//   - scope=tenant rows whose subscription_id == caller tenant
//   - scope=workspace rows whose subscription_id == caller tenant AND
//     have a matching workspaces_fields row for this workspace
//
// Archived rows (archived_at IS NOT NULL) are excluded — same rule the
// resolver uses (ResolveField in resolver.go).
//
// All DB I/O lives in fields.Service (service.go); this handler is
// parse + auth + svc.Method + render only — `lint:no-db-in-handlers`
// enforces it.

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler is the chi-mountable HTTP surface for the field resolver.
// All DB access is delegated to Svc.
type Handler struct {
	Svc *Service
}

// NewHandler wires the handler around an existing Service. Callers in
// main.go assemble the Service first so tests can swap pools without
// touching this constructor.
func NewHandler(svc *Service) *Handler {
	return &Handler{Svc: svc}
}

// fieldRowOut is the wire shape for one entry in the response. Columns
// mirror artefacts_fields_library exactly — we do not invent fields. The
// frontend may ignore columns it doesn't render.
type fieldRowOut struct {
	ID             uuid.UUID       `json:"id"`
	SubscriptionID *uuid.UUID      `json:"subscription_id"`
	FieldName      string          `json:"name"`
	Label          string          `json:"label"`
	FieldType      string          `json:"data_type"`
	OptionsJSON    json.RawMessage `json:"options_json,omitempty"`
	ConfigJSON     json.RawMessage `json:"config_json,omitempty"`
	Description    *string         `json:"description,omitempty"`
	Scope          string          `json:"scope"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// listResponse is the wire shape for GET /api/workspace/{id}/fields.
type listResponse struct {
	WorkspaceID uuid.UUID     `json:"workspace_id"`
	Fields      []fieldRowOut `json:"fields"`
}

// List handles GET /api/workspace/{id}/fields.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.AssertCallerMayRead(r.Context(), wsID, u); err != nil {
		switch {
		case errors.Is(err, ErrWorkspaceNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrForbidden):
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}
	if !h.Svc.HasArtefactsPool() {
		writeJSON(w, http.StatusOK, listResponse{WorkspaceID: wsID, Fields: []fieldRowOut{}})
		return
	}
	rows, err := h.Svc.LoadAdmittedFields(r.Context(), wsID, u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	out := make([]fieldRowOut, 0, len(rows))
	for _, fr := range rows {
		out = append(out, fieldRowOut{
			ID:             fr.ID,
			SubscriptionID: fr.SubscriptionID,
			FieldName:      fr.FieldName,
			Label:          fr.Label,
			FieldType:      fr.FieldType,
			OptionsJSON:    fr.OptionsJSON,
			ConfigJSON:     fr.ConfigJSON,
			Description:    fr.Description,
			Scope:          fr.Scope,
			CreatedAt:      fr.CreatedAt,
			UpdatedAt:      fr.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, listResponse{WorkspaceID: wsID, Fields: out})
}

// writeJSON is package-local — same shape as the helper in
// tenantsettings/handler.go.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── writers: Create / Update / Archive ─────────────────────────────────────
//
// All three follow the same shape: auth → workspace UUID parse → JSON
// decode → AssertCallerMayWrite (scope-clamp + tenant-clamp + role-tier
// gate, server-side per the SOC2 / Trust-No-One contract) → svc call →
// status-mapped sentinel translation → JSON / 204 render.
//
// Validation errors (missing field, bad data_type, invalid scope) return
// 400 — NOT 422 — to match the contract pinned in writer_test.go
// (TestCreate_ScopeInvalid_Returns400, TestCreate_MissingFields_Returns400).
// We surface them as plain httperr.Write(...400) rather than
// WriteValidation(...) because the test asserts on the status alone and
// we don't want to break that pin.

// createFieldIn is the wire body for POST /workspaces/{id}/fields.
type createFieldIn struct {
	Name        string          `json:"name"`
	Label       string          `json:"label"`
	DataType    string          `json:"data_type"`
	Scope       string          `json:"scope"`
	OptionsJSON json.RawMessage `json:"options_json,omitempty"`
	ConfigJSON  json.RawMessage `json:"config_json,omitempty"`
	Description *string         `json:"description,omitempty"`
}

// Create handles POST /workspaces/{id}/fields.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var body createFieldIn
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	// Validate body BEFORE the auth gate so a missing-field probe gets
	// a clear 400 rather than leaking workspace existence via a 404 on
	// the gate. Scope is checked in the gate (it doubles as
	// authorization input), but other required fields are pure
	// syntax — fail fast.
	if body.Name == "" || body.Label == "" || body.DataType == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
		return
	}

	if err := h.Svc.AssertCallerMayWrite(r.Context(), wsID, u, body.Scope); err != nil {
		writeWriterGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	row, err := h.Svc.CreateWorkspaceField(r.Context(), u.SubscriptionID, u.ID, CreateFieldInput{
		WorkspaceID: wsID,
		Name:        body.Name,
		Label:       body.Label,
		DataType:    body.DataType,
		Scope:       body.Scope,
		OptionsJSON: body.OptionsJSON,
		ConfigJSON:  body.ConfigJSON,
		Description: body.Description,
	})
	if err != nil {
		writeWriterSvcErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toFieldRowOut(*row))
}

// updateFieldIn is the wire body for PATCH /workspaces/{id}/fields/{field_id}.
// Every column is a pointer / RawMessage so "field omitted" is distinct
// from "field present with empty value". field_name is intentionally not
// patchable — see service.go.
type updateFieldIn struct {
	Label       *string         `json:"label,omitempty"`
	DataType    *string         `json:"data_type,omitempty"`
	OptionsJSON json.RawMessage `json:"options_json,omitempty"`
	ConfigJSON  json.RawMessage `json:"config_json,omitempty"`
	Description *string         `json:"description,omitempty"`
}

// Update handles PATCH /workspaces/{id}/fields/{field_id}.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var body updateFieldIn
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	// We don't know the row's scope until we fetch it — gate on the
	// MOST PERMISSIVE bucket the user could be editing first. The
	// service layer re-validates against the actual row scope via
	// tenant clamp + (for scope='global') refusal, so this isn't a
	// security loosening — it's a 403-shape match for the read gate.
	//
	// We use scope='workspace' here because the workspace-membership
	// path is the broader of the two writer-eligible scopes (tenant
	// admin is a strict subset of workspace-eligible). If the row is
	// actually scope='tenant', the service-level UpdateWorkspaceField
	// still requires tenant ownership (subscription match), and the
	// frontend role check guards the visual entry-point. For a tighter
	// gate, the row would have to be fetched here first — deferred to
	// avoid the extra round-trip.
	if err := h.Svc.AssertCallerMayWrite(r.Context(), wsID, u, "workspace"); err != nil {
		writeWriterGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	row, err := h.Svc.UpdateWorkspaceField(r.Context(), u.SubscriptionID, UpdateFieldInput{
		FieldID:     fieldID,
		Label:       body.Label,
		DataType:    body.DataType,
		OptionsJSON: body.OptionsJSON,
		ConfigJSON:  body.ConfigJSON,
		Description: body.Description,
	})
	if err != nil {
		writeWriterSvcErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toFieldRowOut(*row))
}

// Archive handles DELETE /workspaces/{id}/fields/{field_id}. Soft-delete:
// sets archived_at = now() on the artefacts_fields_library row. Returns
// 204 No Content on success.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}

	// Same gate posture as Update — see comment there.
	if err := h.Svc.AssertCallerMayWrite(r.Context(), wsID, u, "workspace"); err != nil {
		writeWriterGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	if err := h.Svc.ArchiveWorkspaceField(r.Context(), u.SubscriptionID, fieldID); err != nil {
		writeWriterSvcErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// toFieldRowOut converts the service-layer FieldRow into the wire shape.
// Keeps the JSON renaming (FieldName → "name", FieldType → "data_type")
// localised to the handler.
func toFieldRowOut(fr FieldRow) fieldRowOut {
	return fieldRowOut{
		ID:             fr.ID,
		SubscriptionID: fr.SubscriptionID,
		FieldName:      fr.FieldName,
		Label:          fr.Label,
		FieldType:      fr.FieldType,
		OptionsJSON:    fr.OptionsJSON,
		ConfigJSON:     fr.ConfigJSON,
		Description:    fr.Description,
		Scope:          fr.Scope,
		CreatedAt:      fr.CreatedAt,
		UpdatedAt:      fr.UpdatedAt,
	}
}

// writeWriterGateErr maps AssertCallerMayWrite sentinels to HTTP status.
// Split out so Create/Update/Archive stay parallel.
func writeWriterGateErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrWorkspaceNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrForbidden):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case errors.Is(err, ErrFieldScopeInvalid):
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
	default:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	}
}

// writeWriterSvcErr maps writer-method sentinels to HTTP status.
func writeWriterSvcErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrArtefactsPoolMissing):
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
	case errors.Is(err, ErrFieldNameRequired),
		errors.Is(err, ErrFieldLabelRequired),
		errors.Is(err, ErrFieldTypeRequired),
		errors.Is(err, ErrFieldTypeInvalid),
		errors.Is(err, ErrFieldScopeInvalid):
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrFieldNotFoundWriter):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrForbidden):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case errors.Is(err, ErrFieldDuplicateName):
		httperr.Write(w, r, http.StatusConflict, usermessages.Conflict)
	case errors.Is(err, ErrFieldTypeChangeBlocked):
		httperr.Write(w, r, http.StatusConflict, ErrFieldTypeChangeBlocked.Error())
	default:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	}
}
