package defects

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type createReq struct {
	TypeID           string  `json:"type_id"`
	Name             string  `json:"name"`
	Severity         string  `json:"severity"`
	Description      *string `json:"description,omitempty"`
	LinkedStory      *string `json:"linked_story,omitempty"`
	StepsToReproduce *string `json:"steps_to_reproduce,omitempty"`
	Environment      *string `json:"environment,omitempty"`
	Browser          *string `json:"browser,omitempty"`
	NameOwner        *string `json:"name_owner,omitempty"`
}

// POST /api/defects
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.TypeID == "" || req.Name == "" || req.Severity == "" {
		http.Error(w, "type_id, name, and severity are required", http.StatusBadRequest)
		return
	}
	defect, err := h.Svc.Create(r.Context(), u.SubscriptionID, u.ID, CreateInput{
		TypeID:           req.TypeID,
		Name:             req.Name,
		Severity:         req.Severity,
		Description:      req.Description,
		LinkedStory:      req.LinkedStory,
		StepsToReproduce: req.StepsToReproduce,
		Environment:      req.Environment,
		Browser:          req.Browser,
		NameOwner:        req.NameOwner,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidSeverity) {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		if err.Error() == "name cannot be empty" || err.Error() == "invalid type_id" ||
			err.Error() == "invalid name_owner" || err.Error() == "invalid linked_story" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, defect)
}

// GET /api/defects/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	defect, err := h.Svc.Get(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, defect)
}

type patchReq struct {
	Name               *string  `json:"name,omitempty"`
	Description        *string  `json:"description,omitempty"`
	AcceptanceCriteria *string  `json:"acceptance_criteria,omitempty"`
	Notes              *string  `json:"notes,omitempty"`
	Severity           *string  `json:"severity,omitempty"`
	StepsToReproduce   *string  `json:"steps_to_reproduce,omitempty"`
	Environment        *string  `json:"environment,omitempty"`
	Browser            *string  `json:"browser,omitempty"`
	Regression         *bool    `json:"regression,omitempty"`
	NameOwner          *string  `json:"name_owner,omitempty"`
	LinkedStory        *string  `json:"linked_story,omitempty"`
	ScheduleState      *string  `json:"schedule_state,omitempty"`
	Blocked            *bool    `json:"blocked,omitempty"`
	BlockedReason      *string  `json:"blocked_reason,omitempty"`
	Ready              *bool    `json:"ready,omitempty"`
	Expedite           *bool    `json:"expedite,omitempty"`
	Sprint             *string  `json:"sprint,omitempty"`
	Release            *string  `json:"release,omitempty"`
	EstimateHours      *float64 `json:"estimate_hours,omitempty"`
	EstimateRemaining  *float64 `json:"estimate_remaining,omitempty"`
	Rank               *string  `json:"rank,omitempty"`
	RiskScore          *float64 `json:"risk_score,omitempty"`
	RiskImpact         *string  `json:"risk_impact,omitempty"`
	LidentifierColour  *string  `json:"lidentifier_colour,omitempty"`
	LidentifierType    *string  `json:"lidentifier_type,omitempty"`
}

// PATCH /api/defects/{id}
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	defect, err := h.Svc.Patch(r.Context(), u.SubscriptionID, id, PatchInput{
		Name:               req.Name,
		Description:        req.Description,
		AcceptanceCriteria: req.AcceptanceCriteria,
		Notes:              req.Notes,
		Severity:           req.Severity,
		StepsToReproduce:   req.StepsToReproduce,
		Environment:        req.Environment,
		Browser:            req.Browser,
		Regression:         req.Regression,
		NameOwner:          req.NameOwner,
		LinkedStory:        req.LinkedStory,
		ScheduleState:      req.ScheduleState,
		Blocked:            req.Blocked,
		BlockedReason:      req.BlockedReason,
		Ready:              req.Ready,
		Expedite:           req.Expedite,
		Sprint:             req.Sprint,
		Release:            req.Release,
		EstimateHours:      req.EstimateHours,
		EstimateRemaining:  req.EstimateRemaining,
		Rank:               req.Rank,
		RiskScore:          req.RiskScore,
		RiskImpact:         req.RiskImpact,
		LidentifierColour:  req.LidentifierColour,
		LidentifierType:    req.LidentifierType,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrInvalidSeverity) {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, defect)
}

// DELETE /api/defects/{id} — soft-archive.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Archive(r.Context(), u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
