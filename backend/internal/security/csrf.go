package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"

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
// Safe methods (GET/HEAD/OPTIONS) pass through. The /v1/api/auth/login and
// /v1/api/auth/refresh endpoints also pass — they ARE how the user obtains the
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
	switch path {
	case "/v1/api/auth/login",
		"/v1/api/auth/refresh",
		"/v1/api/auth/password-reset",
		"/v1/api/auth/password-reset/confirm",
		"/v1/api/addressables/build-reconcile":
		return true
	}
	return false
}
