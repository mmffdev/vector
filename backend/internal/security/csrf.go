package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"
	"strings"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
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
// double-submit pattern) scoped to the whole site.
func SetCSRFCookie(w http.ResponseWriter, token string) {
	secure := os.Getenv("COOKIE_SECURE") == "true"
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
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
		cookie, err := r.Cookie(CSRFCookieName)
		if err != nil || cookie.Value == "" {
			httperr.Write(w, r, http.StatusForbidden, messages.AuthCSRFInvalid)
			return
		}
		header := r.Header.Get(CSRFHeaderName)
		if header == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
			httperr.Write(w, r, http.StatusForbidden, messages.AuthCSRFInvalid)
			return
		}
		next.ServeHTTP(w, r)
	})
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
		// Legacy paths kept so any in-flight cookies from old builds don't 403.
		"/samantha/v1/auth/login",
		"/samantha/v1/auth/refresh",
		"/samantha/v1/auth/password-reset",
		"/samantha/v1/auth/password-reset/confirm",
		"/samantha/v1/addressables/build-reconcile":
		return true
	}
	if strings.HasPrefix(bare, "/samantha/v1/admin/api-keys") {
		return true
	}
	return false
}
