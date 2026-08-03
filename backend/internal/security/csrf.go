package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"
	"strings"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

const (
	CSRFCookieName = "csrf_token"
	CSRFHeaderName = "X-CSRF-Token"
)

// NewCSRFToken returns a 32-byte hex token.
func NewCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// SetCSRFCookie issues a JS-readable cookie (HttpOnly=false on purpose, that's the
// double-submit pattern) scoped to the whole site. Secure is set when the
// request arrived over TLS (req.TLS != nil) OR when COOKIE_SECURE=true
// (proxy / TLS-upstream case). B16.8.7.
func SetCSRFCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false,
		Secure:   isSecureCookieRequest(r),
		SameSite: http.SameSiteStrictMode,
	})
}

// isSecureCookieRequest decides whether to set the Secure flag on a
// cookie issued in response to r. Prefers TLS auto-detect so the
// dev → prod transition doesn't depend on COOKIE_SECURE being set;
// env var stays as the explicit override for TLS-terminating-upstream
// deployments where r.TLS is nil. B16.8.7.
func isSecureCookieRequest(r *http.Request) bool {
	if r != nil && r.TLS != nil {
		return true
	}
	return os.Getenv("COOKIE_SECURE") == "true"
}

// ClearCSRFCookie removes the CSRF cookie (e.g. on logout).
func ClearCSRFCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		SameSite: http.SameSiteStrictMode,
	})
}

// CSRF middleware enforces the double-submit check on state-changing methods.
// Safe methods (GET/HEAD/OPTIONS) pass through. Auth bootstrap endpoints
// (/auth/login, /auth/refresh) also pass — they're how the user obtains the
// token, and they're protected by rate limiting + credentials.
//
// Bearer callers (Authorization: Bearer …, api-key or JWT) also pass — they
// authenticate via a header the browser never auto-attaches cross-origin, so
// the cookie-based double-submit defence is structurally inapplicable. This
// is safe because RequireAuth reads credentials EXCLUSIVELY from the
// Authorization header (auth/middleware.go) — there is no cookie fallback an
// attacker could ride after slipping past this check, and the cookie-auth
// surfaces (/auth/refresh, rt cookie) are covered by their own exemptions +
// rotation/binding. Cookie-only callers keep the full check.
//
// History: B20.5.L carved out sam_live_* api-key bearers; PLAT1.9 widened it
// to all bearers because CP-minted sessions never visit Vector's legacy
// login/refresh handlers, so a CP session has no csrf_token cookie at all —
// every browser POST (sentinel switch-workspace/focus, the /query read
// gateways) was 403ing with AuthCSRFInvalid despite carrying a valid
// DPoP-bound bearer token.
func CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if isCSRFExempt(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if isBearerAuth(r.Header.Get("Authorization")) {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(CSRFCookieName)
		if err != nil || cookie.Value == "" {
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthCSRFInvalid)
			return
		}
		header := r.Header.Get(CSRFHeaderName)
		if header == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthCSRFInvalid)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isBearerAuth reports whether the Authorization header carries a
// non-empty bearer token (api-key sam_live_* or JWT access token). Used
// by the CSRF middleware to skip the cookie double-submit check for
// token-auth callers — see the comment on CSRF for the threat-model
// rationale. The token's validity is NOT checked here; that's
// RequireAuth's job. Presence alone proves the request was made by code
// that can set headers (same-origin JS or a CORS-approved caller),
// which is exactly what the double-submit cookie exists to prove.
func isBearerAuth(authHeader string) bool {
	const prefix = "Bearer "
	return strings.HasPrefix(authHeader, prefix) && strings.TrimSpace(authHeader[len(prefix):]) != ""
}

func isCSRFExempt(path string) bool {
	// Strip /_site prefix so the same exempt list covers both the canonical
	// BFF mount (/_site/auth/login) and the root back-compat shim (/auth/login).
	// The global CSRF middleware sees the full path before chi strips prefixes.
	bare := strings.TrimPrefix(path, "/_site")
	switch bare {
	case "/auth/login",
		"/auth/refresh",
		"/auth/password-reset",
		"/auth/password-reset/confirm",
		"/auth/mfa/verify",
		"/addressables/build-reconcile",
		// TD-SEC-CSP-NONCES-SRI Phase 2 — browser CSP reports are POSTed
		// without session cookies (sometimes pre-login, always without
		// JS-driven CSRF header). Per-IP rate limit on the route is the
		// only DoS protection. Body is parsed as opaque JSON; no state
		// change beyond inserting an audit row.
		"/csp-report":
		return true
	}
	if strings.HasPrefix(bare, "/admin/api-keys") {
		return true
	}
	return false
}
