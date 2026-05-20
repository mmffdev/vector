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
// Api-key bearer callers (Authorization: Bearer sam_live_*) also pass — they
// authenticate via a header the browser never auto-attaches cross-origin, so
// the cookie-based double-submit defence is structurally inapplicable. This
// is the B20.5.L follow-on: the dual-mount api-key writer surface needs a
// CSRF carve-out symmetrical to its bearer-auth model. Cookie-auth callers
// (the SPA) keep the full check.
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
		if isAPIKeyBearer(r.Header.Get("Authorization")) {
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

// isAPIKeyBearer reports whether the Authorization header carries an
// api-key bearer token (sam_live_* prefix). Used by the CSRF middleware
// to skip the cookie double-submit check for token-auth callers — see
// the comment on CSRF for the threat-model rationale.
func isAPIKeyBearer(authHeader string) bool {
	const prefix = "Bearer sam_live_"
	return strings.HasPrefix(authHeader, prefix) && len(authHeader) > len(prefix)
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
