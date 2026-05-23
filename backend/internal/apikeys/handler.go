package apikeys

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler provides HTTP handlers for API key operations.
type Handler struct {
	svc      *Service
	auditLog *audit.Logger // optional; nil disables audit logging
}

// NewHandler creates a new API key handler. auditLog may be nil in tests
// or when audit emission is deliberately disabled; in production it is
// always wired (main.go).
func NewHandler(svc *Service, auditLog *audit.Logger) *Handler {
	return &Handler{svc: svc, auditLog: auditLog}
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
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
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	key, err := h.svc.Issue(r.Context(), subscriptionID, req.ExpiresAt, req.Scopes)
	if err != nil {
		log.Printf("apikeys.Issue error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	keys, err := h.svc.ListKeys(r.Context(), subscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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

// Revoke marks a key as revoked (soft-delete), scoped to the actor's
// subscription. Returns 404 (RFC 9457 problem+json) when the key UUID
// belongs to a different tenant — never confirm cross-tenant existence
// to an enumerating caller (PLA060 B16.10).
//
// Post PLA059 the route gate already denies API-key auth on /admin/api-keys/*,
// so we resolve the caller's subscription from the JWT user context only.
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	var req RevokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	if req.ID == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
		return
	}

	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	err := h.svc.Revoke(r.Context(), req.ID, user.SubscriptionID.String())
	if err != nil {
		if errors.Is(err, ErrKeyNotFound) {
			h.logRevoke(r, user, req.ID, "denied", "cross_tenant_or_missing")
			httperr.WriteCoded(w, r, http.StatusNotFound, "key_not_found", usermessages.NotFound)
			return
		}
		log.Printf("apikeys.Revoke error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	h.logRevoke(r, user, req.ID, "success", "")
	w.WriteHeader(http.StatusNoContent)
}

// logRevoke emits one audit row per revoke attempt (success or denied).
// outcome ∈ {"success","denied"}. reason is non-empty only on denial.
// For cross-tenant denials we also record the target key's owning
// subscription (resolved by a fresh lookup that bypasses the tenant
// filter) so the audit row carries both subscription IDs for forensics.
func (h *Handler) logRevoke(r *http.Request, user *roletypes.User, keyID, outcome, reason string) {
	if h.auditLog == nil {
		return
	}
	resource := "admin_api_keys"
	meta := map[string]any{
		"outcome": outcome,
	}
	if reason != "" {
		meta["reason"] = reason
	}
	// On cross-tenant denials, surface the target key's subscription
	// id for the forensic record. Best-effort: if the key never
	// existed the lookup returns "" and we skip the field.
	if outcome == "denied" && reason == "cross_tenant_or_missing" {
		if targetSub := h.svc.LookupOwningSubscription(r.Context(), keyID); targetSub != "" {
			meta["target_subscription_id"] = targetSub
			meta["actor_subscription_id"] = user.SubscriptionID.String()
		}
	}
	sub := user.SubscriptionID
	h.auditLog.Log(r.Context(), audit.Entry{
		UserID:         &user.ID,
		SubscriptionID: &sub,
		Action:         "api_key.revoke",
		Resource:       &resource,
		ResourceID:     &keyID,
		Metadata:       meta,
	})
}
