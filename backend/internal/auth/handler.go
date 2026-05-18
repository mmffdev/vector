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
	// MFAEnrolled lets the frontend conditionally render the
	// authenticator-code field in the step-up reauth modal (B16.8.10).
	// Surfacing this on the user payload (rather than a /me/mfa-status
	// round-trip) means useStepUpAction can decide the form shape
	// without an extra fetch.
	MFAEnrolled         bool        `json:"mfa_enrolled"`
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
		MFAEnrolled:         u.MFAEnrolled,
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
		if errors.Is(err, ErrBreachedPassword) {
			httperr.WriteCoded(w, r, http.StatusBadRequest, CodeBreachedPassword, usermessages.AuthBreachedPassword)
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

// ── Password-reset handoff (TD-SEC-RESET-TOKEN-FRAGMENT) ────────────────────
//
// The email link no longer carries the raw token in a URL query the
// user sees. Instead it points at /_site/auth/password-reset/redeem,
// which validates the raw token server-side, sets a 5-minute HttpOnly
// handoff cookie, and 302s to /login/reset/confirm with no token in
// the address bar at all. The frontend then probes /state to check the
// cookie is live; on submit it POSTs only { password } to /confirm.
// Raw token never lands in JS, history, address bar, Referer, or logs
// past the initial redeem request.

const resetHandoffCookieName = "vector_reset_handoff"

// PasswordResetRedeem handles the email link.
//   GET /_site/auth/password-reset/redeem?t=<raw>
// On valid raw token: mint handoff JWT, set HttpOnly cookie, 302 to
// /login/reset/confirm. On invalid/expired: 302 to /login/reset/confirm
// without setting the cookie (the frontend's /state probe returns the
// "expired" error and renders the request-a-new-link prompt).
func (h *Handler) PasswordResetRedeem(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("t")
	frontend := os.Getenv("FRONTEND_ORIGIN")
	if frontend == "" {
		frontend = "http://localhost:5101"
	}
	dest := frontend + "/login/reset/confirm"

	if raw == "" {
		http.Redirect(w, r, dest, http.StatusFound)
		return
	}

	resetID, err := h.Svc.RedeemPasswordResetToken(r.Context(), raw)
	if err != nil {
		// Expired / used / not found — still redirect to /confirm so
		// the user sees a uniform "link expired" UI without leaking
		// existence to a scanner that hits redeem with a guessed token.
		http.Redirect(w, r, dest, http.StatusFound)
		return
	}

	jwtToken, err := SignResetHandoffToken(resetID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal")
		return
	}

	// Path scoped to the password-reset endpoints so the cookie isn't
	// attached to unrelated requests. SameSite=Lax lets the cookie ride
	// the cross-port redirect from :5100 to :5101 (top-level navigation).
	secure := isProdEnv()
	http.SetCookie(w, &http.Cookie{
		Name:     resetHandoffCookieName,
		Value:    jwtToken,
		Path:     "/_site/auth/password-reset",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   5 * 60,
	})
	http.Redirect(w, r, dest, http.StatusFound)
}

// PasswordResetState is the frontend's "is my handoff cookie alive?" probe.
//   GET /_site/auth/password-reset/state
// Returns 200 + { "ready": true } if a valid cookie is present, 401
// otherwise. The page mounts and calls this once before showing the form;
// failure renders the "link expired" message.
func (h *Handler) PasswordResetState(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(resetHandoffCookieName)
	if err != nil || c.Value == "" {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthTokenExpired)
		return
	}
	if _, err := ParseResetHandoffToken(c.Value); err != nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthTokenExpired)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ready":true}`))
}

type resetConfirmReq struct {
	Password string `json:"password"`
	// Token is the legacy field — kept for back-compat with any
	// non-browser caller still POSTing the raw token directly. The
	// browser frontend now relies entirely on the handoff cookie set
	// by /redeem and leaves this empty.
	Token string `json:"token,omitempty"`
}

