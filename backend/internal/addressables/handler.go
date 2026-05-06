package addressables

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
)

// Handler exposes the addressables Service over chi.
//
// Auth posture (intentional and per AC8/9/10):
//   - /api/addressables/build-reconcile is gated by a CI service-account
//     token via the X-CI-Token header. The token value is configured at
//     handler construction (typically from CI_SERVICE_TOKEN env). Empty
//     configured token disables the route entirely (returns 503).
//   - /api/addressables/register is open in non-production (NODE_ENV !=
//     production sense — here driven by inProduction passed to the
//     Service). In production the caller MUST supply X-Custom-App-Token
//     matching a configured value. The request body's source field is
//     restricted to 'runtime' (dev) or 'custom_app' (must come with a
//     valid custom-app token AND a custom_app_id).
//   - /api/addressables/snapshot and /api/page-help/:addressable_id are
//     read-only and intentionally unauthenticated — the data is non-
//     sensitive scaffold metadata used by the runtime DomRegistry. The
//     mounting page already gates the user; exposing the substrate's
//     shape adds no privilege.
type Handler struct {
	Svc *Service

	// CI service-account token. Empty disables build-reconcile.
	ciToken string

	// Optional shared token granting custom-app registration in production.
	// Empty disables custom-app registration in production. Dev/staging do
	// not require a token — the inProduction flag on Service controls that.
	customAppToken string
}

// NewHandler wires the Service to its HTTP surface. ciToken and
// customAppToken come from the caller (typically env-derived in main.go).
func NewHandler(s *Service, ciToken, customAppToken string) *Handler {
	return &Handler{Svc: s, ciToken: ciToken, customAppToken: customAppToken}
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/addressables/build-reconcile
// ─────────────────────────────────────────────────────────────────────

type buildReconcileReq struct {
	PageRoute string       `json:"page_route"`
	Slot      string       `json:"slot"`
	Tree      []BuildNode  `json:"tree"`
}

type buildReconcileResp struct {
	Inserted  int      `json:"inserted"`
	Archived  int      `json:"archived"`
	Unchanged int      `json:"unchanged"`
	Addresses []string `json:"addresses"`
}

// BuildReconcile receives a tree of build-declared addressables for one
// route+slot and reconciles the registry. Counts are returned for the
// CI script's log line.
func (h *Handler) BuildReconcile(w http.ResponseWriter, r *http.Request) {
	if h.ciToken == "" {
		httperr.Write(w, r, http.StatusServiceUnavailable, "build-reconcile disabled (no CI token configured)")
		return
	}
	if r.Header.Get("X-CI-Token") != h.ciToken {
		httperr.Write(w, r, http.StatusUnauthorized, "invalid CI token")
		return
	}

	var req buildReconcileReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.PageRoute) == "" {
		httperr.Write(w, r, http.StatusBadRequest, "page_route required")
		return
	}
	slot, err := ParseSlot(req.Slot)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid slot")
		return
	}

	addresses, counts, err := h.Svc.RegisterFromBuildWithCounts(r.Context(), req.PageRoute, slot, req.Tree)
	if err != nil {
		writeServiceErr(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, buildReconcileResp{
		Inserted:  counts.Inserted,
		Archived:  counts.Archived,
		Unchanged: counts.Unchanged,
		Addresses: addresses,
	})
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/addressables/register
// ─────────────────────────────────────────────────────────────────────

type registerReq struct {
	PageRoute     string  `json:"page_route"`
	ParentAddress string  `json:"parent_address"`
	Slot          string  `json:"slot"`
	Kind          string  `json:"kind"`
	Name          string  `json:"name"`
	Source        string  `json:"source"`         // 'runtime' | 'custom_app'
	CustomAppID   *string `json:"custom_app_id"`  // required when source='custom_app'
}

type registerResp struct {
	ID       string `json:"id"`
	Address  string `json:"address"`
	Helpable bool   `json:"helpable"`
}

// Register inserts a single runtime / custom_app addressable. See
// the package-level handler doc for the full auth contract.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	source, err := ParseSource(req.Source)
	if err != nil || source == SourceBuild {
		httperr.Write(w, r, http.StatusBadRequest, "source must be 'runtime' or 'custom_app'")
		return
	}

	// Production gating. inProduction is set on the Service at construction
	// from APP_ENV; mirroring it here keeps the handler stateless about env.
	if h.Svc.inProduction {
		// custom_app source requires a configured matching token.
		if source == SourceCustomApp {
			if h.customAppToken == "" || r.Header.Get("X-Custom-App-Token") != h.customAppToken {
				httperr.Write(w, r, http.StatusForbidden, "custom-app token required in production")
				return
			}
		}
		// runtime source is unconditionally refused in production. The
		// Service enforces this too — handler check returns 403 directly.
		if source == SourceRuntime {
			httperr.Write(w, r, http.StatusForbidden, "runtime registration refused in production")
			return
		}
	}

	slot, err := ParseSlot(req.Slot)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid slot")
		return
	}
	if strings.TrimSpace(req.PageRoute) == "" {
		httperr.Write(w, r, http.StatusBadRequest, "page_route required")
		return
	}

	var customAppID *uuid.UUID
	if source == SourceCustomApp {
		if req.CustomAppID == nil || *req.CustomAppID == "" {
			httperr.Write(w, r, http.StatusBadRequest, "custom_app_id required for source='custom_app'")
			return
		}
		id, err := uuid.Parse(*req.CustomAppID)
		if err != nil {
			httperr.Write(w, r, http.StatusBadRequest, "invalid custom_app_id")
			return
		}
		customAppID = &id
	}

	addr, err := h.Svc.RegisterFromRuntime(r.Context(), req.PageRoute, req.ParentAddress, slot, req.Kind, req.Name, source, customAppID)
	if err != nil {
		writeServiceErr(w, r, err)
		return
	}

	// Look up the row id + helpable for the canonical address so the
	// caller can pin a stable handle (e.g. for help-popover wiring) and
	// honour the per-row helpable bit without a follow-up snapshot.
	id, helpable, err := h.Svc.lookupRowByAddress(r.Context(), req.PageRoute, addr)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, registerResp{ID: id.String(), Address: addr, Helpable: helpable})
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/addressables/snapshot?route=…
// ─────────────────────────────────────────────────────────────────────

