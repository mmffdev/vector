package mentions

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

// Handler exposes the mentions domain over HTTP. Mounted on both
// /_site/mentions (BFF) and /samantha/v2/mentions (public).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// SearchMentionables — GET /mentions/search?q=<prefix>&limit=<n>
//
// Returns up to `limit` users in the caller's subscription whose
// name/email starts with q. Honors the subscription's
// mentions_scope toggle (tenant | team).
func (h *Handler) SearchMentionables(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	q := r.URL.Query().Get("q")
	limit := 10
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}

	results, err := h.svc.SearchMentionables(r.Context(), user.SubscriptionID, user.ID, SearchFilters{
		Q:     q,
		Limit: limit,
	})
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	// Public transport projects through MapPublicMentionable per
	// PLA-0039 — shapes are currently identical, lint:public-dto-mapper
	// requires the seam.
	if t, _ := transport.FromContext(r.Context()); t == transport.Public {
		mapped := make([]Mentionable, len(results))
		for i, m := range results {
			mapped[i] = MapPublicMentionable(m)
		}
		results = mapped
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"mentionables": results,
		"count":        len(results),
	})
}

// Create — POST /mentions
//
// Body:
//   {
//     "mentioned_user_ids": ["<uuid>", ...],
//     "context_kind": "defect",
//     "context_id":   "DE-101",
//     "snippet":      "thoughts on this?"
//   }
//
// Returns the persisted mention rows (one per mentioned user).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	var body struct {
		MentionedUserIDs []string `json:"mentioned_user_ids"`
		ContextKind      string   `json:"context_kind"`
		ContextID        string   `json:"context_id"`
		Snippet          string   `json:"snippet"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	ids := make([]uuid.UUID, 0, len(body.MentionedUserIDs))
	for _, raw := range body.MentionedUserIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "mentioned_user_ids", Message: "invalid uuid: " + raw},
			})
			return
		}
		ids = append(ids, id)
	}

	created, err := h.svc.Create(r.Context(), CreateMentionInput{
		SubscriptionID:   user.SubscriptionID,
		WorkspaceID:      user.WorkspaceID,
		AuthorUserID:     user.ID,
		MentionedUserIDs: ids,
		Context:          Context{Kind: body.ContextKind, ID: body.ContextID},
		Snippet:          body.Snippet,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrUnresolvedContext):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "context_kind", Message: err.Error()},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}

	if t, _ := transport.FromContext(r.Context()); t == transport.Public {
		mapped := make([]Mention, len(created))
		for i, m := range created {
			mapped[i] = MapPublicMention(m)
		}
		created = mapped
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"mentions": created,
		"count":    len(created),
	})
}

// ListInbox — GET /mentions/inbox?only_unread=true&limit=<n>
//
// Returns the caller's mentions, newest first.
func (h *Handler) ListInbox(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	f := InboxFilters{}
	if r.URL.Query().Get("only_unread") == "true" {
		f.OnlyUnread = true
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			f.Limit = n
		}
	}

	mentions, err := h.svc.ListInbox(r.Context(), user.SubscriptionID, user.ID, f)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	if t, _ := transport.FromContext(r.Context()); t == transport.Public {
		mapped := make([]Mention, len(mentions))
		for i, m := range mentions {
			mapped[i] = MapPublicMention(m)
		}
		mentions = mapped
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"mentions": mentions,
		"count":    len(mentions),
	})
}

// MarkRead — POST /mentions/{id}/read
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	raw := chi.URLParam(r, "id")
	id, err := uuid.Parse(raw)
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
