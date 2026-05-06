package portfolioitems

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
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

// POST /api/portfolio-items
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TypeID == "" || req.Name == "" {
		httperr.Write(w, r, http.StatusBadRequest, "type_id and name are required")
		return
	}
	item, err := h.Svc.Create(r.Context(), u.SubscriptionID, u.ID, CreateInput{
		TypeID:      req.TypeID,
		Name:        req.Name,
		Description: req.Description,
		NameOwner:   req.NameOwner,
	})
	if err != nil {
		if err.Error() == "name cannot be empty" || err.Error() == "invalid type_id" || err.Error() == "invalid name_owner" {
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// GET /api/portfolio-items/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	item, err := h.Svc.Get(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

type patchReq struct {
	Name                      *string   `json:"name,omitempty"`
	Description               *string   `json:"description,omitempty"`
	AcceptanceCriteria        *string   `json:"acceptance_criteria,omitempty"`
	Notes                     *string   `json:"notes,omitempty"`
	NameOwner                 *string   `json:"name_owner,omitempty"`
	FlowState                 *string   `json:"flow_state,omitempty"`
	FlowStateChangeUpdateDate *time.Time `json:"flow_state_change_update_date,omitempty"`
	FlowStateChangeOwner      *string   `json:"flow_state_change_owner,omitempty"`
	Blocked                   *bool     `json:"blocked,omitempty"`
	BlockedReason             *string   `json:"blocked_reason,omitempty"`
	DateWorkPlannedStart      *time.Time `json:"date_work_planned_start,omitempty"`
	DateWorkPlannedFinish     *time.Time `json:"date_work_planned_finish,omitempty"`
	DateWorkStarted           *time.Time `json:"date_work_started,omitempty"`
	DateWorkAccepted          *time.Time `json:"date_work_accepted,omitempty"`
	EstimateInitial           *string   `json:"estimate_initial,omitempty"`
	EstimateUpdated           *float64  `json:"estimate_updated,omitempty"`
	RiskImpact                *string   `json:"risk_impact,omitempty"`
	RiskProbability           *string   `json:"risk_probability,omitempty"`
	RiskScore                 *float64  `json:"risk_score,omitempty"`
	StrategicInvestmentGroup  *string   `json:"strategic_investment_group,omitempty"`
	StrategicInvestmentWeight *string   `json:"strategic_investment_weight,omitempty"`
	StrategicItemType         *string   `json:"strategic_item_type,omitempty"`
	ValueStreamIdentifier     *string   `json:"value_stream_identifier,omitempty"`
	LidentifierColour         *string   `json:"lidentifier_colour,omitempty"`
	LidentifierLabels         []string  `json:"lidentifier_labels,omitempty"`
	LidentifierTags           []string  `json:"lidentifier_tags,omitempty"`
}

// PATCH /api/portfolio-items/{id}
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	item, err := h.Svc.Patch(r.Context(), u.SubscriptionID, id, PatchInput{
		Name:                      req.Name,
		Description:               req.Description,
		AcceptanceCriteria:        req.AcceptanceCriteria,
		Notes:                     req.Notes,
		NameOwner:                 req.NameOwner,
		FlowState:                 req.FlowState,
		FlowStateChangeUpdateDate: req.FlowStateChangeUpdateDate,
		FlowStateChangeOwner:      req.FlowStateChangeOwner,
		Blocked:                   req.Blocked,
		BlockedReason:             req.BlockedReason,
		DateWorkPlannedStart:      req.DateWorkPlannedStart,
		DateWorkPlannedFinish:     req.DateWorkPlannedFinish,
		DateWorkStarted:           req.DateWorkStarted,
		DateWorkAccepted:          req.DateWorkAccepted,
		EstimateInitial:           req.EstimateInitial,
		EstimateUpdated:           req.EstimateUpdated,
		RiskImpact:                req.RiskImpact,
		RiskProbability:           req.RiskProbability,
		RiskScore:                 req.RiskScore,
		StrategicInvestmentGroup:  req.StrategicInvestmentGroup,
		StrategicInvestmentWeight: req.StrategicInvestmentWeight,
		StrategicItemType:         req.StrategicItemType,
		ValueStreamIdentifier:     req.ValueStreamIdentifier,
		LidentifierColour:         req.LidentifierColour,
		LidentifierLabels:         req.LidentifierLabels,
		LidentifierTags:           req.LidentifierTags,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// DELETE /api/portfolio-items/{id} — soft-archive
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.Archive(r.Context(), u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
