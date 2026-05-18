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

	"github.com/mmffdev/vector-backend/internal/audit"
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

// mfaChallengeResp is returned instead of loginResp when the user has
// MFA enrolled. The frontend must POST /auth/mfa/verify with this token.
type mfaChallengeResp struct {
	MFARequired     bool   `json:"mfa_required"`
	ChallengeToken  string `json:"challenge_token"`
}

// userPayload mirrors AuthContext.AuthUser on the frontend. Adding the
// role row + permission codes here in one shot avoids a second round
// trip on app boot — every consumer that previously branched on
// user.role can now branch on a permission code instead.
type userPayload struct {
	ID                  uuid.UUID   `json:"id"`
	SubscriptionID      uuid.UUID   `json:"subscription_id"`
	// WorkspaceID surfaces the user's active workspace_id from the JWT
	// claim (PLA-0053 / story 00580). Frontend's useActiveWorkspace
	// hook reads this off AuthContext to key per-workspace caches.
	// Zero (uuid.Nil) when the JWT predates PLA-0053 — frontend
	// treats this as "no workspace clamp yet" and falls back as needed.
	WorkspaceID         uuid.UUID   `json:"workspace_id"`
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
		WorkspaceID:         u.WorkspaceID,
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
	if res.MFARequired {
		// Check for a valid 30-day device-trust cookie — skip the challenge
		// if this browser was previously trusted on this account.
		if security.CheckMFARememberCookie(r, res.User.ID.String()) {
			// Trusted device: issue full session without MFA challenge.
			if wsID, werr := h.Svc.resolveDefaultWorkspace(r.Context(), res.User.SubscriptionID); werr == nil {
				res.User.WorkspaceID = wsID
			}
			raw, hash, rerr := GenerateRefreshToken()
			if rerr != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			refreshTTL := parseDurationEnv("JWT_REFRESH_TTL", 168*time.Hour)
			expAt := time.Now().Add(refreshTTL)
			// Insert session row first so the sid claim can be stamped on
			// the access token (B16.8.11 step 2).
			var sessID uuid.UUID
			if err := h.Svc.Pool.QueryRow(r.Context(), sqlInsertSession,
				res.User.ID, hash, expAt, nilIfEmpty(ip), nilIfEmpty(r.UserAgent()),
			).Scan(&sessID); err != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			access, aerr := SignAccessToken(res.User, sessID)
			if aerr != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			h.Svc.Audit.Log(r.Context(), audit.Entry{UserID: &res.User.ID, SubscriptionID: &res.User.SubscriptionID, Action: "auth.login_trusted_device", IPAddress: &ip})
			setRefreshCookie(w, r, raw, expAt)
			issueCSRF(w, r)
			writeJSON(w, 200, loginResp{AccessToken: access, User: h.buildUserPayload(r.Context(), res.User)})
			return
		}
		writeJSON(w, 200, mfaChallengeResp{MFARequired: true, ChallengeToken: res.MFAChallengeToken})
		return
	}
	setRefreshCookie(w, r, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w, r)
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
		setRefreshCookie(w, r, res.RefreshRaw, res.RefreshExpAt)
	}
	issueCSRF(w, r)
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

// PLA-0053 / story 00576.5 — re-mint the JWT + rotate the refresh
// session with a new workspace_id claim. Frontend switcher posts here
// then calls AuthContext.refresh() to pick up the new claim. The
// response mirrors /auth/refresh's shape so the frontend code path
// is a thin call-then-apply.
type switchWorkspaceReq struct {
	WorkspaceID string `json:"workspace_id"`
}

func (h *Handler) SwitchWorkspace(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req switchWorkspaceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	wsID, err := uuid.Parse(req.WorkspaceID)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid workspace_id")
		return
	}
	res, err := h.Svc.SwitchWorkspace(r.Context(), u, wsID, security.ClientIP(r), r.UserAgent())
	if err != nil {
		if errors.Is(err, ErrWorkspaceForbidden) {
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	setRefreshCookie(w, r, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w, r)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
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

// ── MFA handlers ─────────────────────────────────────────────────────────────

// POST /auth/mfa/verify — exchange a challenge_token + code for a full session.
// B16.8.3.
type mfaVerifyReq struct {
	ChallengeToken string `json:"challenge_token"`
	Code           string `json:"code"`
	RememberDevice bool   `json:"remember_device"`
}

func (h *Handler) MFAVerify(w http.ResponseWriter, r *http.Request) {
	var req mfaVerifyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	ip := security.ClientIP(r)
	res, err := h.Svc.MFAVerifyLogin(r.Context(), req.ChallengeToken, req.Code, ip, r.UserAgent())
	if err != nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthInvalidCredentials)
		return
	}
	if req.RememberDevice {
		_ = security.SetMFARememberCookie(w, r, res.User.ID.String())
	}
	setRefreshCookie(w, r, res.RefreshRaw, res.RefreshExpAt)
	issueCSRF(w, r)
	writeJSON(w, 200, loginResp{AccessToken: res.AccessToken, User: h.buildUserPayload(r.Context(), res.User)})
}

// POST /auth/mfa/enroll — generate TOTP secret + recovery codes.
// B16.8.4.
func (h *Handler) MFAEnroll(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	uri, codes, err := h.Svc.MFAEnroll(r.Context(), u.ID, u.Email)
	if err != nil {
		if errors.Is(err, ErrMFAAlreadyEnrolled) {
			httperr.Write(w, r, http.StatusConflict, "mfa already enrolled")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, 200, map[string]any{"otpauth_uri": uri, "recovery_codes": codes})
}

// POST /auth/mfa/confirm — validate live TOTP code + flip mfa_enrolled=TRUE.
// B16.8.4.
type mfaConfirmReq struct {
	Code string `json:"code"`
}

func (h *Handler) MFAConfirm(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req mfaConfirmReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	confirmFn := h.Svc.MFAConfirm(r.Context(), u.ID)
	if err := confirmFn(req.Code); err != nil {
		if errors.Is(err, ErrMFAInvalidCode) {
			httperr.Write(w, r, http.StatusUnauthorized, "mfa_invalid: code is incorrect or expired")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /auth/mfa — disable MFA after password re-verification.
// B16.8.4.
type mfaDisableReq struct {
	Password string `json:"password"`
}

func (h *Handler) MFADisable(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req mfaDisableReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.MFADisable(r.Context(), u.ID, req.Password); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthInvalidCurrentPassword)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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

// isSecureCookieRequest decides whether to set the Secure flag on a
// cookie issued in response to r. B16.8.7: prefer TLS auto-detect
// (req.TLS != nil) so the dev → prod transition doesn't depend on an
// operator remembering to flip COOKIE_SECURE. The env var stays as the
// explicit override for TLS-terminating-upstream deployments
// (Cloudflare, ALB) where req.TLS is nil because TLS terminates before
// Go sees the request — operators set COOKIE_SECURE=true there. Either
// signal is sufficient.
func isSecureCookieRequest(r *http.Request) bool {
	if r != nil && r.TLS != nil {
		return true
	}
	return os.Getenv("COOKIE_SECURE") == "true"
}

func setRefreshCookie(w http.ResponseWriter, r *http.Request, raw string, expAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     "rt",
		Value:    raw,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecureCookieRequest(r),
		SameSite: http.SameSiteStrictMode,
		Expires:  expAt,
	})
}

func issueCSRF(w http.ResponseWriter, r *http.Request) {
	tok, err := security.NewCSRFToken()
	if err != nil {
		return
	}
	security.SetCSRFCookie(w, r, tok)
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

