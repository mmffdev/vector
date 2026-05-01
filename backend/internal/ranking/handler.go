package ranking

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// Handler exposes the rank service over HTTP. One generic endpoint
// serves every registered resource — the resource_type field in the
// request body picks the registry entry.
type Handler struct {
	Svc *Service
}

// NewHandler returns a Handler backed by the given Service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type moveReq struct {
	ResourceType string  `json:"resource_type"`
	RowID        string  `json:"row_id"`
	Before       *string `json:"before,omitempty"`
	After        *string `json:"after,omitempty"`
	ToTop        bool    `json:"to_top,omitempty"`
	ToBottom     bool    `json:"to_bottom,omitempty"`
}

// Move handles POST /api/rank/move.
//
// SubscriptionID is taken from the session via auth.UserFromCtx —
// never from the request body. This is the tenant-isolation boundary:
// a logged-in user can only ever move rows within their own tenant.
func (h *Handler) Move(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body moveReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	rowID, err := uuid.Parse(body.RowID)
	if err != nil {
		http.Error(w, "invalid row_id", http.StatusBadRequest)
		return
	}

	req := MoveRequest{
		ResourceType:   body.ResourceType,
		SubscriptionID: u.SubscriptionID,
		RowID:          rowID,
		ToTop:          body.ToTop,
		ToBottom:       body.ToBottom,
	}
	if body.Before != nil {
		id, err := uuid.Parse(*body.Before)
		if err != nil {
			http.Error(w, "invalid before id", http.StatusBadRequest)
			return
		}
		req.Before = &id
	}
	if body.After != nil {
		id, err := uuid.Parse(*body.After)
		if err != nil {
			http.Error(w, "invalid after id", http.StatusBadRequest)
			return
		}
		req.After = &id
	}

	result, err := h.Svc.Move(r.Context(), req)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnknownResource), errors.Is(err, ErrInvalidArgument):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, ErrForbidden):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, ErrRowNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, ErrScopeMismatch):
		http.Error(w, err.Error(), http.StatusConflict)
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
