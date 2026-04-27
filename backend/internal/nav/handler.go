package nav

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/models"
)

type Handler struct {
	Svc         *Service
	Bookmarks   *Bookmarks
	CustomPages *custompages.Service
}

func NewHandler(s *Service, b *Bookmarks, cp *custompages.Service) *Handler {
	return &Handler{Svc: s, Bookmarks: b, CustomPages: cp}
}

type catalogueResp struct {
	Catalogue []CatalogEntry `json:"catalogue"`
	Tags      []TagGroup     `json:"tags"`
}

// GET /api/nav/catalogue — catalogue filtered by caller's role, plus tag groups.
// User-authored custom pages are merged in as kind="user_custom" entries
// keyed "custom:<page.id>" with href "/p/<page.id>".
func (h *Handler) Catalogue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	reg, err := h.Svc.Registry.Get(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	cat := reg.CatalogFor(u.Role, u.SubscriptionID)

	extras, err := h.customPageEntriesFor(r.Context(), u.ID, u.SubscriptionID, u.Role)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	for _, e := range extras {
		cat = append(cat, e)
	}

	writeJSON(w, http.StatusOK, catalogueResp{
		Catalogue: cat,
		Tags:      reg.Tags(),
	})
}

type prefsResp struct {
	ProfileID uuid.UUID     `json:"profile_id"`
	Prefs     []PrefRow     `json:"prefs"`
	Groups    []CustomGroup `json:"groups"`
}

