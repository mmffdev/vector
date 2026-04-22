package nav

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct{ Svc *Service }

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type catalogueResp struct {
	Catalogue []CatalogEntry `json:"catalogue"`
	Tags      []TagGroup     `json:"tags"`
}

// GET /api/nav/catalogue — catalogue filtered by caller's role, plus tag groups.
func (h *Handler) Catalogue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	reg, err := h.Svc.Registry.Get(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, catalogueResp{
		Catalogue: reg.CatalogFor(u.Role),
		Tags:      reg.Tags(),
	})
}

type prefsResp struct {
	Prefs []PrefRow `json:"prefs"`
}

// GET /api/nav/prefs — this user's prefs for their current tenant.
func (h *Handler) GetPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	rows, err := h.Svc.GetPrefs(r.Context(), u.ID, u.TenantID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, prefsResp{Prefs: rows})
}

type putPrefsReq struct {
	Pinned       []PinnedInput `json:"pinned"`
	StartPageKey *string       `json:"start_page_key"`
}

// PUT /api/nav/prefs — replace this user's prefs.
func (h *Handler) PutPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req putPrefsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ReplacePrefs(r.Context(), u.ID, u.TenantID, u.Role, req.Pinned, req.StartPageKey); err != nil {
		switch {
		case errors.Is(err, ErrUnknownItemKey),
			errors.Is(err, ErrNotPinnable),
			errors.Is(err, ErrRoleForbidden),
			errors.Is(err, ErrStartPageNotPinned),
			errors.Is(err, ErrBadPositions),
			errors.Is(err, ErrDuplicateKey),
			errors.Is(err, ErrTooManyPinned),
			errors.Is(err, ErrBadGrouping):
			// Generic 400 — do not echo the offending key back to the client.
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/nav/prefs — wipe this user's prefs (reset to defaults).
func (h *Handler) DeletePrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if err := h.Svc.DeletePrefs(r.Context(), u.ID, u.TenantID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type startPageResp struct {
	Href string `json:"href"`
}

// GET /api/nav/start-page — resolved href, falls back to /dashboard.
func (h *Handler) StartPage(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	href, ok, err := h.Svc.GetStartPageHref(r.Context(), u.ID, u.TenantID, u.Role)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !ok {
		href = "/dashboard"
	}
	writeJSON(w, http.StatusOK, startPageResp{Href: href})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