// Snapshot returns the live tree for the route. The list is already
// ordered by address (depth-first because addresses are
// lexicographically prefix-ordered by their parent address).
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	route := r.URL.Query().Get("route")
	if strings.TrimSpace(route) == "" {
		httperr.Write(w, r, http.StatusBadRequest, "route query param required")
		return
	}
	out, err := h.Svc.Snapshot(r.Context(), route)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/page-help/:addressable_id
// ─────────────────────────────────────────────────────────────────────

type helpResp struct {
	AddressableID string          `json:"addressable_id"`
	Locale        string          `json:"locale"`
	Title         *string         `json:"title,omitempty"`
	BodyHTML      string          `json:"body_html"`
	VideoEmbeds   json.RawMessage `json:"video_embeds"`
	ImageURLs     json.RawMessage `json:"image_urls"`
}

// PageHelp returns the live page_help row for an addressable.
// 404 when the addressable does not exist for any route. When the
// addressable exists but has no page_help row, the response carries
// an empty body and empty arrays — the caller treats absence of copy
// as "no help".
func (h *Handler) PageHelp(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "addressable_id")
	id, err := uuid.Parse(raw)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid addressable id")
		return
	}
	locale := r.URL.Query().Get("locale")
	if locale == "" {
		locale = "en"
	}

	exists, err := h.Svc.addressableExists(r.Context(), id)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	if !exists {
		httperr.Write(w, r, http.StatusNotFound, "addressable not found")
		return
	}

	doc, _, err := h.Svc.HelpFor(r.Context(), id, locale)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, helpResp{
		AddressableID: id.String(),
		Locale:        locale,
		Title:         doc.Title,
		BodyHTML:      doc.BodyHTML,
		VideoEmbeds:   doc.VideoEmbeds,
		ImageURLs:     doc.ImageURLs,
	})
}

// ─────────────────────────────────────────────────────────────────────
// /api/page-help admin (gadmin-only — story 00253)
// ─────────────────────────────────────────────────────────────────────

// PageHelpAdminList returns every live page_help row joined to its
// addressable. Gadmin-equivalent — gate with auth.RequirePermission
// (MenuAdminView) at the router (PLA-0007).
func (h *Handler) PageHelpAdminList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Svc.AdminListHelp(r.Context())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

