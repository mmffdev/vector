package workitemsv2

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

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

	items, total, err := h.svc.ListWorkItems(r.Context(), subID, f)
	if err != nil {
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
