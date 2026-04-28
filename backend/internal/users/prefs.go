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

// SetThemePack persists the user's selected theme pack. The frontend's
// read-side isValidPack() handles bad values by falling back to default,
// which is the only place validation matters (handles deleted/renamed
// themes gracefully). Writing whatever the user sends is harmless — it's
// just a string column rendered into a stylesheet href on read.
func (s *Service) SetThemePack(ctx context.Context, userID uuid.UUID, pack string) error {
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
