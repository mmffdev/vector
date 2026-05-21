package timeboxreleases

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// ── Slice 2.5: ?fields= projection ───────────────────────────────────────────
// Mirror of the artefactitems/timeboxsprints projection helpers.

func parseReleaseFieldsParam(raw string) (set map[string]bool, unknown string, ok bool) {
	if raw == "" {
		return nil, "", true
	}
	out := make(map[string]bool)
	for _, name := range strings.Split(raw, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if !IsKnownReleaseColumn(name) {
			return nil, name, false
		}
		out[name] = true
	}
	for _, alwaysOn := range AlwaysOnReleaseColumns() {
		out[alwaysOn] = true
	}
	return out, "", true
}

func projectReleases(releases []*Release, set map[string]bool) (any, error) {
	if set == nil {
		return releases, nil
	}
	out := make([]map[string]any, 0, len(releases))
	for _, r := range releases {
		buf, err := json.Marshal(r)
		if err != nil {
			return nil, err
		}
		var m map[string]any
		if err := json.Unmarshal(buf, &m); err != nil {
			return nil, err
		}
		for k := range m {
			if !set[k] {
				delete(m, k)
			}
		}
		out = append(out, m)
	}
	return out, nil
}

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

// List handles GET /api/v2/timeboxes/releases.
//
// Slice 6.3a (2026-05-21) — response shape cut over from
// `{releases, count}` to ObjectTreeV2's `{items, total}` contract, and
// `?limit=`/`?offset=` paging added. See the matching cutover in
// timeboxsprints/handler.go for the rationale.
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

	// Slice 2.5 — ?fields= projection.
	fieldSet, unknownField, fieldsOk := parseReleaseFieldsParam(q.Get("fields"))
	if !fieldsOk {
		httperr.Write(w, r, http.StatusBadRequest, "unknown field: "+unknownField)
		return
	}

	releases, err := h.svc.List(r.Context(), wsID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	total := len(releases)

	// Slice 6.3a paging — match the sprint handler's contract.
	offset := 0
	if v := q.Get("offset"); v != "" {
		if n, parseErr := strconv.Atoi(v); parseErr == nil && n >= 0 {
			if n > total {
				n = total
			}
			offset = n
		}
	}
	limit := total - offset
	if v := q.Get("limit"); v != "" {
		if n, parseErr := strconv.Atoi(v); parseErr == nil && n >= 0 {
			limit = n
		}
	}
	end := offset + limit
	if end > total {
		end = total
	}
	if offset > end {
		offset = end
	}
	windowed := releases[offset:end]

	projected, projErr := projectReleases(windowed, fieldSet)
	if projErr != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": projected,
		"total": total,
	})
}

// Columns handles GET /api/v2/timeboxes/releases/columns — Slice 2.5.
func (h *Handler) Columns(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"columns": ReleaseColumns,
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
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
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
				{Field: "timeboxes_releases_date_start", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
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
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrConflict):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "timeboxes_releases_date_start", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrLifecycle):
			httperr.Write(w, r, http.StatusConflict, "Active or completed releases cannot be deleted.")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
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
				{Field: "releases", Message: usermessages.Conflict},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	// Slice 6.3a — response shape cut over to {items,total}.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": releases,
		"total": len(releases),
	})
}
