package timeboxreleases

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler exposes the timeboxreleases domain over HTTP.
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

// List handles GET /api/v2/timeboxes/releases
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

	releases, err := h.svc.List(r.Context(), wsID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"releases": releases,
		"count":    len(releases),
	})
}

// Get handles GET /api/v2/timeboxes/releases/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	release, err := h.svc.Get(r.Context(), wsID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(release)
}

// Create handles POST /api/v2/timeboxes/releases
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	user := auth.UserFromCtx(r.Context())

	var body struct {
		ReleaseName        string  `json:"timeboxes_releases_name"`
		ReleaseSuffix      *string `json:"timeboxes_releases_suffix"`
		ReleaseOwner       *string `json:"timeboxes_releases_id_user_owner"`
		ReleaseCadenceDays int     `json:"timeboxes_releases_cadence_days"`
		ReleaseDateStart   string  `json:"timeboxes_releases_date_start"`
		ReleaseDateEnd     string  `json:"timeboxes_releases_date_end"`
		OrgNodeID          *string `json:"timeboxes_releases_id_topology_node"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}

	in := CreateReleaseInput{
		SubscriptionID:     user.SubscriptionID.String(),
		WorkspaceID:        wsID,
		OrgNodeID:          body.OrgNodeID,
		ReleaseName:        body.ReleaseName,
		ReleaseSuffix:      body.ReleaseSuffix,
		ReleaseOwner:       body.ReleaseOwner,
		ReleaseCadenceDays: body.ReleaseCadenceDays,
		ReleaseDateStart:   body.ReleaseDateStart,
		ReleaseDateEnd:     body.ReleaseDateEnd,
	}

	release, err := h.svc.Create(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_releases_date_start", Message: messages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(release)
}

// Update handles PUT /api/v2/timeboxes/releases/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var body struct {
		ReleaseName        *string `json:"timeboxes_releases_name"`
		ReleaseSuffix      *string `json:"timeboxes_releases_suffix"`
		ReleaseOwner       *string `json:"timeboxes_releases_id_user_owner"`
		ReleaseCadenceDays *int    `json:"timeboxes_releases_cadence_days"`
		ReleaseDateStart   *string `json:"timeboxes_releases_date_start"`
		ReleaseDateEnd     *string `json:"timeboxes_releases_date_end"`
		ReleaseScope       *int    `json:"timeboxes_releases_scope"`
		ReleaseVelocity    *int    `json:"timeboxes_releases_velocity"`
		ReleaseEstimate    *int    `json:"timeboxes_releases_estimate"`
		Status             *string `json:"timeboxes_releases_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}

	in := UpdateReleaseInput{
		ReleaseName:        body.ReleaseName,
		ReleaseSuffix:      body.ReleaseSuffix,
		ReleaseOwner:       body.ReleaseOwner,
		ReleaseCadenceDays: body.ReleaseCadenceDays,
		ReleaseDateStart:   body.ReleaseDateStart,
		ReleaseDateEnd:     body.ReleaseDateEnd,
		ReleaseScope:       body.ReleaseScope,
		ReleaseVelocity:    body.ReleaseVelocity,
		ReleaseEstimate:    body.ReleaseEstimate,
		Status:             body.Status,
	}

	release, err := h.svc.Update(r.Context(), wsID, id, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_releases_date_start", Message: messages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(release)
}

// Delete handles DELETE /api/v2/timeboxes/releases/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	if err := h.svc.Delete(r.Context(), wsID, id); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		case errors.Is(err, ErrLifecycle):
			httperr.Write(w, r, http.StatusConflict, "Active or completed releases cannot be deleted.")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// BulkCreate handles POST /api/v2/timeboxes/releases/bulk-create
func (h *Handler) BulkCreate(w http.ResponseWriter, r *http.Request) {
	wsID, ok := requireWorkspaceID(w, r)
	if !ok {
		return
	}
	user := auth.UserFromCtx(r.Context())

	var body struct {
		Releases []struct {
			ReleaseName        string  `json:"timeboxes_releases_name"`
			ReleaseSuffix      *string `json:"timeboxes_releases_suffix"`
			ReleaseOwner       *string `json:"timeboxes_releases_id_user_owner"`
			ReleaseCadenceDays int     `json:"timeboxes_releases_cadence_days"`
			ReleaseDateStart   string  `json:"timeboxes_releases_date_start"`
			ReleaseDateEnd     string  `json:"timeboxes_releases_date_end"`
			ReleaseVelocity    *int    `json:"timeboxes_releases_velocity"`
			OrgNodeID          *string `json:"timeboxes_releases_id_topology_node"`
		} `json:"releases"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	if len(body.Releases) == 0 {
		httperr.WriteValidation(w, r, []httperr.Violation{
			{Field: "releases", Message: "at least one release is required"},
		})
		return
	}

	inputs := make([]CreateReleaseInput, len(body.Releases))
	for i, rel := range body.Releases {
		inputs[i] = CreateReleaseInput{
			SubscriptionID:     user.SubscriptionID.String(),
			WorkspaceID:        wsID,
			OrgNodeID:          rel.OrgNodeID,
			ReleaseName:        rel.ReleaseName,
			ReleaseSuffix:      rel.ReleaseSuffix,
			ReleaseOwner:       rel.ReleaseOwner,
			ReleaseCadenceDays: rel.ReleaseCadenceDays,
			ReleaseDateStart:   rel.ReleaseDateStart,
			ReleaseDateEnd:     rel.ReleaseDateEnd,
			ReleaseVelocity:    rel.ReleaseVelocity,
		}
	}

	releases, err := h.svc.BulkCreate(r.Context(), inputs)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "releases", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "releases", Message: messages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"releases": releases,
		"count":    len(releases),
	})
}
