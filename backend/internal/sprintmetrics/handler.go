package sprintmetrics

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Metrics handles GET /_site/timeboxes/sprints/{id}/metrics.
// Sentinel establishes the workspace clamp server-side (fail-closed).
func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID, ok := sentinel.WorkspaceIDFromCtx(ctx)
	if !ok || wsID == uuid.Nil {
		httperr.Write(w, r, http.StatusUnauthorized, "no workspace clamp")
		return
	}
	sprintID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid sprint id")
		return
	}
	model, err := h.svc.Metrics(ctx, sprintID, wsID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "metrics projection failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(model)
}

// Velocity handles GET /_site/timeboxes/velocity — the cross-sprint team
// velocity for the caller's workspace (mean net-accepted points over the rolling
// window). Standalone from the per-sprint /metrics endpoint so any consumer
// (burndown KPI, a future velocity chart, a capacity report) reads it the same
// way. Sentinel establishes the workspace clamp server-side (fail-closed).
func (h *Handler) Velocity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID, ok := sentinel.WorkspaceIDFromCtx(ctx)
	if !ok || wsID == uuid.Nil {
		httperr.Write(w, r, http.StatusUnauthorized, "no workspace clamp")
		return
	}
	result, err := h.svc.Velocity(ctx, wsID, time.Now().UTC())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "velocity computation failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
