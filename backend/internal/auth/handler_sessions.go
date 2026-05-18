package auth

// B16.8.10 — Active sessions UI + per-action step-up reauth handlers.
// Lives in its own file to keep handler.go from growing further; uses
// the same Handler receiver so route wiring in main.go stays homogeneous
// (authH.ListSessions, authH.Reauth, etc.).
//
// Threat model recap:
//   - The sessions UI lets users see every live session they hold and
//     revoke ones they no longer recognise. The HTTP per-request check
//     from B16.8.11 step 3 means a revoked row evicts the offending
//     device on its next request.
//   - Step-up reauth defends sensitive actions against in-realm
//     extension attacks where the per-request check can't help (the
//     extension uses the user's own session). Per-action signed proof
//     tokens narrow the attack window to "the exact action the user
//     just clicked" — an extension can capture the proof once but
//     cannot pre-stage a proof for a different action without the user
//     re-entering their password.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/secrets"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// ── action_proof HMAC ────────────────────────────────────────────────────
//
// The wire format is a base64url-encoded string carrying:
//
//   nonce_id (16 bytes) || user_id (16 bytes) || expires_at_unix (8 bytes BE) ||
//     action_key (variable) || hmac-sha256(everything above, JWT_ACCESS_SECRET) (32 bytes)
//
// Constant-time compare on validation. JWT_ACCESS_SECRET is reused
// instead of a separate REAUTH_PROOF_SECRET — same blast-radius envelope
// (compromise of JWT secret already compromises sessions), one fewer
// secret to rotate. If audit feedback ever requires separation, swap to
// secrets.Get("REAUTH_PROOF_SECRET") here in one place.

func signActionProof(nonceID, userID uuid.UUID, expiresAt time.Time, actionKey string) string {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	buf := make([]byte, 0, 40+len(actionKey)+32)
	buf = append(buf, nonceID[:]...)
	buf = append(buf, userID[:]...)
	var tsBuf [8]byte
	binary.BigEndian.PutUint64(tsBuf[:], uint64(expiresAt.Unix()))
	buf = append(buf, tsBuf[:]...)
	buf = append(buf, []byte(actionKey)...)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(buf)
	buf = append(buf, mac.Sum(nil)...)
	return base64.RawURLEncoding.EncodeToString(buf)
}

// parseActionProof validates the HMAC and returns the bound fields. Wrong
// signature, wrong action_key, or expired proof → error; caller responds
// 401 reauth_invalid.
func parseActionProof(raw, expectedActionKey string) (nonceID, userID uuid.UUID, err error) {
	buf, derr := base64.RawURLEncoding.DecodeString(raw)
	if derr != nil {
		return uuid.Nil, uuid.Nil, errors.New("action_proof: malformed encoding")
	}
	// 16 (nonce) + 16 (user) + 8 (exp) + N (action_key) + 32 (mac); N >= 1.
	if len(buf) < 16+16+8+1+32 {
		return uuid.Nil, uuid.Nil, errors.New("action_proof: too short")
	}
	macStart := len(buf) - 32
	body := buf[:macStart]
	mac := buf[macStart:]
	secret := secrets.Get("JWT_ACCESS_SECRET")
	expected := hmac.New(sha256.New, []byte(secret))
	expected.Write(body)
	if !hmac.Equal(mac, expected.Sum(nil)) {
		return uuid.Nil, uuid.Nil, errors.New("action_proof: bad signature")
	}
	copy(nonceID[:], body[0:16])
	copy(userID[:], body[16:32])
	expUnix := int64(binary.BigEndian.Uint64(body[32:40]))
	gotActionKey := string(body[40:])
	if gotActionKey != expectedActionKey {
		return uuid.Nil, uuid.Nil, fmt.Errorf("action_proof: action_key mismatch (got %q, want %q)", gotActionKey, expectedActionKey)
	}
	if time.Now().Unix() > expUnix {
		return uuid.Nil, uuid.Nil, errors.New("action_proof: expired")
	}
	return nonceID, userID, nil
}

// ── handlers ─────────────────────────────────────────────────────────────

// sessionDTO is the JSON shape ListSessions returns. is_current is the
// row whose id matches the requester's sid claim — the frontend uses it
// to disable the per-row "Revoke" button on the current session.
type sessionDTO struct {
	ID             string  `json:"id"`
	CreatedAt      string  `json:"created_at"`
	LastActivityAt string  `json:"last_activity_at"`
	IPAddress      *string `json:"ip_address,omitempty"`
	UserAgent      *string `json:"user_agent,omitempty"`
	IsCurrent      bool    `json:"is_current"`
}

