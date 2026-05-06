package workitems

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
)

// Handler exposes the work items domain over HTTP.
type Handler struct {
	Svc *Service
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// ─── Work Items ───────────────────────────────────────────────────────────────

// GET /api/work-items
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	q := r.URL.Query()

	f := ListWorkItemsFilter{Limit: 50}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Limit = n // service caps at 200
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			f.Offset = n
		}
	}
	if v := q.Get("parent_id"); v != "" {
		f.ParentID = &v
	}
	if v := q.Get("item_type"); v != "" {
		f.ItemType = &v
	}
	if v := q.Get("status"); v != "" {
		f.Status = &v
	}
	if v := q.Get("priority"); v != "" {
		f.Priority = &v
	}
	if v := q.Get("sprint_id"); v != "" {
		f.SprintID = &v
	}
	if v := q.Get("sort"); v != "" {
		f.Sort = v
	}
	if v := q.Get("dir"); v != "" {
		f.Dir = v
	}

	items, err := h.Svc.ListWorkItems(r.Context(), u.SubscriptionID.String(), f)
	if err != nil {
		log.Printf("ListWorkItems error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	total, err := h.Svc.CountWorkItems(r.Context(), u.SubscriptionID.String(), f)
	if err != nil {
		log.Printf("CountWorkItems error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// GET /api/work-items/summary
//
// Returns full-subscription counts for the Page Summary Header strip.
// Optional ?sprint_id=<uuid> narrows the count window. item_type filters
// are NOT applied here so the strip always shows the whole-tree shape
// regardless of any list filter the user has set.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	q := r.URL.Query()
	var sprintID *string
	if v := q.Get("sprint_id"); v != "" {
		sprintID = &v
	}
	out, err := h.Svc.SummariseWorkItems(r.Context(), u.SubscriptionID.String(), sprintID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/work-items/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	wi, err := h.Svc.GetWorkItem(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, wi)
}

// GET /api/work-items/{id}/children
func (h *Handler) ListChildren(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	items, err := h.Svc.ListChildren(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createWorkItemReq struct {
	ItemType    string  `json:"item_type"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	StoryPoints *int    `json:"story_points,omitempty"`
	SprintID    *string `json:"sprint_id,omitempty"`
	ParentID    *string `json:"parent_id,omitempty"`
}

// POST /api/work-items
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	wi, err := h.Svc.CreateWorkItem(r.Context(), u.SubscriptionID.String(), CreateWorkItemInput{
		ItemType:    req.ItemType,
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		Priority:    req.Priority,
		StoryPoints: req.StoryPoints,
		SprintID:    req.SprintID,
		ParentID:    req.ParentID,
		OwnerID:     u.ID.String(),
		CreatedBy:   u.ID.String(),
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, wi)
}

type patchWorkItemReq struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty"`
	FlowStateID *string `json:"flow_state_id,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	StoryPoints *int    `json:"story_points,omitempty"`
	SprintID    *string `json:"sprint_id,omitempty"`
}

// PATCH /api/work-items/{id}
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req patchWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	wi, err := h.Svc.PatchWorkItem(r.Context(), u.SubscriptionID.String(), id, PatchWorkItemInput{
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		FlowStateID: req.FlowStateID,
		Priority:    req.Priority,
		StoryPoints: req.StoryPoints,
		SprintID:    req.SprintID,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, "not found")
		case errors.Is(err, ErrInvalidInput):
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, wi)
}

// DELETE /api/work-items/{id}
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.ArchiveWorkItem(r.Context(), u.SubscriptionID.String(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Field Values ─────────────────────────────────────────────────────────────

// GET /api/work-items/{id}/field-values
func (h *Handler) ListFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	fvs, err := h.Svc.ListFieldValues(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"field_values": fvs})
}

type upsertFieldValueReq struct {
	FieldLibraryID string  `json:"field_library_id"`
	StringValue    *string `json:"string_value,omitempty"`
	NumberValue    *string `json:"number_value,omitempty"`
	TextValue      *string `json:"text_value,omitempty"`
	DateValue      *string `json:"date_value,omitempty"`
}

// PUT /api/work-items/{id}/field-values
func (h *Handler) UpsertFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var reqs []upsertFieldValueReq
	if err := json.NewDecoder(r.Body).Decode(&reqs); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	subID := u.SubscriptionID.String()
	for _, req := range reqs {
		err := h.Svc.UpsertFieldValue(r.Context(), subID, id, UpsertFieldValueInput{
			FieldLibraryID: req.FieldLibraryID,
			StringValue:    req.StringValue,
			NumberValue:    req.NumberValue,
			TextValue:      req.TextValue,
			DateValue:      req.DateValue,
		})
		if err != nil {
			switch {
			case errors.Is(err, ErrNotFound), errors.Is(err, ErrFieldNotFound):
				httperr.Write(w, r, http.StatusNotFound, err.Error())
			case errors.Is(err, ErrWrongValueColumn), errors.Is(err, ErrInvalidInput):
				httperr.Write(w, r, http.StatusBadRequest, err.Error())
			default:
				httperr.Write(w, r, http.StatusInternalServerError, "internal error")
			}
			return
		}
	}
	fvs, err := h.Svc.ListFieldValues(r.Context(), subID, id)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"field_values": fvs})
}

// DELETE /api/work-items/{id}/field-values/{field_library_id}
func (h *Handler) DeleteFieldValue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	fvID, err := uuid.Parse(chi.URLParam(r, "field_library_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid field_library_id")
		return
	}
	if err := h.Svc.DeleteFieldValue(r.Context(), u.SubscriptionID.String(), id, fvID); err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrFieldNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Sprints ─────────────────────────────────────────────────────────────────

// GET /api/sprints
func (h *Handler) ListSprints(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	sprints, err := h.Svc.ListSprints(r.Context(), u.SubscriptionID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": sprints})
}

// GET /api/sprints/{id}
func (h *Handler) GetSprint(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	sp, err := h.Svc.GetSprint(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		if errors.Is(err, ErrSprintNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

type createSprintReq struct {
	Name      string  `json:"name"`
	Goal      *string `json:"goal,omitempty"`
	StartDate *string `json:"start_date,omitempty"`
	EndDate   *string `json:"end_date,omitempty"`
}

// POST /api/sprints
func (h *Handler) CreateSprint(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createSprintReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	sp, err := h.Svc.CreateSprint(r.Context(), u.SubscriptionID.String(), CreateSprintInput{
		Name:      req.Name,
		Goal:      req.Goal,
		StartDate: req.StartDate,
		EndDate:   req.EndDate,
		CreatedBy: u.ID.String(),
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, sp)
}

type patchSprintReq struct {
	Name      *string `json:"name,omitempty"`
	Goal      *string `json:"goal,omitempty"`
	StartDate *string `json:"start_date,omitempty"`
	EndDate   *string `json:"end_date,omitempty"`
	Status    *string `json:"status,omitempty"`
}

// PATCH /api/sprints/{id}
func (h *Handler) PatchSprint(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req patchSprintReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	sp, err := h.Svc.PatchSprint(r.Context(), u.SubscriptionID.String(), id, PatchSprintInput{
		Name:      req.Name,
		Goal:      req.Goal,
		StartDate: req.StartDate,
		EndDate:   req.EndDate,
		Status:    req.Status,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrSprintNotFound):
			httperr.Write(w, r, http.StatusNotFound, "not found")
		case errors.Is(err, ErrConflict):
			httperr.Write(w, r, http.StatusConflict, err.Error())
		case errors.Is(err, ErrInvalidInput):
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

// DELETE /api/sprints/{id}
func (h *Handler) ArchiveSprint(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.ArchiveSprint(r.Context(), u.SubscriptionID.String(), id); err != nil {
		if errors.Is(err, ErrSprintNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Custom Field Library ─────────────────────────────────────────────────────

// GET /api/custom-field-library
func (h *Handler) ListCustomFields(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	fields, err := h.Svc.ListCustomFields(r.Context(), u.SubscriptionID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": fields})
}

// GET /api/custom-field-library/{id}
func (h *Handler) GetCustomField(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	cf, err := h.Svc.GetCustomField(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		if errors.Is(err, ErrFieldNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, cf)
}

type createCustomFieldReq struct {
	FieldName   string  `json:"field_name"`
	Label       string  `json:"label"`
	Type        string  `json:"type"`
	OptionsJSON *string `json:"options_json,omitempty"`
	ConfigJSON  *string `json:"config_json,omitempty"`
}

// POST /api/custom-field-library
func (h *Handler) CreateCustomField(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createCustomFieldReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	cf, err := h.Svc.CreateCustomField(r.Context(), u.SubscriptionID.String(), CreateCustomFieldInput{
		FieldName:   req.FieldName,
		Label:       req.Label,
		Type:        req.Type,
		OptionsJSON: req.OptionsJSON,
		ConfigJSON:  req.ConfigJSON,
		CreatedBy:   u.ID.String(),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrConflict):
			httperr.Write(w, r, http.StatusConflict, err.Error())
		case errors.Is(err, ErrInvalidInput):
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusCreated, cf)
}

type patchCustomFieldReq struct {
	Label       *string `json:"label,omitempty"`
	OptionsJSON *string `json:"options_json,omitempty"`
	ConfigJSON  *string `json:"config_json,omitempty"`
}

// PATCH /api/custom-field-library/{id}
func (h *Handler) PatchCustomField(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req patchCustomFieldReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	cf, err := h.Svc.PatchCustomField(r.Context(), u.SubscriptionID.String(), id, PatchCustomFieldInput{
		Label:       req.Label,
		OptionsJSON: req.OptionsJSON,
		ConfigJSON:  req.ConfigJSON,
	})
	if err != nil {
		if errors.Is(err, ErrFieldNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, cf)
}

// DELETE /api/custom-field-library/{id}
func (h *Handler) ArchiveCustomField(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.ArchiveCustomField(r.Context(), u.SubscriptionID.String(), id); err != nil {
		if errors.Is(err, ErrFieldNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Templates ───────────────────────────────────────────────────────────────

// GET /api/work-item-templates
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	templates, err := h.Svc.ListTemplates(r.Context(), u.SubscriptionID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": templates})
}

// GET /api/work-item-templates/{id}
func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	t, err := h.Svc.GetTemplate(r.Context(), u.SubscriptionID.String(), id)
	if err != nil {
		if errors.Is(err, ErrTemplateNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type createTemplateReq struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	ItemType    *string `json:"item_type,omitempty"`
}

// POST /api/work-item-templates
func (h *Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createTemplateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	t, err := h.Svc.CreateTemplate(r.Context(), u.SubscriptionID.String(), CreateTemplateInput{
		Name:        req.Name,
		Description: req.Description,
		ItemType:    req.ItemType,
		CreatedBy:   u.ID.String(),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrConflict):
			httperr.Write(w, r, http.StatusConflict, err.Error())
		case errors.Is(err, ErrInvalidInput):
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

type addTemplateFieldReq struct {
	FieldLibraryID string  `json:"field_library_id"`
	Position       int     `json:"position"`
	Required       bool    `json:"required"`
	DefaultValue   *string `json:"default_value,omitempty"`
}

// POST /api/work-item-templates/{id}/fields
func (h *Handler) AddTemplateField(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req addTemplateFieldReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	tf, err := h.Svc.AddTemplateField(r.Context(), id, AddTemplateFieldInput{
		FieldLibraryID: req.FieldLibraryID,
		Position:       req.Position,
		Required:       req.Required,
		DefaultValue:   req.DefaultValue,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			httperr.Write(w, r, http.StatusConflict, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, tf)
}

// DELETE /api/work-item-templates/{id}/fields/{field_library_id}
func (h *Handler) RemoveTemplateField(w http.ResponseWriter, r *http.Request) {
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_library_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid field_library_id")
		return
	}
	if err := h.Svc.RemoveTemplateField(r.Context(), fieldID); err != nil {
		if errors.Is(err, ErrFieldNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/work-items/flow-states
//
// Returns the ordered flow states for the execution_work_items flow of the
// caller's subscription. Any authenticated user may call this — no flows.manage
// permission required — so the Status dropdown on the work items page can
// populate itself from live DB values rather than hardcoded strings.
func (h *Handler) ListFlowStates(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	states, err := h.Svc.ListFlowStates(r.Context(), u.SubscriptionID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"states": states})
}

// ─── Utility ─────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
