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

// Allowed theme-pack values must match the CHECK constraint in
// db/schema/039_user_theme_pack.sql AND the file basenames in
// /public/themes/. Keep all three in sync when adding a new pack.
var validThemePacks = map[string]struct{}{
	"default":     {},
	"vector-mono": {},
}

var ErrInvalidThemePack = errors.New("invalid theme pack")

// GetThemePack returns the user's currently-selected theme pack.
// Falls back to "default" if the column is NULL (defensive — the
// migration sets NOT NULL DEFAULT 'default', but a future ALTER
// could relax it).
func (s *Service) GetThemePack(ctx context.Context, userID uuid.UUID) (string, error) {
	var pack *string
	err := s.Pool.QueryRow(ctx,
		`SELECT theme_pack FROM users WHERE id = $1`, userID,
	).Scan(&pack)
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

// SetThemePack persists the user's selected theme pack. Validates
// against the allow-list before touching the DB so a bad payload
// never reaches Postgres (the CHECK constraint is the safety net,
// not the primary gate).
func (s *Service) SetThemePack(ctx context.Context, userID uuid.UUID, pack string) error {
	if _, ok := validThemePacks[pack]; !ok {
		return ErrInvalidThemePack
	}
	tag, err := s.Pool.Exec(ctx,
		`UPDATE users SET theme_pack = $1, updated_at = NOW() WHERE id = $2`,
		pack, userID,
	)
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

// SetThemePack accepts { "pack": "<id>" } and writes it to the user row.
// Returns 204 on success, 400 on unknown pack, 401 if unauthenticated.
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
		if errors.Is(err, ErrInvalidThemePack) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
