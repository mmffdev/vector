package artefactitems

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// jsonErrBody safely marshals an error message into a {"error":"..."} JSON body.
func jsonErrBody(err error) []byte {
	msg, _ := json.Marshal(err.Error())
	return append([]byte(`{"error":`), append(msg, '}')...)
}

// Handler exposes the v2 work-items domain over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
// svc may wrap a nil pool; List returns an empty page in that case.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// listResponse is the wire shape for GET /api/v2/work-items.
type listResponse struct {
	Items []WorkItem `json:"items"`
	Total int        `json:"total"`
}

// List handles GET /api/v2/work-items.
// Requires auth middleware (wired in story 00469); reads subscription_id
// from the JWT context via auth.UserFromCtx.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	subID := auth.UserFromCtx(r.Context()).SubscriptionID

	q := r.URL.Query()
	f := Filters{Limit: 50}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Limit = n
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
	if v := q.Get("owner_id"); v != "" {
		f.OwnerID = &v
	}
	if v := q.Get("sort"); v != "" {
		f.Sort = v
	}
	if v := q.Get("dir"); v != "" {
		f.Dir = v
	}
	// PLA-0043 — ?scope=<uuid> clamps reads to the artefacts owned by
	// this topology node and every live descendant. Invalid UUID is 400
	// before reaching the service; permission/existence is checked
	// inside the service and surfaced as 403/404.
	if v := q.Get("scope"); v != "" {
		if _, perr := uuid.Parse(v); perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid scope"}`))
			return
		}
		f.ScopeNodeID = &v
		actor := auth.UserFromCtx(r.Context())
		userIDStr := actor.ID.String()
		f.ActorUserID = &userIDStr
		f.ActorRole = string(actor.Role)
	}

	items, total, err := h.svc.ListWorkItems(r.Context(), subID, f)
	if err != nil {
		if errors.Is(err, ErrScopeForbidden) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"scope_read_denied"}`))
			return
		}
		if errors.Is(err, ErrScopeNodeNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"scope node not found"}`))
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		log.Printf("artefactitems.List: subID=%s err=%v", subID, err)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(listResponse{Items: items, Total: total})
}

// Get handles GET /api/v2/work-items/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	wi, err := h.svc.GetWorkItem(r.Context(), subID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// ListChildren handles GET /api/v2/work-items/{id}/children.
func (h *Handler) ListChildren(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	items, err := h.svc.ListChildren(r.Context(), subID, id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

// Summary handles GET /api/v2/work-items/summary.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	var sprintID *string
	if v := r.URL.Query().Get("sprint_id"); v != "" {
		sprintID = &v
	}
	out, err := h.svc.SummariseWorkItems(r.Context(), subID, sprintID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// RisksSummary handles GET /_site/risks/summary (PLA-0052 Story 10).
// Severity × likelihood aggregator for the /risk page header.
func (h *Handler) RisksSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	out, err := h.svc.SummariseRisks(r.Context(), subID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// ListFlowStates handles GET /api/v2/work-items/flow-states.
func (h *Handler) ListFlowStates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	states, err := h.svc.ListFlowStates(r.Context(), subID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"states": states})
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

// Create handles POST /api/v2/work-items.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req createWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	wi, err := h.svc.CreateWorkItem(r.Context(), u.SubscriptionID, CreateWorkItemInput{
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
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(wi)
}

type patchWorkItemReq struct {
	Title       *string         `json:"title,omitempty"`
	Description *string         `json:"description,omitempty"`
	Status      *string         `json:"status,omitempty"`
	FlowStateID *string         `json:"flow_state_id,omitempty"`
	Priority    *string         `json:"priority,omitempty"`
	StoryPoints *int            `json:"story_points,omitempty"`
	SprintID    *string         `json:"sprint_id,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
}

// Patch handles PATCH /api/v2/work-items/{id}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	var req patchWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	var dueDate *string
	if len(req.DueDate) > 0 {
		raw := string(req.DueDate)
		if raw == "null" || raw == `""` {
			empty := ""
			dueDate = &empty
		} else {
			var s string
			if err := json.Unmarshal(req.DueDate, &s); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid body"}`))
				return
			}
			dueDate = &s
		}
	}
	wi, err := h.svc.PatchWorkItem(r.Context(), u.SubscriptionID, id, PatchWorkItemInput{
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		FlowStateID: req.FlowStateID,
		Priority:    req.Priority,
		StoryPoints: req.StoryPoints,
		SprintID:    req.SprintID,
		DueDate:     dueDate,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
		case errors.Is(err, ErrInvalidInput):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"internal"}`))
		}
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// Archive handles DELETE /api/v2/work-items/{id}.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	if err := h.svc.ArchiveWorkItem(r.Context(), u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkOpsReq struct {
	IDs     []string       `json:"ids"`
	Op      string         `json:"op"`
	Payload map[string]any `json:"payload"`
}

// Bulk handles POST /api/v2/work-items/bulk.
func (h *Handler) Bulk(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req bulkOpsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	out, err := h.svc.BulkOps(r.Context(), u.SubscriptionID, req.IDs, req.Op, req.Payload)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// ListFieldValues handles GET /api/v2/work-items/{id}/field-values.
func (h *Handler) ListFieldValues(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	fvs, err := h.svc.ListFieldValues(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"field_values": fvs})
}

type upsertFieldValueReq struct {
	FieldLibraryID string  `json:"field_library_id"`
	StringValue    *string `json:"string_value,omitempty"`
	NumberValue    *string `json:"number_value,omitempty"`
	TextValue      *string `json:"text_value,omitempty"`
	DateValue      *string `json:"date_value,omitempty"`
}

// UpsertFieldValues handles PUT /api/v2/work-items/{id}/field-values.
func (h *Handler) UpsertFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	var req upsertFieldValueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	if err := h.svc.UpsertFieldValue(r.Context(), u.SubscriptionID, id, UpsertFieldValueInput{
		FieldLibraryID: req.FieldLibraryID,
		StringValue:    req.StringValue,
		NumberValue:    req.NumberValue,
		TextValue:      req.TextValue,
		DateValue:      req.DateValue,
	}); err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidInput) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteFieldValue handles DELETE /api/v2/work-items/{id}/field-values/{field_library_id}.
func (h *Handler) DeleteFieldValue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	fvID, err := uuid.Parse(chi.URLParam(r, "field_library_id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid field_library_id"}`))
		return
	}
	if err := h.svc.DeleteFieldValue(r.Context(), u.SubscriptionID, id, fvID); err != nil {
		if errors.Is(err, ErrFieldNotFound) || errors.Is(err, ErrNotFound) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
