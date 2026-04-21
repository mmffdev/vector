package auth

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mmffdev/vector-backend/internal/security"
)

type Handler struct {
	Svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{Svc: svc} }

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResp struct {
	AccessToken string      `json:"access_token"`
	User        interface{} `json:"user"`
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
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: res.User})
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
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: res.User})
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
	writeJSON(w, 200, u)
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
