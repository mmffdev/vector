// HTTP surface for the Form Layout Builder (2026-05-30 — see
// docs/superpowers/specs/2026-05-30-form-layout-builder-design.md).
//
//	GET  /_site/api/form-layouts?node={id}&type={id} → current layout, or 404
//	GET  /_site/api/form-layouts/{layoutId}          → one version row
//	POST /_site/api/form-layouts                      → upsert (version flip)
//	GET  /_site/api/form-layouts/core-fields?type={id}→ sidebar field catalogue
//
// SERVER IS THE GATE: identity/tenant/scope come from the sentinel clamp
// (sentinel.FromCtx), never from the request body. The POST path resolves
// the saving user's workspace + subscription from the clamp and rejects a
// layout that omits any mandatory core field or references an unknown
// field key. All DB I/O lives in Service (service.go / sql.go); this
// handler is parse + clamp + svc.Method + render only.
package formlayouts

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler is the chi-mountable HTTP surface. All DB access is delegated
// to Svc.
type Handler struct {
	Svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{Svc: svc} }

// Routes returns the sub-router mounted at /_site/api/form-layouts.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.getCurrent)
	r.Post("/", h.save)
	r.Get("/core-fields", h.coreFields)
	r.Get("/{layoutId}", h.getByID)
	return r
}

// GET /?node={id}&type={id}
func (h *Handler) getCurrent(w http.ResponseWriter, r *http.Request) {
	nodeID, err := uuid.Parse(r.URL.Query().Get("node"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	typeID, err := uuid.Parse(r.URL.Query().Get("type"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	layout, err := h.Svc.GetCurrent(r.Context(), nodeID, typeID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

// GET /{layoutId}
func (h *Handler) getByID(w http.ResponseWriter, r *http.Request) {
	layoutID, err := uuid.Parse(chi.URLParam(r, "layoutId"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	layout, err := h.Svc.GetByID(r.Context(), layoutID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, layout)
}

// saveRequest is the POST body. Identity/tenant/workspace are NOT taken
// from the body — they come from the sentinel clamp.
type saveRequest struct {
	NodeID         string `json:"nodeId"`
	ArtefactTypeID string `json:"artefactTypeId"`
	Rows           []Row  `json:"rows"`
}

// POST /
func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.WorkspaceID == uuid.Nil || clamp.TenantID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}

	var req saveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	nodeID, err := uuid.Parse(req.NodeID)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	typeID, err := uuid.Parse(req.ArtefactTypeID)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}

	// Resolve the valid custom-field key set for this type so the save
	// validator can reject references to fields not bound to the type.
	_, customKeys, err := h.Svc.CustomFields(r.Context(), typeID, clamp.TenantID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	// Resolve the type's slot + scope so the save validator can reject any
	// core field placed on a type it does not apply to (per-type gate).
	slot, scope, err := h.Svc.TypeSlotScope(r.Context(), typeID, clamp.TenantID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	layout, err := h.Svc.Save(r.Context(), SaveInput{
		WorkspaceID:     clamp.WorkspaceID,
		TopologyNodeID:  nodeID,
		ArtefactTypeID:  typeID,
		CreatedBy:       clamp.UserID,
		Doc:             LayoutDoc{ArtefactTypeID: req.ArtefactTypeID, Rows: req.Rows},
		CustomFieldKeys: customKeys,
		Slot:            slot,
		Scope:           scope,
	})

	var verr *ValidationError
	if errors.As(err, &verr) {
		// SERVER IS THE GATE: structured 422 so the client can surface the
		// reason ("page won't save without these core fields").
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":   verr.Reason,
			"missing": verr.Missing,
			"field":   verr.Field,
		})
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusCreated, layout)
}

// coreFieldsResponse is the sidebar catalogue: core (must-have first) +
// custom fields bound to the type.
type coreFieldsResponse struct {
	Fields []CoreFieldDescriptor `json:"fields"`
}

// GET /core-fields?type={id}
func (h *Handler) coreFields(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.TenantID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}
	typeID, err := uuid.Parse(r.URL.Query().Get("type"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}

	// Resolve the type's slot + scope so the sidebar only offers core fields
	// that legitimately apply to the type (per-type gate, mirrors the trigger).
	slot, scope, err := h.Svc.TypeSlotScope(r.Context(), typeID, clamp.TenantID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	fields := h.Svc.CoreFields(slot, scope)
	custom, _, err := h.Svc.CustomFields(r.Context(), typeID, clamp.TenantID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	fields = append(fields, custom...)
	writeJSON(w, http.StatusOK, coreFieldsResponse{Fields: fields})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
