package apikeys

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler provides HTTP handlers for API key operations.
type Handler struct {
	svc *Service
}

// NewHandler creates a new API key handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// IssueRequest is the body for issuing an API key.
type IssueRequest struct {
	ExpiresAt *time.Time `json:"expires_at"` // Optional expiration
	Scopes    []string   `json:"scopes"`    // Optional scopes (e.g., ["read:portfolio"])
}

// IssueResponse returns the newly created key (with raw_key, returned only once).
type IssueResponse struct {
	Key *Key `json:"key"`
}

// Issue creates a new API key for the caller's subscription.
// Returns the full key once; never returned again.
// Padmin-only.
func (h *Handler) Issue(w http.ResponseWriter, r *http.Request) {
	var req IssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}

	// Support both JWT (user context) and API key auth (subscription_id in context)
	subscriptionID := ""
	if user := auth.UserFromCtx(r.Context()); user != nil {
		subscriptionID = user.SubscriptionID.String()
	} else if apiKeySubID := GetSubscriptionIDFromContext(r); apiKeySubID != "" {
		subscriptionID = apiKeySubID
	}

	if subscriptionID == "" {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}

	key, err := h.svc.Issue(r.Context(), subscriptionID, req.ExpiresAt, req.Scopes)
	if err != nil {
		log.Printf("apikeys.Issue error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(IssueResponse{Key: key})
}

// ListResponse returns all non-revoked keys for the caller's subscription.
type ListResponse struct {
	Keys []KeyInfo `json:"keys"`
}

// List returns all active keys for the caller's subscription.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	// Support both JWT (user context) and API key auth (subscription_id in context)
	subscriptionID := ""
	if user := auth.UserFromCtx(r.Context()); user != nil {
		subscriptionID = user.SubscriptionID.String()
	} else if apiKeySubID := GetSubscriptionIDFromContext(r); apiKeySubID != "" {
		subscriptionID = apiKeySubID
	}

	if subscriptionID == "" {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}

	keys, err := h.svc.ListKeys(r.Context(), subscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(ListResponse{Keys: keys})
}

// RevokeRequest is the body for revoking a key.
type RevokeRequest struct {
	ID string `json:"id"`
}

// Revoke marks a key as revoked (soft-delete).
// Supports both JWT (user context) and API key auth (subscription_id in context).
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	var req RevokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}

	if req.ID == "" {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestMissingFields)
		return
	}

	err := h.svc.Revoke(r.Context(), req.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
