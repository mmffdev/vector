package timeboxsprints

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the timeboxsprints domain over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// workspaceID extracts the workspace_id from the ?workspace_id query parameter.
// Returns "" if not provided; handlers must validate it is non-empty.
func workspaceID(r *http.Request) string {
	return r.URL.Query().Get("workspace_id")
}

// requireWorkspaceID writes a 400 and returns false if workspace_id is missing.
func requireWorkspaceID(w http.ResponseWriter, r *http.Request) (string, bool) {
	wsID := workspaceID(r)
	if wsID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "workspace_id query parameter is required")
		return "", false
	}
	return wsID, true
}

// List handles GET /api/v2/timeboxes/sprints
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

	sprints, err := h.svc.List(r.Context(), wsID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sprints": sprints,
		"count":   len(sprints),
	})
}

// Get handles GET /api/v2/timeboxes/sprints/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	sprint, err := h.svc.Get(r.Context(), wsID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sprint)
}

// Create handles POST /api/v2/timeboxes/sprints
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	user := auth.UserFromCtx(r.Context())

	var body struct {
		SprintName        string  `json:"timeboxes_sprints_name"`
		SprintSuffix      *string `json:"timeboxes_sprints_suffix"`
		SprintOwner       *string `json:"timeboxes_sprints_id_user_owner"`
		SprintCadenceDays int     `json:"timeboxes_sprints_cadence_days"`
		SprintDateStart   string  `json:"timeboxes_sprints_date_start"`
		SprintDateEnd     string  `json:"timeboxes_sprints_date_end"`
		OrgNodeID         *string `json:"timeboxes_sprints_id_topology_node"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	in := CreateSprintInput{
		SubscriptionID:    user.SubscriptionID.String(),
		WorkspaceID:       wsID,
		OrgNodeID:         body.OrgNodeID,
		SprintName:        body.SprintName,
		SprintSuffix:      body.SprintSuffix,
		SprintOwner:       body.SprintOwner,
		SprintCadenceDays: body.SprintCadenceDays,
		SprintDateStart:   body.SprintDateStart,
		SprintDateEnd:     body.SprintDateEnd,
	}

	sprint, err := h.svc.Create(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrAdjacency):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_sprints_date_start", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_sprints_date_start", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(sprint)
}

// Update handles PUT /api/v2/timeboxes/sprints/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var body struct {
		SprintName        *string `json:"timeboxes_sprints_name"`
		SprintSuffix      *string `json:"timeboxes_sprints_suffix"`
		SprintOwner       *string `json:"timeboxes_sprints_id_user_owner"`
		SprintCadenceDays *int    `json:"timeboxes_sprints_cadence_days"`
		SprintDateStart   *string `json:"timeboxes_sprints_date_start"`
		SprintDateEnd     *string `json:"timeboxes_sprints_date_end"`
		SprintScope       *int    `json:"timeboxes_sprints_scope"`
		SprintVelocity    *int    `json:"timeboxes_sprints_velocity"`
		SprintEstimate    *int    `json:"timeboxes_sprints_estimate"`
		Status            *string `json:"timeboxes_sprints_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	in := UpdateSprintInput{
		SprintName:        body.SprintName,
		SprintSuffix:      body.SprintSuffix,
		SprintOwner:       body.SprintOwner,
		SprintCadenceDays: body.SprintCadenceDays,
		SprintDateStart:   body.SprintDateStart,
		SprintDateEnd:     body.SprintDateEnd,
		SprintScope:       body.SprintScope,
		SprintVelocity:    body.SprintVelocity,
		SprintEstimate:    body.SprintEstimate,
		Status:            body.Status,
	}

	sprint, err := h.svc.Update(r.Context(), wsID, id, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_sprints_date_start", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sprint)
}

// Delete handles DELETE /api/v2/timeboxes/sprints/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	if err := h.svc.Delete(r.Context(), wsID, id); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrLifecycle):
			httperr.Write(w, r, http.StatusConflict, "Active or completed sprints cannot be deleted.")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Start handles POST /api/v2/timeboxes/sprints/{id}/start
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	sprint, err := h.svc.Start(r.Context(), wsID, id)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrStartLifecycle):
			httperr.Write(w, r, http.StatusConflict, ErrStartLifecycle.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sprint)
}

// Close handles POST /api/v2/timeboxes/sprints/{id}/close
func (h *Handler) Close(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	sprint, err := h.svc.Close(r.Context(), wsID, id)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrCloseLifecycle):
			httperr.Write(w, r, http.StatusConflict, ErrCloseLifecycle.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sprint)
}

// BulkCreate handles POST /api/v2/timeboxes/sprints/bulk-create
func (h *Handler) BulkCreate(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	user := auth.UserFromCtx(r.Context())

	var body struct {
		Sprints []struct {
			SprintName        string  `json:"timeboxes_sprints_name"`
			SprintSuffix      *string `json:"timeboxes_sprints_suffix"`
			SprintOwner       *string `json:"timeboxes_sprints_id_user_owner"`
			SprintCadenceDays int     `json:"timeboxes_sprints_cadence_days"`
			SprintDateStart   string  `json:"timeboxes_sprints_date_start"`
			SprintDateEnd     string  `json:"timeboxes_sprints_date_end"`
			SprintVelocity    *int    `json:"timeboxes_sprints_velocity"`
			OrgNodeID         *string `json:"timeboxes_sprints_id_topology_node"`
		} `json:"sprints"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if len(body.Sprints) == 0 {
		httperr.WriteValidation(w, r, []httperr.Violation{
			{Field: "sprints", Message: "at least one sprint is required"},
		})
		return
	}

	inputs := make([]CreateSprintInput, len(body.Sprints))
	for i, s := range body.Sprints {
		inputs[i] = CreateSprintInput{
			SubscriptionID:    user.SubscriptionID.String(),
			WorkspaceID:       wsID,
			OrgNodeID:         s.OrgNodeID,
			SprintName:        s.SprintName,
			SprintSuffix:      s.SprintSuffix,
			SprintOwner:       s.SprintOwner,
			SprintCadenceDays: s.SprintCadenceDays,
			SprintDateStart:   s.SprintDateStart,
			SprintDateEnd:     s.SprintDateEnd,
			SprintVelocity:    s.SprintVelocity,
		}
	}

	sprints, err := h.svc.BulkCreate(r.Context(), inputs)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "sprints", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "sprints", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sprints": sprints,
		"count":   len(sprints),
	})
}
