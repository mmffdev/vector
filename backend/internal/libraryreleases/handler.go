// Package libraryreleases exposes the gadmin-facing HTTP surface for
// the mmff_library release-notification channel (Phase 3, plan §12).
//
//	GET  /api/library/releases              → list outstanding for caller's subscription
//	POST /api/library/releases/{id}/ack     → record ack + write audit row
//
// Both endpoints are gated by RequirePermission(MenuAdminView) at the
// router (PLA-0007). Acks are stored in mmff_vector (subscription state) and
// reference release_id as an app-enforced FK into mmff_library.
//
// All DB I/O lives in libraryreleases.Service (service.go); this
// handler is parse + auth + svc.Method + render only —
// `lint:no-db-in-handlers` enforces it.
package libraryreleases

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/messages"
	"github.com/mmffdev/vector-backend/internal/security"
)

// Handler is the chi-mountable HTTP surface. Every DB call goes
// through Svc.
//
// Reconciler is optional — when set, the count endpoint reads from the
// cache and Ack invalidates after a successful write. Tests can pass
// nil to skip the cache layer.
type Handler struct {
	Svc        *Service
	Audit      *audit.Logger
	Reconciler *Reconciler
}

// NewHandler wires the handler around an existing Service.
func NewHandler(svc *Service, auditLog *audit.Logger, rec *Reconciler) *Handler {
	return &Handler{Svc: svc, Audit: auditLog, Reconciler: rec}
}

// listResponse is the wire shape of GET /api/library/releases.
type listResponse struct {
	Count    int          `json:"count"`
	Releases []releaseDTO `json:"releases"`
}

type releaseDTO struct {
	ID                   uuid.UUID   `json:"id"`
	LibraryVersion       string      `json:"library_version"`
	Title                string      `json:"title"`
	SummaryMD            string      `json:"summary_md"`
	BodyMD               *string     `json:"body_md"`
	Severity             string      `json:"severity"`
	AffectsModelFamilyID *uuid.UUID  `json:"affects_model_family_id"`
	ReleasedAt           time.Time   `json:"released_at"`
	ExpiresAt            *time.Time  `json:"expires_at"`
	Actions              []actionDTO `json:"actions"`
}

type actionDTO struct {
	ID        uuid.UUID       `json:"id"`
	ActionKey string          `json:"action_key"`
	Label     string          `json:"label"`
	Payload   json.RawMessage `json:"payload"`
	SortOrder int32           `json:"sort_order"`
}

type ackRequest struct {
	ActionTaken string `json:"action_taken"`
}

type ackResponse struct {
	AcknowledgedAt time.Time `json:"acknowledged_at"`
	Created        bool      `json:"created"` // true on first ack, false on idempotent re-ack
}

type countResponse struct {
	Count       int  `json:"count"`
	HasBlocking bool `json:"has_blocking"`
	Fresh       bool `json:"fresh"`
}

// Count — GET /api/library/releases/count
func (h *Handler) Count(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	if h.Reconciler != nil {
		if n, blocking, fresh := h.Reconciler.Count(u.SubscriptionID); fresh {
			writeJSON(w, http.StatusOK, countResponse{Count: n, HasBlocking: blocking, Fresh: true})
			return
		}
	}
	tier, err := h.Svc.SubscriptionTier(r.Context(), u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	if h.Reconciler != nil {
		h.Reconciler.Touch(r.Context(), u.SubscriptionID, tier)
		n, blocking, _ := h.Reconciler.Count(u.SubscriptionID)
		writeJSON(w, http.StatusOK, countResponse{Count: n, HasBlocking: blocking, Fresh: true})
		return
	}
	n, blocking, err := h.Svc.CountOutstanding(r.Context(), u.SubscriptionID, tier)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, countResponse{Count: n, HasBlocking: blocking, Fresh: false})
}

// List — GET /api/library/releases
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	tier, err := h.Svc.SubscriptionTier(r.Context(), u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	releases, err := h.Svc.ListSinceAck(r.Context(), u.SubscriptionID, tier)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	resp := listResponse{
		Count:    len(releases),
		Releases: make([]releaseDTO, 0, len(releases)),
	}
	for _, rel := range releases {
		resp.Releases = append(resp.Releases, toReleaseDTO(rel))
	}
	writeJSON(w, http.StatusOK, resp)
}

// Ack — POST /api/library/releases/{id}/ack
func (h *Handler) Ack(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	releaseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}
	var body ackRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	if !librarydb.IsValidAction(body.ActionTaken) {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestBadRequest)
		return
	}
	if err := h.Svc.FindRelease(r.Context(), releaseID); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	created, err := h.Svc.AckRelease(r.Context(), u.SubscriptionID, releaseID, u.ID, body.ActionTaken)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	if created && h.Reconciler != nil {
		h.Reconciler.Invalidate(u.SubscriptionID)
	}
	if created && h.Audit != nil {
		ip := security.ClientIP(r)
		resourceID := releaseID.String()
		resource := "library_release"
		userID := u.ID
		subID := u.SubscriptionID
		h.Audit.Log(r.Context(), audit.Entry{
			UserID:         &userID,
			SubscriptionID: &subID,
			Action:         "library_release.ack",
			Resource:       &resource,
			ResourceID:     &resourceID,
			Metadata:       map[string]any{"action_taken": body.ActionTaken},
			IPAddress:      &ip,
		})
	}

	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, ackResponse{
		AcknowledgedAt: time.Now().UTC(),
		Created:        created,
	})
}

func toReleaseDTO(r librarydb.Release) releaseDTO {
	out := releaseDTO{
		ID:                   r.ID,
		LibraryVersion:       r.LibraryVersion,
		Title:                r.Title,
		SummaryMD:            r.SummaryMD,
		BodyMD:               r.BodyMD,
		Severity:             r.Severity,
		AffectsModelFamilyID: r.AffectsModelFamilyID,
		ReleasedAt:           r.ReleasedAt,
		ExpiresAt:            r.ExpiresAt,
		Actions:              make([]actionDTO, 0, len(r.Actions)),
	}
	for _, a := range r.Actions {
		out.Actions = append(out.Actions, actionDTO{
			ID:        a.ID,
			ActionKey: a.ActionKey,
			Label:     a.Label,
			Payload:   jsonbOrNull(a.Payload),
			SortOrder: a.SortOrder,
		})
	}
	return out
}

func jsonbOrNull(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("null")
	}
	return json.RawMessage(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
