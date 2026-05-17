package users

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// ── Active scope ─────────────────────────────────────────────────────────────

// GetThemePack returns the user's currently-selected theme pack.
// Falls back to "default" if the column is NULL (defensive — the
// migration sets NOT NULL DEFAULT 'default', but a future ALTER
// could relax it).
func (s *Service) GetThemePack(ctx context.Context, userID uuid.UUID) (string, error) {
	var pack *string
	err := s.Pool.QueryRow(ctx, sqlSelectUserThemePack, userID).Scan(&pack)
	if err == pgx.ErrNoRows {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if pack == nil || *pack == "" {
		return "default", nil
	}
	return *pack, nil
}

// SetThemePack persists the user's selected theme pack. The frontend's
// read-side isValidPack() handles bad values by falling back to default,
// which is the only place validation matters (handles deleted/renamed
// themes gracefully). Writing whatever the user sends is harmless — it's
// just a string column rendered into a stylesheet href on read.
func (s *Service) SetThemePack(ctx context.Context, userID uuid.UUID, pack string) error {
	tag, err := s.Pool.Exec(ctx, sqlUpdateUserThemePack, pack, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type themePackResp struct {
	Pack string `json:"pack"`
}

type themePackReq struct {
	Pack string `json:"pack"`
}

// GetThemePack returns { "pack": "<id>" } for the authenticated user.
func (h *Handler) GetThemePack(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	pack, err := h.Svc.GetThemePack(r.Context(), actor.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, themePackResp{Pack: pack})
}

// GetActiveScope returns the user's last-selected scope node ID, or null.
func (s *Service) GetActiveScope(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	var nodeID *uuid.UUID
	err := s.Pool.QueryRow(ctx, sqlSelectUserActiveScope, userID).Scan(&nodeID)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return nodeID, nil
}

// SetActiveScope persists the user's active scope node. Pass nil to clear.
// When nodeID is non-nil, the caller must hold an active grant on that node —
// enforced here so a user cannot store an arbitrary node ID they have no
// access to (backend validation golden rule).
func (s *Service) SetActiveScope(ctx context.Context, userID uuid.UUID, nodeID *uuid.UUID) error {
	if nodeID != nil {
		var hasGrant bool
		if err := s.Pool.QueryRow(ctx, sqlUserHasGrantOnNode, *nodeID, userID).Scan(&hasGrant); err != nil {
			return err
		}
		if !hasGrant {
			return ErrScopeNotGranted
		}
	}
	tag, err := s.Pool.Exec(ctx, sqlUpdateUserActiveScope, nodeID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type activeScopeResp struct {
	NodeID *string `json:"node_id"`
}

type activeScopeReq struct {
	NodeID *string `json:"node_id"`
}

// GetActiveScope returns { "node_id": "<uuid>" | null } for the authenticated user.
func (h *Handler) GetActiveScope(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	nodeID, err := h.Svc.GetActiveScope(r.Context(), actor.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var s *string
	if nodeID != nil {
		v := nodeID.String()
		s = &v
	}
	writeJSON(w, http.StatusOK, activeScopeResp{NodeID: s})
}

// SetActiveScope accepts { "node_id": "<uuid>" | null } and writes it to the user row.
func (h *Handler) SetActiveScope(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req activeScopeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var nodeID *uuid.UUID
	if req.NodeID != nil {
		parsed, err := uuid.Parse(*req.NodeID)
		if err != nil {
			http.Error(w, "invalid node_id", http.StatusBadRequest)
			return
		}
		nodeID = &parsed
	}
	if err := h.Svc.SetActiveScope(r.Context(), actor.ID, nodeID); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrScopeNotGranted) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetThemePack accepts { "pack": "<id>" } and writes it to the user row.
// Returns 204 on success, 401 if unauthenticated, 404 if user row missing.
func (h *Handler) SetThemePack(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req themePackReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.SetThemePack(r.Context(), actor.ID, req.Pack); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
