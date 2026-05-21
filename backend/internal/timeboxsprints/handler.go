package timeboxsprints

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
// Mirror of the artefactitems projection helpers. See
// backend/internal/artefactitems/handler.go for the contract rationale.

// parseSprintFieldsParam reads ?fields= and validates each name against
// the catalogue. Returns nil on absent param (back-compat).
func parseSprintFieldsParam(raw string) (set map[string]bool, unknown string, ok bool) {
	if raw == "" {
		return nil, "", true
	}
	out := make(map[string]bool)
	for _, name := range strings.Split(raw, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if !IsKnownSprintColumn(name) {
			return nil, name, false
		}
		out[name] = true
	}
	for _, alwaysOn := range AlwaysOnSprintColumns() {
		out[alwaysOn] = true
	}
	return out, "", true
}

// projectSprints applies the field set to a slice of *Sprint. nil set
// means "no projection — return as-is".
func projectSprints(sprints []*Sprint, set map[string]bool) (any, error) {
	if set == nil {
		return sprints, nil
	}
	out := make([]map[string]any, 0, len(sprints))
	for _, s := range sprints {
		buf, err := json.Marshal(s)
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

// List handles GET /api/v2/timeboxes/sprints.
//
// Slice 6.3a (2026-05-21) — response shape cut over to ObjectTreeV2's
// canonical contract: `{ items, total }` instead of the legacy
// `{ sprints, count }`. The legacy keys were the original shape from
// PLA-0027; ObjectTreeV2's data hook expects `items` + `total` so this
// handler now matches that contract. ArtefactInlineForm's reads were
// migrated in the same slice. Add `?limit=` / `?offset=` paging; both
// default to "return everything" so existing callers stay green.
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

	// Slice 2.5 — ?fields= projection. Parsed BEFORE the service call so
	// unknown names fail fast (400) without hitting the DB.
	fieldSet, unknownField, fieldsOk := parseSprintFieldsParam(q.Get("fields"))
	if !fieldsOk {
		httperr.Write(w, r, http.StatusBadRequest, "unknown field: "+unknownField)
		return
	}

	sprints, err := h.svc.List(r.Context(), wsID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	total := len(sprints)

	// Slice 6.3a — apply ?limit=/&offset= window. Defaults: limit=0 means
	// "no limit" (return all); offset clamped to [0,total]. Sprint counts
	// per workspace are typically small (<50) so in-handler slicing is
	// fine; if the workspace ever scales past that we move the LIMIT into
	// the SQL like work-items does.
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
	windowed := sprints[offset:end]

	projected, projErr := projectSprints(windowed, fieldSet)
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

// Columns handles GET /api/v2/timeboxes/sprints/columns — Slice 2.5.
// Returns the allow-list of fields callers may request via ?fields=.
func (h *Handler) Columns(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"columns": SprintColumns,
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

	// Slice 6.3a — response shape cut over to {items,total} to match the
	// List endpoint + ObjectTreeV2's data-hook contract.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": sprints,
		"total": len(sprints),
	})
}
