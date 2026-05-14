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
	"github.com/mmffdev/vector-backend/internal/messages"
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
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}
	if err := h.Svc.AssertCallerMayRead(r.Context(), wsID, u); err != nil {
		switch {
		case errors.Is(err, ErrWorkspaceNotFound):
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		case errors.Is(err, ErrForbidden):
			httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}
	if !h.Svc.HasArtefactsPool() {
		writeJSON(w, http.StatusOK, listResponse{WorkspaceID: wsID, Fields: []fieldRowOut{}})
		return
	}
	rows, err := h.Svc.LoadAdmittedFields(r.Context(), wsID, u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
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
