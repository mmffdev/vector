package users

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
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

// ── Per-user namespaced preferences (mig 208) ──────────────────────────────
//
// Replaces URL-bar query state for filter chips, sort, tab — see
// TD-URL-FILTER-CHIPS / TD-URL-TAB-STATE in docs/c_tech_debt.md and
// feedback_url_is_path_only memory.
//
// Routes:
//   GET    /_site/me/preferences/{key}  → { "value": <json> | null }
//   PUT    /_site/me/preferences/{key}  body: { "value": <json> } → 204
//   DELETE /_site/me/preferences/{key}  → 204
//
// Key naming: dotted namespace (e.g. "workitems.filters",
// "portfolioitems.sort", "tab.workspace-admin"). Validated against
// prefKeyPattern — alphanumeric + dot + hyphen, 1–80 chars. No
// embedded SQL or path-traversal surface; the key only ever appears
// as a JSONB object key.
//
// Value: opaque JSON. Backend doesn't interpret it — the calling
// frontend hook owns the shape. Cross-tenant safe by virtue of being
// keyed on user_id (which carries subscription_id).

// Key vocabulary: lowercase alphanumeric + single dot/hyphen/underscore
// separators. First and last char must be alphanumeric (no leading or
// trailing separator); no consecutive separators (rules out `..`, `__`,
// `.-`, etc). 1–80 chars total. Single-char keys are allowed.
var prefKeyPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9]|[._-][a-z0-9]){0,79}$`)

// GetPreference returns the raw JSON value stored at the namespace,
// or nil when the key is unset. Returns (nil, nil) when present-but-null
// is distinct from missing — that distinction matters to callers that
// want to clear a key vs. seed a default, but the wire shape collapses
// both to "value: null" for simplicity.
func (s *Service) GetPreference(ctx context.Context, userID uuid.UUID, key string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := s.Pool.QueryRow(ctx, sqlSelectUserPreference, userID, key).Scan(&raw)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// SetPreference writes the value at the namespace key. The raw bytes
// must be valid JSON — caller validates (handler does).
func (s *Service) SetPreference(ctx context.Context, userID uuid.UUID, key string, value json.RawMessage) error {
	tag, err := s.Pool.Exec(ctx, sqlUpsertUserPreference, userID, key, []byte(value))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePreference removes the namespace key. Idempotent.
func (s *Service) DeletePreference(ctx context.Context, userID uuid.UUID, key string) error {
	tag, err := s.Pool.Exec(ctx, sqlDeleteUserPreference, userID, key)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type preferenceResp struct {
	Value json.RawMessage `json:"value"`
}

type preferenceReq struct {
	Value json.RawMessage `json:"value"`
}

// GetPreference returns { "value": <json> | null } for the namespace.
func (h *Handler) GetPreference(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	key := chi.URLParam(r, "key")
	if !prefKeyPattern.MatchString(key) {
		http.Error(w, "invalid key", http.StatusBadRequest)
		return
	}
	raw, err := h.Svc.GetPreference(r.Context(), actor.ID, key)
	if err != nil && !errors.Is(err, ErrNotFound) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Missing key → value: null (rather than 404) — callers always seed.
	if raw == nil {
		raw = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, preferenceResp{Value: raw})
}

// SetPreference accepts { "value": <json> } and stores it under the
// namespace key. Caller-supplied JSON is validated by json.Decoder.
func (h *Handler) SetPreference(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	key := chi.URLParam(r, "key")
	if !prefKeyPattern.MatchString(key) {
		http.Error(w, "invalid key", http.StatusBadRequest)
		return
	}
	var req preferenceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if len(req.Value) == 0 {
		http.Error(w, "missing value", http.StatusBadRequest)
		return
	}
	// json.RawMessage is bytes — confirm they parse as JSON before
	// stuffing into Postgres so a corrupt body fails cleanly here
	// rather than at the DB driver.
	var probe any
	if err := json.Unmarshal(req.Value, &probe); err != nil {
		http.Error(w, "value is not valid JSON", http.StatusBadRequest)
		return
	}
	if err := h.Svc.SetPreference(r.Context(), actor.ID, key, req.Value); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeletePreference removes the namespace key.
func (h *Handler) DeletePreference(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	key := chi.URLParam(r, "key")
	if !prefKeyPattern.MatchString(key) {
		http.Error(w, "invalid key", http.StatusBadRequest)
		return
	}
	if err := h.Svc.DeletePreference(r.Context(), actor.ID, key); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
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
