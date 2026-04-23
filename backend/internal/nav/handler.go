package nav

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	Svc       *Service
	Bookmarks *Bookmarks
}

func NewHandler(s *Service, b *Bookmarks) *Handler { return &Handler{Svc: s, Bookmarks: b} }

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
		Catalogue: reg.CatalogFor(u.Role, u.TenantID),
		Tags:      reg.Tags(),
	})
}

type prefsResp struct {
	Prefs  []PrefRow     `json:"prefs"`
	Groups []CustomGroup `json:"groups"`
}

// GET /api/nav/prefs — this user's prefs + custom groups for their current tenant.
func (h *Handler) GetPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	rows, err := h.Svc.GetPrefs(r.Context(), u.ID, u.TenantID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	groups, err := h.Svc.GetCustomGroups(r.Context(), u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, prefsResp{Prefs: rows, Groups: groups})
}

type putPrefsReq struct {
	Pinned       []PinnedInput      `json:"pinned"`
	StartPageKey *string            `json:"start_page_key"`
	Groups       []CustomGroupInput `json:"groups"`
}

// PUT /api/nav/prefs — replace this user's prefs and custom groups atomically.
func (h *Handler) PutPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req putPrefsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ReplacePrefs(r.Context(), u.ID, u.TenantID, u.Role, req.Pinned, req.StartPageKey, req.Groups); err != nil {
		switch {
		case errors.Is(err, ErrUnknownItemKey),
			errors.Is(err, ErrNotPinnable),
			errors.Is(err, ErrRoleForbidden),
			errors.Is(err, ErrStartPageNotPinned),
			errors.Is(err, ErrBadPositions),
			errors.Is(err, ErrDuplicateKey),
			errors.Is(err, ErrTooManyPinned),
			errors.Is(err, ErrBadGrouping),
			errors.Is(err, ErrBadNesting),
			errors.Is(err, ErrCatalogueItemLocked),
			errors.Is(err, ErrUnknownGroup),
			errors.Is(err, ErrEmptyGroupLabel),
			errors.Is(err, ErrDuplicateGroupLabel),
			errors.Is(err, ErrTooManyGroups),
			errors.Is(err, ErrTooManyChildren),
			errors.Is(err, ErrGroupLabelTooLong):
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

type bookmarkReq struct {
	EntityKind string    `json:"entity_kind"`
	EntityID   uuid.UUID `json:"entity_id"`
}

type bookmarkResp struct {
	ItemKey string `json:"item_key"`
}

// POST /api/nav/bookmark — pin an entity for the caller.
func (h *Handler) PinBookmark(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req bookmarkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	key, err := h.Bookmarks.Pin(r.Context(), u.ID, u.TenantID, u.Role, EntityKind(req.EntityKind), req.EntityID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnknownEntityKind):
			http.Error(w, "invalid request", http.StatusBadRequest)
		case errors.Is(err, ErrEntityNotFound):
			// 404 doesn't leak existence — same response either way.
			http.Error(w, "not found", http.StatusNotFound)
		case errors.Is(err, ErrEntityArchived):
			http.Error(w, "archived", http.StatusConflict)
		case errors.Is(err, ErrBookmarkCap):
			http.Error(w, "cap reached", http.StatusConflict)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	writeJSON(w, http.StatusOK, bookmarkResp{ItemKey: key})
}

// DELETE /api/nav/bookmark — unpin an entity for the caller.
// Body shape mirrors PinBookmark to keep the client surface symmetric.
func (h *Handler) UnpinBookmark(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req bookmarkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Bookmarks.Unpin(r.Context(), u.ID, u.TenantID, EntityKind(req.EntityKind), req.EntityID); err != nil {
		switch {
		case errors.Is(err, ErrUnknownEntityKind):
			http.Error(w, "invalid request", http.StatusBadRequest)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bookmarkCheckResp struct {
	Pinned bool `json:"pinned"`
}

// GET /api/nav/bookmark/check?entity_kind=...&entity_id=... — drives pin button state.
func (h *Handler) CheckBookmark(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	q := r.URL.Query()
	kind := EntityKind(q.Get("entity_kind"))
	id, err := uuid.Parse(q.Get("entity_id"))
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	pinned, err := h.Bookmarks.IsPinned(r.Context(), u.ID, u.TenantID, kind, id)
	if err != nil {
		if errors.Is(err, ErrUnknownEntityKind) {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, bookmarkCheckResp{Pinned: pinned})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