type pageHelpPutReq struct {
	Locale      string          `json:"locale"`
	Title       *string         `json:"title,omitempty"`
	Body        string          `json:"body"`
	VideoEmbeds json.RawMessage `json:"video_embeds,omitempty"`
	ImageURLs   json.RawMessage `json:"image_urls,omitempty"`
}

// PageHelpAdminPut writes the full document (title + body + videos +
// images) for the (addressable, locale) live row via the Service.
// PUT semantics: every field is overwritten; absent video_embeds /
// image_urls are treated as `[]`. Gadmin-only.
func (h *Handler) PageHelpAdminPut(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "addressable_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid addressable id")
		return
	}
	var req pageHelpPutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateHelpRichContent(req.VideoEmbeds, req.ImageURLs); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	update := HelpUpdate{
		Title:       req.Title,
		BodyHTML:    SanitiseHelpBodyHTML(req.Body),
		VideoEmbeds: req.VideoEmbeds,
		ImageURLs:   req.ImageURLs,
	}
	if err := h.Svc.UpdateHelp(r.Context(), id, req.Locale, update, u.ID); err != nil {
		if errors.Is(err, ErrParentNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "no live page_help row for addressable+locale")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"addressable_id": id.String()})
}

// PageHelpAdminDelete soft-archives the live page_help row for
// (addressable, locale). The addressable itself is untouched.
// Gadmin-only.
func (h *Handler) PageHelpAdminDelete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "addressable_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid addressable id")
		return
	}
	locale := r.URL.Query().Get("locale")
	if err := h.Svc.ArchiveHelp(r.Context(), id, locale, u.ID); err != nil {
		if errors.Is(err, ErrParentNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "no live page_help row for addressable+locale")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/addressables/admin/:id/helpable  (gadmin — story 00265)
// ─────────────────────────────────────────────────────────────────────

type helpableReq struct {
	Helpable bool `json:"helpable"`
}

// AdminUpdateHelpable flips the per-row helpable bit on an addressable.
// Gadmin-equivalent — gate with auth.RequirePermission(MenuAdminView)
// at the router (PLA-0007).
func (h *Handler) AdminUpdateHelpable(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid addressable id")
		return
	}
	var req helpableReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.Svc.UpdateHelpable(r.Context(), id, req.Helpable); err != nil {
		if errors.Is(err, ErrParentNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "addressable not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id.String(), "helpable": req.Helpable})
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// validateHelpRichContent enforces shape + URL allowlists on the
// rich-content arrays before they reach the Service. Returns nil for
// nil/empty inputs (the Service treats them as `[]`).
//
// Allowlists:
//   - video_embeds[*].url: must parse via ValidateYouTubeURL (sanitise.go).
//   - image_urls[*].url:    must be http:// or https://.
func validateHelpRichContent(videos, images json.RawMessage) error {
	if len(videos) > 0 {
		var rows []map[string]any
		if err := json.Unmarshal(videos, &rows); err != nil {
			return errors.New("video_embeds must be a JSON array of objects")
		}
		for _, row := range rows {
			u, _ := row["url"].(string)
			if _, err := ValidateYouTubeURL(u); err != nil {
				return errors.New("video_embeds[].url must be a youtube.com or youtu.be video URL")
			}
		}
	}
	if len(images) > 0 {
		var rows []map[string]any
		if err := json.Unmarshal(images, &rows); err != nil {
			return errors.New("image_urls must be a JSON array of objects")
		}
		for _, row := range rows {
			u, _ := row["url"].(string)
			if !isHTTPURL(u) {
				return errors.New("image_urls[].url must be an http:// or https:// URL")
			}
		}
	}
	return nil
}

func isHTTPURL(u string) bool {
	low := strings.ToLower(u)
	return strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://")
}

// writeServiceErr maps Service sentinel errors to HTTP statuses per the
// mapping documented at the top of service.go.
func writeServiceErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidViewportSlot),
		errors.Is(err, ErrInvalidSource),
		errors.Is(err, ErrInvalidName),
		errors.Is(err, ErrInvalidKind):
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrParentNotFound):
		httperr.Write(w, r, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrCustomAppCollision):
		httperr.Write(w, r, http.StatusConflict, err.Error())
	case errors.Is(err, ErrRuntimeRegisterInProduction):
		httperr.Write(w, r, http.StatusForbidden, err.Error())
	default:
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
	}
}
