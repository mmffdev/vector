package artefacts

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
)

// Handler exposes all artefact routes. Routes are mounted under
// /api/artefacts/{type} in main.go.
type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func artefactType(r *http.Request) string { return chi.URLParam(r, "type") }

// ── Core CRUD ─────────────────────────────────────────────────────────

// POST /api/artefacts/{type}
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req struct {
		Title       string  `json:"title"`
		Description *string `json:"description,omitempty"`
		OwnerID     string  `json:"owner_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" || req.OwnerID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "title and owner_id are required")
		return
	}
	a, err := h.Svc.Create(r.Context(), artefactType(r), u.SubscriptionID, u.ID, CreateInput{
		Title:       req.Title,
		Description: req.Description,
		OwnerID:     req.OwnerID,
	})
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

// GET /api/artefacts/{type}/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	a, err := h.Svc.Get(r.Context(), artefactType(r), u.SubscriptionID, id)
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// PATCH /api/artefacts/{type}/{id}
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req struct {
		Title       *string `json:"title,omitempty"`
		Description *string `json:"description,omitempty"`
		OwnerID     *string `json:"owner_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	a, err := h.Svc.Patch(r.Context(), artefactType(r), u.SubscriptionID, id, PatchInput{
		Title:       req.Title,
		Description: req.Description,
		OwnerID:     req.OwnerID,
	})
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// DELETE /api/artefacts/{type}/{id}
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.Archive(r.Context(), artefactType(r), u.SubscriptionID, id); err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "archived"})
}

// ── Schema management (padmin only — enforced in router) ──────────────

// GET /api/artefacts/{type}/schema
func (h *Handler) ListSchema(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	fields, err := h.Svc.ListSchema(r.Context(), artefactType(r), u.SubscriptionID)
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	if fields == nil {
		fields = []SchemaField{}
	}
	writeJSON(w, http.StatusOK, fields)
}

// POST /api/artefacts/{type}/schema
func (h *Handler) CreateSchema(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req struct {
		FieldName    string  `json:"field_name"`
		Label        string  `json:"label"`
		Type         string  `json:"type"`
		Required     bool    `json:"required"`
		Position     int     `json:"position"`
		DefaultValue *string `json:"default_value,omitempty"`
		OptionsJSON  *string `json:"options_json,omitempty"`
		ConfigJSON   *string `json:"config_json,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.FieldName == "" || req.Label == "" || req.Type == "" {
		httperr.Write(w, r, http.StatusBadRequest, "field_name, label, and type are required")
		return
	}
	f, err := h.Svc.CreateSchema(r.Context(), artefactType(r), u.SubscriptionID, CreateSchemaInput{
		FieldName:    req.FieldName,
		Label:        req.Label,
		Type:         req.Type,
		Required:     req.Required,
		Position:     req.Position,
		DefaultValue: req.DefaultValue,
		OptionsJSON:  req.OptionsJSON,
		ConfigJSON:   req.ConfigJSON,
	})
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// PATCH /api/artefacts/{type}/schema/{schema_id}
func (h *Handler) PatchSchema(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "schema_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid schema_id")
		return
	}
	var req struct {
		Label        *string `json:"label,omitempty"`
		Required     *bool   `json:"required,omitempty"`
		Position     *int    `json:"position,omitempty"`
		DefaultValue *string `json:"default_value,omitempty"`
		OptionsJSON  *string `json:"options_json,omitempty"`
		ConfigJSON   *string `json:"config_json,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	f, err := h.Svc.PatchSchema(r.Context(), artefactType(r), u.SubscriptionID, id, PatchSchemaInput{
		Label:        req.Label,
		Required:     req.Required,
		Position:     req.Position,
		DefaultValue: req.DefaultValue,
		OptionsJSON:  req.OptionsJSON,
		ConfigJSON:   req.ConfigJSON,
	})
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// DELETE /api/artefacts/{type}/schema/{schema_id}
func (h *Handler) ArchiveSchema(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "schema_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid schema_id")
		return
	}
	if err := h.Svc.ArchiveSchema(r.Context(), artefactType(r), u.SubscriptionID, id); err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "archived"})
}

// ── Field values ──────────────────────────────────────────────────────

// GET /api/artefacts/{type}/{id}/fields
func (h *Handler) ListFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	vals, err := h.Svc.ListFieldValues(r.Context(), artefactType(r), u.SubscriptionID, id)
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	if vals == nil {
		vals = []FieldValue{}
	}
	writeJSON(w, http.StatusOK, vals)
}

// PUT /api/artefacts/{type}/{id}/fields/{field_name}
func (h *Handler) WriteFieldValue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	fieldName := chi.URLParam(r, "field_name")
	if fieldName == "" {
		httperr.Write(w, r, http.StatusBadRequest, "field_name required")
		return
	}
	var req struct {
		StringValue *string `json:"string_value,omitempty"`
		NumberValue *string `json:"number_value,omitempty"`
		TextValue   *string `json:"text_value,omitempty"`
		DateValue   *string `json:"date_value,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	fv, err := h.Svc.WriteFieldValue(r.Context(), artefactType(r), u.SubscriptionID, id, fieldName, WriteFieldInput{
		StringValue: req.StringValue,
		NumberValue: req.NumberValue,
		TextValue:   req.TextValue,
		DateValue:   req.DateValue,
	}, u.ID)
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, fv)
}

// POST /api/artefacts/{type}/{id}/fields/bulk
func (h *Handler) BulkWriteFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req map[string]struct {
		StringValue *string `json:"string_value,omitempty"`
		NumberValue *string `json:"number_value,omitempty"`
		TextValue   *string `json:"text_value,omitempty"`
		DateValue   *string `json:"date_value,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	inputs := make(map[string]WriteFieldInput, len(req))
	for k, v := range req {
		inputs[k] = WriteFieldInput{
			StringValue: v.StringValue,
			NumberValue: v.NumberValue,
			TextValue:   v.TextValue,
			DateValue:   v.DateValue,
		}
	}
	results, err := h.Svc.BulkWriteFieldValues(r.Context(), artefactType(r), u.SubscriptionID, id, inputs, u.ID)
	if err != nil {
		h.handleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, results)
}

// ── Error mapping ─────────────────────────────────────────────────────

func (h *Handler) handleErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrSchemaNotFound):
		httperr.Write(w, r, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrInvalidType), errors.Is(err, ErrInvalidKind):
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrTypeConflict):
		httperr.Write(w, r, http.StatusConflict, err.Error())
	default:
		if err.Error() == "title cannot be empty" || err.Error() == "invalid owner_id" ||
			err.Error() == "field_name cannot be empty" || err.Error() == "invalid artefact type" {
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
	}
}
