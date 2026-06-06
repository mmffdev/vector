package taskmetrics

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Metrics handles GET /_site/timeboxes/sprints/{id}/task-metrics.
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
		httperr.Write(w, r, http.StatusInternalServerError, "task metrics projection failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(model)
}