func (h *Handler) PasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var req resetConfirmReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	// Cookie handoff path (browser frontend, TD-SEC-RESET-TOKEN-FRAGMENT).
	if c, cerr := r.Cookie(resetHandoffCookieName); cerr == nil && c.Value != "" {
		claims, perr := ParseResetHandoffToken(c.Value)
		if perr != nil {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
			return
		}
		resetID, perr := uuid.Parse(claims.ResetID)
		if perr != nil {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
			return
		}
		if err := h.Svc.ConfirmPasswordResetByID(r.Context(), resetID, req.Password, security.ClientIP(r)); err != nil {
			if errors.Is(err, ErrTokenExpired) {
				httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
				return
			}
			if errors.Is(err, ErrBreachedPassword) {
				httperr.WriteCoded(w, r, http.StatusBadRequest, CodeBreachedPassword, usermessages.AuthBreachedPassword)
				return
			}
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		// Clear the handoff cookie so a second click on the email link
		// doesn't accidentally reuse a still-live JWT against a now-used
		// reset row (the DB used_at gate would catch it but no reason
		// to leave the cookie around).
		http.SetCookie(w, &http.Cookie{
			Name:     resetHandoffCookieName,
			Value:    "",
			Path:     "/_site/auth/password-reset",
			HttpOnly: true,
			MaxAge:   -1,
		})
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Legacy back-compat path: raw token in the JSON body. No browser
	// frontend calls this anymore; kept for out-of-band callers (mobile,
	// integration tests) until they migrate. Remove once unused.
	if req.Token == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
		return
	}
	if err := h.Svc.ConfirmPasswordReset(r.Context(), req.Token, req.Password, security.ClientIP(r)); err != nil {
		if errors.Is(err, ErrTokenExpired) {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.AuthTokenExpired)
			return
		}
		if errors.Is(err, ErrBreachedPassword) {
			httperr.WriteCoded(w, r, http.StatusBadRequest, CodeBreachedPassword, usermessages.AuthBreachedPassword)
			return
		}
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Login continuation handoff (TD-SEC-LOGIN-REDIRECT-COOKIE) ──────────────
//
// Replaces /login?redirect=<path>. The Next.js edge middleware can't
// share secrets with the Go backend without leaking them to the browser
// bundle, so every step that requires signing the path runs here:
//   1. Middleware detects an unauthenticated request to a protected route
//      and 302s to /_site/auth/login-required?p=<path>.
//   2. This endpoint validates the path (same-origin relative, not /v2/,
//      no protocol-relative), mints a 10-minute HttpOnly cookie carrying
//      the signed path, and 302s to a plain frontend /login (no query).
//   3. After auth the frontend probes /_site/auth/login-continuation;
//      we read the cookie, verify the JWT, return { path }, and clear
//      the cookie in the same response.
// The cookie is opaque to JS, the path never appears in the address
// bar, and a scanner POST'ing /login-required with a hostile path either
// fails validation (closed-redirect surface) or stores a path that is
// only retrievable after a successful login on this same browser.

const loginContinuationCookieName = "vector_login_continuation"

// isSafeContinuationPath enforces the same surface as the legacy
// frontend regex `/^\/(?![\\/])/.test(raw) && !raw.startsWith("/v2/")`.
// Reject empty, non-leading-slash, protocol-relative, and /v2/* paths.
func isSafeContinuationPath(p string) bool {
	if p == "" || len(p) > 2048 {
		return false
	}
	if p[0] != '/' {
		return false
	}
	if len(p) >= 2 && (p[1] == '/' || p[1] == '\\') {
		return false
	}
	if strings.HasPrefix(p, "/v2/") || p == "/v2" {
		return false
	}
	return true
}

// PasswordResetRedeem-style email-link handler — but for the login
// redirect. GET /_site/auth/login-required?p=<path>
func (h *Handler) LoginRequired(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("p")
	frontend := os.Getenv("FRONTEND_ORIGIN")
	if frontend == "" {
		frontend = "http://localhost:5101"
	}
	loginDest := frontend + "/login"

	if !isSafeContinuationPath(p) {
		// Bad path — still redirect to /login without setting the
		// cookie. The user lands on a clean /login and goes wherever
		// the post-auth start-page resolver picks.
		http.Redirect(w, r, loginDest, http.StatusFound)
		return
	}

	jwtToken, err := SignLoginContinuationToken(p)
	if err != nil {
		http.Redirect(w, r, loginDest, http.StatusFound)
		return
	}

	secure := isProdEnv()
	http.SetCookie(w, &http.Cookie{
		Name:     loginContinuationCookieName,
		Value:    jwtToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   10 * 60,
	})
	http.Redirect(w, r, loginDest, http.StatusFound)
}

// LoginContinuation returns the path the user originally requested
// before being bounced to /login. Cleared in the same response so a
// repeat call is a 204 (and a back/forward to /login post-auth doesn't
// re-trigger navigation).
//   GET /_site/auth/login-continuation
// 200 { "path": "/portfolio-items" } if cookie alive + signed; 204 if
// no cookie / invalid / expired.
func (h *Handler) LoginContinuation(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(loginContinuationCookieName)
	if err != nil || c.Value == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	claims, perr := ParseLoginContinuationToken(c.Value)
	if perr != nil || !isSafeContinuationPath(claims.Path) {
		// Clear the bad cookie so the next probe doesn't keep failing.
		http.SetCookie(w, &http.Cookie{
			Name:     loginContinuationCookieName,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			MaxAge:   -1,
		})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// Clear cookie atomically with the read — single-use semantics.
	http.SetCookie(w, &http.Cookie{
		Name:     loginContinuationCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"path":` + jsonQuote(claims.Path) + `}`))
}

// jsonQuote escapes a string for inline JSON emission without pulling
// json.Marshal for a single field. Used by LoginContinuation.
func jsonQuote(s string) string {
	b := make([]byte, 0, len(s)+2)
	b = append(b, '"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			b = append(b, '\\', '"')
		case '\\':
			b = append(b, '\\', '\\')
		case '\n':
			b = append(b, '\\', 'n')
		case '\r':
			b = append(b, '\\', 'r')
		case '\t':
			b = append(b, '\\', 't')
		default:
			if c < 0x20 {
				b = append(b, '\\', 'u', '0', '0',
					hexNibble(c>>4), hexNibble(c&0x0f))
			} else {
				b = append(b, c)
			}
		}
	}
	b = append(b, '"')
	return string(b)
}

func hexNibble(n byte) byte {
	if n < 10 {
		return '0' + n
	}
	return 'a' + (n - 10)
}

// isProdEnv returns true when the server is running in production mode.
// Used for the Secure cookie flag — set in prod, omitted in dev (HTTP
// localhost wouldn't accept Secure-flagged cookies).
func isProdEnv() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("BACKEND_ENV"))) {
	case "production", "prod":
		return true
	}
	return false
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

