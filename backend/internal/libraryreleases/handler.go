// Package libraryreleases exposes the gadmin-facing HTTP surface for
// the mmff_library release-notification channel (Phase 3, plan §12).
//
//	GET  /api/library/releases              → list outstanding for caller's subscription
//	POST /api/library/releases/{id}/ack     → record ack + write audit row
//
// Both endpoints are gated by RequireRole(models.RoleGAdmin) at the
// router. Acks are stored in mmff_vector (subscription state) and
// reference release_id as an app-enforced FK into mmff_library.
package libraryreleases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Handler holds the two pools needed for the cross-DB workflow:
// libRO for release content (mmff_library), vectorPool for acks +
// audit log + the per-subscription tier lookup (mmff_vector).
//
// Reconciler is optional — when set, the count endpoint reads from
// the cache and Ack invalidates after a successful write. Tests can
// pass nil to skip the cache layer.
type Handler struct {
	LibRO      *pgxpool.Pool
	VectorPool *pgxpool.Pool
	Audit      *audit.Logger
	Reconciler *Reconciler
}

func NewHandler(libRO, vectorPool *pgxpool.Pool, auditLog *audit.Logger, rec *Reconciler) *Handler {
	return &Handler{LibRO: libRO, VectorPool: vectorPool, Audit: auditLog, Reconciler: rec}
}

// listResponse is the wire shape of GET /api/library/releases.
// Includes a count so the badge UI doesn't need to count locally.
type listResponse struct {
	Count    int           `json:"count"`
	Releases []releaseDTO  `json:"releases"`
}

type releaseDTO struct {
	ID                   uuid.UUID         `json:"id"`
	LibraryVersion       string            `json:"library_version"`
	Title                string            `json:"title"`
	SummaryMD            string            `json:"summary_md"`
	BodyMD               *string           `json:"body_md"`
	Severity             string            `json:"severity"`
	AffectsModelFamilyID *uuid.UUID        `json:"affects_model_family_id"`
	ReleasedAt           time.Time         `json:"released_at"`
	ExpiresAt            *time.Time        `json:"expires_at"`
	Actions              []actionDTO       `json:"actions"`
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
	Count int  `json:"count"`
	Fresh bool `json:"fresh"`
}

// Count — GET /api/library/releases/count
// Cheap badge endpoint: returns the cached outstanding count for the
// caller's subscription. On cold cache or miss, computes inline and
// warms the cache.
func (h *Handler) Count(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.Reconciler != nil {
		if n, fresh := h.Reconciler.Count(u.SubscriptionID); fresh {
			writeJSON(w, http.StatusOK, countResponse{Count: n, Fresh: true})
			return
		}
	}
	tier, err := h.subscriptionTier(r.Context(), u.SubscriptionID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if h.Reconciler != nil {
		h.Reconciler.Touch(r.Context(), u.SubscriptionID, tier)
		if n, _ := h.Reconciler.Count(u.SubscriptionID); true {
			writeJSON(w, http.StatusOK, countResponse{Count: n, Fresh: true})
			return
		}
	}
	// Fallback path (no reconciler wired): compute inline.
	n, err := librarydb.CountOutstandingForSubscription(
		r.Context(), h.LibRO, h.VectorPool, u.SubscriptionID, tier,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, countResponse{Count: n, Fresh: false})
}

// List — GET /api/library/releases
// Returns every active release the caller's subscription has not yet
// acknowledged. Caller MUST be authenticated; gadmin gating happens at
// the router layer.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tier, err := h.subscriptionTier(r.Context(), u.SubscriptionID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	releases, err := librarydb.ListReleasesSinceAck(
		r.Context(), h.LibRO, h.VectorPool, u.SubscriptionID, tier,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
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
// Body: {"action_taken": "<one of upgrade_model|review_terminology|enable_flag|dismissed>"}
// Returns 201 on first ack, 200 on idempotent re-ack.
func (h *Handler) Ack(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	releaseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid release id", http.StatusBadRequest)
		return
	}
	var body ackRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if !librarydb.IsValidAction(body.ActionTaken) {
		http.Error(w, "invalid action_taken", http.StatusBadRequest)
		return
	}

	// Validate the release id against mmff_library before writing the
	// ack — protects us from orphan ack rows when a stale URL gets
	// posted (no cross-DB FK to enforce this in Postgres).
	if _, err := librarydb.FindRelease(r.Context(), h.LibRO, releaseID); err != nil {
		if errors.Is(err, librarydb.ErrReleaseNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	created, err := librarydb.AckRelease(
		r.Context(), h.VectorPool,
		u.SubscriptionID, releaseID, u.ID, body.ActionTaken,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Invalidate the badge cache so the next poll recomputes.
	if created && h.Reconciler != nil {
		h.Reconciler.Invalidate(u.SubscriptionID)
	}

	// Audit only when a new ack lands — re-acks are no-ops and would
	// otherwise spam the audit log on every page reload.
	if created && h.Audit != nil {
		ip := clientIP(r)
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

// subscriptionTier loads the caller's tier from mmff_vector. Cached at
// the request scope — if it becomes a hot path we'll memoise per
// subscription_id with a TTL, but a single SELECT against the
// subscriptions PK is well under a millisecond.
func (h *Handler) subscriptionTier(ctx context.Context, subID uuid.UUID) (string, error) {
	var tier string
	err := h.VectorPool.QueryRow(ctx,
		`SELECT tier FROM subscriptions WHERE id = $1`, subID,
	).Scan(&tier)
	if err != nil {
		return "", fmt.Errorf("libraryreleases: load tier: %w", err)
	}
	return tier, nil
}

// clientIP extracts the best-known caller IP. RealIP middleware has
// already normalised X-Forwarded-For into RemoteAddr.
func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	// Strip port if present.
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
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