// parseProfileQuery reads ?profile_id=<uuid>. Returns (nil, nil) when
// the param is absent (caller's signal to resolve implicitly).
// (badParam, nil) is reported as a 400 by the caller.
func parseProfileQuery(r *http.Request) (*uuid.UUID, error) {
	raw := r.URL.Query().Get("profile_id")
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// GET /api/nav/prefs[?profile_id=<uuid>] — prefs + groups for the
// resolved profile. profile_id query param is optional; when omitted,
// the active profile is used (falls back to Default, lazy-seeds if
// missing). Response always includes the concrete profile_id used.
func (h *Handler) GetPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	explicit, err := parseProfileQuery(r)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	pid, err := h.Svc.ResolveProfile(r.Context(), u.ID, u.SubscriptionID, explicit)
	if err != nil {
		if errors.Is(err, ErrProfileNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	rows, err := h.Svc.GetPrefsForProfile(r.Context(), u.ID, u.SubscriptionID, u.Role, pid)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	groups, err := h.Svc.GetCustomGroups(r.Context(), u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, prefsResp{ProfileID: pid, Prefs: rows, Groups: groups})
}

type putPrefsReq struct {
	ProfileID    *uuid.UUID         `json:"profile_id,omitempty"`
	Pinned       []PinnedInput      `json:"pinned"`
	StartPageKey *string            `json:"start_page_key"`
	Groups       []CustomGroupInput `json:"groups"`
}

// PUT /api/nav/prefs — replace prefs (and, when targeting Default,
// the shared group pool) atomically. profile_id in the body is
// optional; absent means "use the resolved profile" (active → Default
// → lazy-seed). When a non-default profile is targeted, the groups
// payload MUST be empty — group placements on non-default profiles
// flow through B6's dedicated surface, not this endpoint.
func (h *Handler) PutPrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req putPrefsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	pid, err := h.Svc.ResolveProfile(r.Context(), u.ID, u.SubscriptionID, req.ProfileID)
	if err != nil {
		if errors.Is(err, ErrProfileNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	extraEntries, err := h.customPageEntriesFor(r.Context(), u.ID, u.SubscriptionID, u.Role)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := h.Svc.ReplacePrefsForProfile(r.Context(), u.ID, u.SubscriptionID, u.Role, req.Pinned, req.StartPageKey, req.Groups, extraEntries, pid); err != nil {
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

// DELETE /api/nav/prefs[?profile_id=<uuid>] — reset prefs.
//
// No profile_id (legacy "Reset to defaults"): resolves to the user's
// home profile, wipes its prefs, and — only if it's Default — wipes
// the shared group pool too. This preserves the legacy modal's reset
// semantics.
//
// With profile_id: scoped reset of just that profile's prefs. Never
// touches the shared group pool. Use this from per-profile UI.
func (h *Handler) DeletePrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	explicit, err := parseProfileQuery(r)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if explicit != nil {
		if err := h.Svc.DeletePrefsForProfile(r.Context(), u.ID, u.SubscriptionID, *explicit); err != nil {
			if errors.Is(err, ErrProfileNotFound) {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := h.Svc.DeletePrefs(r.Context(), u.ID, u.SubscriptionID); err != nil {
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
	href, ok, err := h.Svc.GetStartPageHref(r.Context(), u.ID, u.SubscriptionID, u.Role)
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
	key, err := h.Bookmarks.Pin(r.Context(), u.ID, u.SubscriptionID, u.Role, EntityKind(req.EntityKind), req.EntityID)
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
	if err := h.Bookmarks.Unpin(r.Context(), u.ID, u.SubscriptionID, EntityKind(req.EntityKind), req.EntityID); err != nil {
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
	pinned, err := h.Bookmarks.IsPinned(r.Context(), u.ID, u.SubscriptionID, kind, id)
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

// customPageEntriesFor returns the caller's custom pages as synthetic
// CatalogEntry rows keyed "custom:<page.id>". The map lets prefs validation
// resolve user_custom keys that aren't in the shared registry.
func (h *Handler) customPageEntriesFor(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	role models.Role,
) (map[string]CatalogEntry, error) {
	if h.CustomPages == nil {
		return nil, nil
	}
	pages, err := h.CustomPages.ListPagesOnly(ctx, userID, subscriptionID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]CatalogEntry, len(pages))
	for _, p := range pages {
		key := fmt.Sprintf("custom:%s", p.ID)
		out[key] = CatalogEntry{
			Key:      key,
			Label:    p.Label,
			Href:     fmt.Sprintf("/p/%s", p.ID),
			Kind:     KindUserCustom,
			Roles:    []models.Role{role},
			Pinnable: true,
			Icon:     p.Icon,
			TagEnum:  "personal",
		}
	}
	return out, nil
}

// ---- profiles -------------------------------------------------------

type profilesResp struct {
	Profiles []Profile `json:"profiles"`
}

// GET /api/nav/profiles — list this user's profiles for the current subscription.
func (h *Handler) ListProfiles(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	profs, err := h.Svc.ListProfiles(r.Context(), u.ID, u.SubscriptionID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, profilesResp{Profiles: profs})
}

type createProfileReq struct {
	Label string `json:"label"`
}

// POST /api/nav/profiles — create a new (non-default) profile.
func (h *Handler) CreateProfile(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createProfileReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	p, err := h.Svc.CreateProfile(r.Context(), u.ID, u.SubscriptionID, req.Label)
	if err != nil {
		switch {
		case errors.Is(err, ErrProfileLabelEmpty),
			errors.Is(err, ErrProfileLabelTooLong):
			http.Error(w, "invalid request", http.StatusBadRequest)
		case errors.Is(err, ErrDuplicateProfileLabel):
			http.Error(w, "duplicate label", http.StatusConflict)
		case errors.Is(err, ErrTooManyProfiles):
			http.Error(w, "cap reached", http.StatusConflict)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

type renameProfileReq struct {
	Label string `json:"label"`
}

// PATCH /api/nav/profiles/{id} — rename a profile.
func (h *Handler) RenameProfile(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	var req renameProfileReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.RenameProfile(r.Context(), u.ID, u.SubscriptionID, id, req.Label); err != nil {
		switch {
		case errors.Is(err, ErrProfileLabelEmpty),
			errors.Is(err, ErrProfileLabelTooLong):
			http.Error(w, "invalid request", http.StatusBadRequest)
		case errors.Is(err, ErrDuplicateProfileLabel):
			http.Error(w, "duplicate label", http.StatusConflict)
		case errors.Is(err, ErrProfileNotFound):
			http.Error(w, "not found", http.StatusNotFound)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/nav/profiles/{id} — delete a non-default profile.
func (h *Handler) DeleteProfile(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.DeleteProfile(r.Context(), u.ID, u.SubscriptionID, id); err != nil {
		switch {
		case errors.Is(err, ErrProfileNotFound):
			http.Error(w, "not found", http.StatusNotFound)
		case errors.Is(err, ErrCannotDeleteDefault):
			http.Error(w, "cannot delete default", http.StatusConflict)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type reorderProfilesReq struct {
	Order []uuid.UUID `json:"order"`
}

// PUT /api/nav/profiles/order — batch reorder. Body: {"order": [id, id, ...]}.
func (h *Handler) ReorderProfiles(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req reorderProfilesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ReorderProfiles(r.Context(), u.ID, u.SubscriptionID, req.Order); err != nil {
		switch {
		case errors.Is(err, ErrBadPositions):
			http.Error(w, "invalid request", http.StatusBadRequest)
		case errors.Is(err, ErrProfileNotFound):
			http.Error(w, "not found", http.StatusNotFound)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setActiveProfileReq struct {
	ProfileID uuid.UUID `json:"profile_id"`
}

// PUT /api/nav/profiles/active — pin the user's active profile.
func (h *Handler) SetActiveProfile(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req setActiveProfileReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.SetActiveProfile(r.Context(), u.ID, u.SubscriptionID, req.ProfileID); err != nil {
		switch {
		case errors.Is(err, ErrProfileNotFound):
			http.Error(w, "not found", http.StatusNotFound)
		case errors.Is(err, ErrProfileWrongSubscription):
			http.Error(w, "wrong subscription", http.StatusConflict)
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
