package userstories

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
	TypeID      string  `json:"type_id"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	NameOwner   *string `json:"name_owner,omitempty"`
}

// POST /api/user-stories
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.TypeID == "" || req.Name == "" {
		http.Error(w, "type_id and name are required", http.StatusBadRequest)
		return
	}
	story, err := h.Svc.Create(r.Context(), u.SubscriptionID, u.ID, CreateInput{
		TypeID:      req.TypeID,
		Name:        req.Name,
		Description: req.Description,
		NameOwner:   req.NameOwner,
	})
	if err != nil {
		if err.Error() == "name cannot be empty" || err.Error() == "invalid type_id" || err.Error() == "invalid name_owner" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, story)
}

// GET /api/user-stories/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	story, err := h.Svc.Get(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, story)
}

type patchReq struct {
	Name               *string  `json:"name,omitempty"`
	Description        *string  `json:"description,omitempty"`
	AcceptanceCriteria *string  `json:"acceptance_criteria,omitempty"`
	Notes              *string  `json:"notes,omitempty"`
	NameOwner          *string  `json:"name_owner,omitempty"`
	ScheduleState      *string  `json:"schedule_state,omitempty"`
	Blocked            *bool    `json:"blocked,omitempty"`
	BlockedReason      *string  `json:"blocked_reason,omitempty"`
	Ready              *bool    `json:"ready,omitempty"`
	Expedite           *bool    `json:"expedite,omitempty"`
	AffectsDoc         *bool    `json:"affects_doc,omitempty"`
	Sprint             *string  `json:"sprint,omitempty"`
	Release            *string  `json:"release,omitempty"`
	EstimatePoints     *float64 `json:"estimate_points,omitempty"`
	EstimateHours      *float64 `json:"estimate_hours,omitempty"`
	EstimateRemaining  *float64 `json:"estimate_remaining,omitempty"`
	Rank               *string  `json:"rank,omitempty"`
	RiskScore          *float64 `json:"risk_score,omitempty"`
	RiskImpact         *string  `json:"risk_impact,omitempty"`
	RiskProbability    *string  `json:"risk_probability,omitempty"`
	LidentifierColour  *string  `json:"lidentifier_colour,omitempty"`
	LidentifierType    *string  `json:"lidentifier_type,omitempty"`
}

// PATCH /api/user-stories/{id}
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
	story, err := h.Svc.Patch(r.Context(), u.SubscriptionID, id, PatchInput{
		Name:               req.Name,
		Description:        req.Description,
		AcceptanceCriteria: req.AcceptanceCriteria,
		Notes:              req.Notes,
		NameOwner:          req.NameOwner,
		ScheduleState:      req.ScheduleState,
		Blocked:            req.Blocked,
		BlockedReason:      req.BlockedReason,
		Ready:              req.Ready,
		Expedite:           req.Expedite,
		AffectsDoc:         req.AffectsDoc,
		Sprint:             req.Sprint,
		Release:            req.Release,
		EstimatePoints:     req.EstimatePoints,
		EstimateHours:      req.EstimateHours,
		EstimateRemaining:  req.EstimateRemaining,
		Rank:               req.Rank,
		RiskScore:          req.RiskScore,
		RiskImpact:         req.RiskImpact,
		RiskProbability:    req.RiskProbability,
		LidentifierColour:  req.LidentifierColour,
		LidentifierType:    req.LidentifierType,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, story)
}

// DELETE /api/user-stories/{id} — soft-archive (sets archived_at).
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
