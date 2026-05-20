package timeboxmilestones

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the timeboxmilestones domain over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func workspaceID(r *http.Request) string {
	return r.URL.Query().Get("workspace_id")
}

func requireWorkspaceID(w http.ResponseWriter, r *http.Request) (string, bool) {
	wsID := workspaceID(r)
	if wsID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "workspace_id query parameter is required")
		return "", false
	}
	return wsID, true
}

// List handles GET /_site/timeboxes/milestones
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()

	var f ListFilters
	if v := q.Get("org_node_id"); v != "" {
		f.OrgNodeID = &v
	}
	if v := q.Get("status"); v != "" {
		f.Status = &v
	}

	milestones, err := h.svc.List(r.Context(), wsID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"milestones": milestones,
		"count":      len(milestones),
	})
}

// Get handles GET /_site/timeboxes/milestones/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	m, err := h.svc.Get(r.Context(), wsID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(m)
}

// Create handles POST /_site/timeboxes/milestones
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	user := auth.UserFromCtx(r.Context())

	var body struct {
		MilestoneName        string  `json:"timeboxes_milestones_name"`
		MilestoneDescription *string `json:"timeboxes_milestones_description"`
		MilestoneOwner       *string `json:"timeboxes_milestones_id_user_owner"`
		MilestoneDateTarget  string  `json:"timeboxes_milestones_date_target"`
		Position             *int    `json:"timeboxes_milestones_position"`
		OrgNodeID            *string `json:"timeboxes_milestones_id_topology_node"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	in := CreateMilestoneInput{
		SubscriptionID:       user.SubscriptionID.String(),
		WorkspaceID:          wsID,
		OrgNodeID:            body.OrgNodeID,
		MilestoneName:        body.MilestoneName,
		MilestoneDescription: body.MilestoneDescription,
		MilestoneOwner:       body.MilestoneOwner,
		MilestoneDateTarget:  body.MilestoneDateTarget,
		Position:             body.Position,
	}

	m, err := h.svc.Create(r.Context(), in)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(m)
}

// Update handles PATCH /_site/timeboxes/milestones/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var body struct {
		MilestoneName        *string `json:"timeboxes_milestones_name"`
		MilestoneDescription *string `json:"timeboxes_milestones_description"`
		MilestoneOwner       *string `json:"timeboxes_milestones_id_user_owner"`
		MilestoneDateTarget  *string `json:"timeboxes_milestones_date_target"`
		Status               *string `json:"timeboxes_milestones_status"`
		Position             *int    `json:"timeboxes_milestones_position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	in := UpdateMilestoneInput{
		MilestoneName:        body.MilestoneName,
		MilestoneDescription: body.MilestoneDescription,
		MilestoneOwner:       body.MilestoneOwner,
		MilestoneDateTarget:  body.MilestoneDateTarget,
		Status:               body.Status,
		Position:             body.Position,
	}

	m, err := h.svc.Update(r.Context(), wsID, id, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(m)
}

// Delete handles DELETE /_site/timeboxes/milestones/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	if err := h.svc.Delete(r.Context(), wsID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