// ListSessions returns every live session belonging to the caller.
// GET /_site/auth/sessions.
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	currentSID := SessionIDFromCtx(r.Context())

	rows, err := h.Svc.ListSessionsForUser(r.Context(), u.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	out := make([]sessionDTO, 0, len(rows))
	for _, s := range rows {
		out = append(out, sessionDTO{
			ID:             s.ID.String(),
			CreatedAt:      s.CreatedAt.UTC().Format(time.RFC3339),
			LastActivityAt: s.LastActivityAt.UTC().Format(time.RFC3339),
			IPAddress:      s.IPAddress,
			UserAgent:      s.UserAgent,
			IsCurrent:      s.ID == currentSID,
		})
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
}

// RevokeSession revokes one specific session belonging to the caller.
// DELETE /_site/auth/sessions/{id}. 204 on success; 404 if the id is
// unknown or belongs to a different user (same response for both —
// no enumeration leak).
func (h *Handler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	// chi URLParam is the route-defined {id} segment.
	idStr := r.PathValue("id")
	if idStr == "" {
		// Fallback for chi which uses URLParam, not std PathValue.
		idStr = strings.TrimPrefix(r.URL.Path, "/")
		if i := strings.LastIndex(idStr, "/"); i >= 0 {
			idStr = idStr[i+1:]
		}
	}
	sid, perr := uuid.Parse(idStr)
	if perr != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	affected, err := h.Svc.RevokeSession(r.Context(), sid, u.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	if affected == 0 {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	ip := clientIP(r)
	h.Svc.Audit.Log(r.Context(), audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.session_revoked_by_user",
		IPAddress:      &ip,
		Metadata:       map[string]any{"target_session_id": sid.String()},
	})
	w.WriteHeader(http.StatusNoContent)
}

// RevokeOtherSessions revokes every live session for the caller except
// the one whose id matches the current sid claim. POST
// /_site/auth/sessions/revoke-others. 204 on success; the audit entry
// records the count.
func (h *Handler) RevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	currentSID := SessionIDFromCtx(r.Context())
	if currentSID == uuid.Nil {
		// Legacy token with no sid claim — without it we'd revoke ALL
		// sessions including the caller's own. Reject rather than guess.
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}
	count, err := h.Svc.RevokeOtherSessions(r.Context(), u.ID, currentSID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	ip := clientIP(r)
	h.Svc.Audit.Log(r.Context(), audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.session_revoke_others",
		IPAddress:      &ip,
		Metadata:       map[string]any{"revoked_count": count, "kept_session_id": currentSID.String()},
	})
	w.WriteHeader(http.StatusNoContent)
}

// Reauth verifies password (+ TOTP if enrolled), inserts a single-use
// nonce, and returns a signed action_proof the frontend submits with
// the sensitive request. POST /_site/auth/reauth.
type reauthReq struct {
	ActionKey string `json:"action_key"`
	Password  string `json:"password"`
	TOTPCode  string `json:"totp_code,omitempty"`
}

type reauthResp struct {
	ActionProof string `json:"action_proof"`
	ExpiresAt   string `json:"expires_at"`
}

func (h *Handler) Reauth(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req reauthReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if req.ActionKey == "" || req.Password == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
		return
	}
	nonceID, err := h.Svc.IssueReauthNonce(r.Context(), u.ID, req.Password, req.TOTPCode, req.ActionKey)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthInvalidCurrentPassword)
			return
		}
		if errors.Is(err, ErrMFAInvalidCode) {
			httperr.Write(w, r, http.StatusUnauthorized, "mfa_invalid: code is incorrect or expired")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	expiresAt := time.Now().Add(reauthNonceTTL)
	proof := signActionProof(nonceID, u.ID, expiresAt, req.ActionKey)
	ip := clientIP(r)
	h.Svc.Audit.Log(r.Context(), audit.Entry{
		UserID:         &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:         "auth.reauth_issued",
		IPAddress:      &ip,
		Metadata:       map[string]any{"action_key": req.ActionKey},
	})
	writeJSON(w, 200, reauthResp{
		ActionProof: proof,
		ExpiresAt:   expiresAt.UTC().Format(time.RFC3339),
	})
}

// clientIP — small helper mirroring what other handlers use. The
// security package already has a richer ClientIP; this is the local
// shape used elsewhere in the auth package.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if i := strings.IndexByte(fwd, ','); i >= 0 {
			return strings.TrimSpace(fwd[:i])
		}
		return strings.TrimSpace(fwd)
	}
	return strings.SplitN(r.RemoteAddr, ":", 2)[0]
}
