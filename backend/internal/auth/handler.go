package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/security"
)

type Handler struct {
	Svc      *Service
	Resolver *permissions.Resolver
	Pool     *pgxpool.Pool
}

func NewHandler(svc *Service, resolver *permissions.Resolver, pool *pgxpool.Pool) *Handler {
	return &Handler{Svc: svc, Resolver: resolver, Pool: pool}
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResp struct {
	AccessToken string      `json:"access_token"`
	User        userPayload `json:"user"`
}

// rolePayload is the wire shape for users.role on auth responses (login,
// refresh, /api/auth/me). Frontend RBAC reads code/rank/is_external etc.
// directly so it never has to translate the legacy enum into capability.
type rolePayload struct {
	ID         uuid.UUID `json:"id"`
	Code       string    `json:"code"`
	Label      string    `json:"label"`
	Rank       int       `json:"rank"`
	IsSystem   bool      `json:"is_system"`
	IsExternal bool      `json:"is_external"`
}

// userPayload mirrors AuthContext.AuthUser on the frontend. Adding the
// role row + permission codes here in one shot avoids a second round
// trip on app boot — every consumer that previously branched on
// user.role can now branch on a permission code instead.
type userPayload struct {
	ID                  uuid.UUID   `json:"id"`
	SubscriptionID      uuid.UUID   `json:"subscription_id"`
	Email               string      `json:"email"`
	Role                rolePayload `json:"role"`
	IsActive            bool        `json:"is_active"`
	ForcePasswordChange bool        `json:"force_password_change"`
	AuthMethod          string      `json:"auth_method"`
	LastLogin           *time.Time  `json:"last_login,omitempty"`
	Permissions         []string    `json:"permissions"`
}

// buildUserPayload assembles userPayload from the underlying *models.User.
// It loads the role row from `roles` and the effective permission codes
// from the resolver (cached). Returns a payload with empty role/permissions
// rather than failing the request if the role lookup hiccups — auth must
// not break because the catalogue is briefly unavailable.
func (h *Handler) buildUserPayload(ctx context.Context, u *models.User) userPayload {
	out := userPayload{
		ID:                  u.ID,
		SubscriptionID:      u.SubscriptionID,
		Email:               u.Email,
		IsActive:            u.IsActive,
		ForcePasswordChange: u.ForcePasswordChange,
		AuthMethod:          u.AuthMethod,
		LastLogin:           u.LastLogin,
		Permissions:         []string{},
	}

	var roleID uuid.UUID
	if err := h.Pool.QueryRow(ctx,
		`SELECT role_id FROM users WHERE id = $1`, u.ID,
	).Scan(&roleID); err != nil {
		return out
	}
	var rp rolePayload
	if err := h.Pool.QueryRow(ctx, `
		SELECT id, code, label, rank, is_system, is_external
		  FROM roles WHERE id = $1`, roleID,
	).Scan(&rp.ID, &rp.Code, &rp.Label, &rp.Rank, &rp.IsSystem, &rp.IsExternal); err != nil {
		return out
	}
	out.Role = rp

	if codes, err := h.Resolver.PermissionsFor(ctx, u.ID); err == nil {
		list := make([]string, 0, len(codes))
		for c := range codes {
			list = append(list, string(c))
		}
		sort.Strings(list)
		out.Permissions = list
	}
	return out
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ip := clientIP(r)
	res, err := h.Svc.Login(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)), req.Password, ip, r.UserAgent())
	if err != nil {
		status := http.StatusUnauthorized
		msg := "invalid credentials"
		if errors.Is(err, ErrAccountLocked) {
			status = http.StatusLocked
			msg = "account locked"
		} else if errors.Is(err, ErrAccountInactive) {
			status = http.StatusForbidden
			msg = "account inactive"
		} else if !errors.Is(err, ErrInvalidCredentials) {
			status = http.StatusInternalServerError
			msg = "internal error"
		}
		http.Error(w, msg, status)
		return
	}
	setRefreshCookie(w, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("rt")
	if err != nil || c.Value == "" {
		http.Error(w, "no refresh token", http.StatusUnauthorized)
		return
	}
	res, err := h.Svc.Refresh(r.Context(), c.Value, clientIP(r), r.UserAgent())
	if err != nil {
		clearRefreshCookie(w)
		http.Error(w, "token expired", http.StatusUnauthorized)
		return
	}
	setRefreshCookie(w, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("rt"); err == nil {
		_ = h.Svc.Logout(r.Context(), c.Value, clientIP(r))
	}
	clearRefreshCookie(w)
	security.ClearCSRFCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req changePwdReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ChangePassword(r.Context(), u.ID, req.Current, req.New, clientIP(r)); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			http.Error(w, "invalid current password", http.StatusUnauthorized)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	_ = h.Svc.RequestPasswordReset(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)), clientIP(r))
	w.WriteHeader(http.StatusNoContent)
}

type resetConfirmReq struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *Handler) PasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var req resetConfirmReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ConfirmPasswordReset(r.Context(), req.Token, req.Password, clientIP(r)); err != nil {
		if errors.Is(err, ErrTokenExpired) {
			http.Error(w, "token expired or used", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
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
		Path:     "/api/auth",
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
	http.SetCookie(w, &http.Cookie{
		Name:     "rt",
		Value:    "",
		Path:     "/api/auth",
		HttpOnly: true,
		MaxAge:   -1,
		SameSite: http.SameSiteStrictMode,
	})
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.Index(xf, ","); i >= 0 {
			return strings.TrimSpace(xf[:i])
		}
		return xf
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
