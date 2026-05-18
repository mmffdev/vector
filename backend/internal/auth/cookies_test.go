package auth

// B16.8.7 — cookie flag contract.
//
// Three rules pinned here:
//
//  1. The Secure flag MUST be set when the request arrived over TLS,
//     regardless of the COOKIE_SECURE env var. Env stays as the
//     explicit-override for non-TLS-terminating frontends (Cloudflare,
//     ALB) where req.TLS is nil on the Go side because TLS terminates
//     upstream — operators set COOKIE_SECURE=true there.
//
//  2. The Secure flag MUST be set when COOKIE_SECURE=true even if the
//     request didn't arrive over TLS (proxy case). Either signal is
//     sufficient.
//
//  3. The HttpOnly + SameSite=Strict flags MUST always be set on the
//     refresh cookie. Procurement audits flag missing HttpOnly as a
//     critical XSS-defence gap.
//
// The current setRefreshCookie reads only COOKIE_SECURE, so rule 1
// (TLS auto-detect) fails red before this commit.

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSetRefreshCookie_SecureWhenTLS(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "false") // env explicitly off — only TLS should trigger Secure
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/auth/login", nil)
	req.TLS = &tls.ConnectionState{} // simulate TLS-terminated request

	setRefreshCookie(w, req, "refresh-value", time.Now().Add(1*time.Hour))

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if !c.Secure {
		t.Error("Secure flag missing on TLS request — auto-detect failed (rule 1)")
	}
	if !c.HttpOnly {
		t.Error("HttpOnly flag missing — XSS defence gap (rule 3)")
	}
	if c.SameSite != http.SameSiteStrictMode {
		t.Errorf("SameSite=Strict expected, got %v", c.SameSite)
	}
}

func TestSetRefreshCookie_SecureWhenEnvTrue(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "true") // proxy case — TLS terminates upstream
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/auth/login", nil)
	// req.TLS intentionally nil — backend doesn't see TLS

	setRefreshCookie(w, req, "refresh-value", time.Now().Add(1*time.Hour))

	cookies := w.Result().Cookies()
	if !cookies[0].Secure {
		t.Error("Secure flag missing when COOKIE_SECURE=true and req.TLS nil — env override failed (rule 2)")
	}
}

func TestSetRefreshCookie_NoSecureWhenLocalHTTP(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "false") // dev default
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/auth/login", nil)
	// req.TLS nil — plain HTTP dev environment

	setRefreshCookie(w, req, "refresh-value", time.Now().Add(1*time.Hour))

	cookies := w.Result().Cookies()
	if cookies[0].Secure {
		t.Error("Secure flag set on plain HTTP dev request — would break dev cookies in browsers that strip Secure cookies over http://")
	}
	// HttpOnly + SameSite remain mandatory even in dev.
	if !cookies[0].HttpOnly {
		t.Error("HttpOnly flag missing in dev — XSS defence applies in dev too")
	}
}
