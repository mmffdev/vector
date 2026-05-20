package notifications

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/transport"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the bell + preferences over HTTP. Mounted on both
// /_site/notifications (BFF) and /samantha/v2/notifications (public).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List — GET /notifications?only_unread=true&limit=<n>
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	f := ListFilters{}
	if r.URL.Query().Get("only_unread") == "true" {
		f.OnlyUnread = true
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			f.Limit = n
		}
	}
	list, err := h.svc.List(r.Context(), user.SubscriptionID, user.ID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	if t, _ := transport.FromContext(r.Context()); t == transport.Public {
		mapped := make([]UserNotification, len(list))
		for i, n := range list {
			mapped[i] = MapPublicUserNotification(n)
		}
		list = mapped
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"notifications": list,
		"count":         len(list),
	})
}

// UnreadCount — GET /notifications/unread-count
func (h *Handler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	n, err := h.svc.UnreadCount(r.Context(), user.SubscriptionID, user.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"unread": n})
}

// MarkRead — POST /notifications/{id}/read
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.svc.MarkRead(r.Context(), id, user.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MarkAllRead — POST /notifications/read-all
func (h *Handler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	n, err := h.svc.MarkAllRead(r.Context(), user.SubscriptionID, user.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"marked_read": n})
}

// ListPrefs — GET /notifications/prefs
func (h *Handler) ListPrefs(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	prefs, err := h.svc.ListPrefs(r.Context(), user.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"prefs": prefs,
		"count": len(prefs),
	})
}

// UpsertPref — PUT /notifications/prefs
//
// Body: { "kind": "mention", "channel": "email", "enabled": false }
func (h *Handler) UpsertPref(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var body struct {
		Kind    string `json:"kind"`
		Channel string `json:"channel"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.svc.UpsertPref(r.Context(), user.ID, body.Kind, body.Channel, body.Enabled); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "channel", Message: err.Error()},
			})
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
