package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/security"
)

type Handler struct {
	Svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{Svc: svc}
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResp struct {
	AccessToken string      `json:"access_token"`
	User        userPayload `json:"user"`
}

// userPayload mirrors AuthContext.AuthUser on the frontend. Adding the
// role row + permission codes here in one shot avoids a second round
// trip on app boot — every consumer that previously branched on
// user.role can now branch on a permission code instead.
type userPayload struct {
	ID                  uuid.UUID   `json:"id"`
	SubscriptionID      uuid.UUID   `json:"subscription_id"`
	Email               string      `json:"email"`
	Role                RolePayload `json:"role"`
	IsActive            bool        `json:"is_active"`
	ForcePasswordChange bool        `json:"force_password_change"`
	AuthMethod          string      `json:"auth_method"`
	LastLogin           *time.Time  `json:"last_login,omitempty"`
	Permissions         []string    `json:"permissions"`
}

func (h *Handler) buildUserPayload(ctx context.Context, u *roletypes.User) userPayload {
	role, perms := h.Svc.LoadRoleAndPermissions(ctx, u.ID)
	return userPayload{
		ID:                  u.ID,
		SubscriptionID:      u.SubscriptionID,
		Email:               u.Email,
		Role:                role,
		IsActive:            u.IsActive,
		ForcePasswordChange: u.ForcePasswordChange,
		AuthMethod:          u.AuthMethod,
		LastLogin:           u.LastLogin,
		Permissions:         perms,
	}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	ip := security.ClientIP(r)
	res, err := h.Svc.Login(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)), req.Password, ip, r.UserAgent())
	if err != nil {
		status := http.StatusUnauthorized
		msg := usermessages.AuthInvalidCredentials
		if errors.Is(err, ErrAccountLocked) {
			status = http.StatusLocked
			msg = usermessages.AuthAccountLocked
		} else if errors.Is(err, ErrAccountInactive) {
			status = http.StatusForbidden
			msg = usermessages.AuthAccountInactive
		} else if !errors.Is(err, ErrInvalidCredentials) {
			status = http.StatusInternalServerError
			msg = usermessages.InternalError
		}
		httperr.Write(w, r, status, msg)
		return
	}
	setRefreshCookie(w, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("rt")
	if err != nil || c.Value == "" {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthTokenExpired)
		return
	}
	res, err := h.Svc.Refresh(r.Context(), c.Value, security.ClientIP(r), r.UserAgent())
	if err != nil {
		clearRefreshCookie(w)
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthTokenExpired)
		return
	}
	// Only overwrite the rt cookie when we issued a new token (normal rotation).
	// Grace-window successor reuse returns RefreshRaw="" — the browser already
	// holds the successor cookie so we leave it untouched.
	if res.RefreshRaw != "" {
		setRefreshCookie(w, res.RefreshRaw, res.RefreshExpAt)
	}
	issueCSRF(w)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("rt"); err == nil {
		_ = h.Svc.Logout(r.Context(), c.Value, security.ClientIP(r))
	}
	clearRefreshCookie(w)
	security.ClearCSRFCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	writeJSON(w, 200, h.buildUserPayload(r.Context(), u))
}

type changePwdReq struct {
	Current string `json:"current"`
	New     string `json:"new"`
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req changePwdReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.ChangePassword(r.Context(), u.ID, req.Current, req.New, security.ClientIP(r)); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthInvalidCurrentPassword)
			return
		}
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type resetReq struct {
	Email string `json:"email"`
}

func (h *Handler) PasswordReset(w http.ResponseWriter, r *http.Request) {
	var req resetReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	_ = h.Svc.RequestPasswordReset(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)), security.ClientIP(r))
	w.WriteHeader(http.StatusNoContent)
}

type resetConfirmReq struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *Handler) PasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var req resetConfirmReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.ConfirmPasswordReset(r.Context(), req.Token, req.Password, security.ClientIP(r)); err != nil {
		if errors.Is(err, ErrTokenExpired) {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
			return
		}
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func setRefreshCookie(w http.ResponseWriter, raw string, expAt time.Time) {
	secure := os.Getenv("COOKIE_SECURE") == "true"
	http.SetCookie(w, &http.Cookie{
		Name:     "rt",
		Value:    raw,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		Expires:  expAt,
	})
}

func issueCSRF(w http.ResponseWriter) {
	tok, err := security.NewCSRFToken()
	if err != nil {
		return
	}
	security.SetCSRFCookie(w, tok)
}

func clearRefreshCookie(w http.ResponseWriter) {
	// Clear at "/" (current) and all legacy paths so stale cookies from
	// older builds (which used /auth, /samantha/v1/auth, etc.) are evicted.
	for _, p := range []string{"/", "/auth", "/samantha/v1/auth", "/v1/api/auth", "/api/auth"} {
		http.SetCookie(w, &http.Cookie{
			Name:     "rt",
			Value:    "",
			Path:     p,
			HttpOnly: true,
			MaxAge:   -1,
			SameSite: http.SameSiteStrictMode,
		})
	}
}

