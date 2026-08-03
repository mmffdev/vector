package security

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCSRF_BearerAPIKey_BypassesDoubleSubmit verifies that requests
// authenticated by a sam_live_* api-key bearer token skip the cookie
// double-submit check. Bearer headers are not auto-attached by the
// browser cross-origin, so the cookie-based CSRF defence is structurally
// inapplicable to token-auth callers. Cookie-auth callers (the SPA) are
// unaffected — they still need the matching cookie+header pair.
//
// B20.5.L follow-on: the dual-mount api-key writer surface needs a CSRF
// carve-out symmetrical to its bearer-auth model.
func TestCSRF_BearerAPIKey_BypassesDoubleSubmit(t *testing.T) {
	handler := CSRF(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/_site/work-items?meg=abc", nil)
	req.Header.Set("Authorization", "Bearer sam_live_rcvTPweU0rOibA8Z4tOQArDqzYK2b5nD5qXKK8R7")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("api-key bearer POST: got %d, want 200 (CSRF should bypass)", rec.Code)
	}
}

// TestCSRF_CookieAuth_RequiresDoubleSubmit verifies that cookie-auth
// callers (no Bearer header) still fail without a matching CSRF
// cookie+header pair — the bypass is targeted, not blanket.
func TestCSRF_CookieAuth_RequiresDoubleSubmit(t *testing.T) {
	handler := CSRF(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/_site/work-items", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("cookie-auth POST without CSRF: got %d, want 403", rec.Code)
	}
}

// TestCSRF_JWTBearer_BypassesDoubleSubmit verifies that a JWT bearer
// token also bypasses the cookie double-submit check. PLAT1.9: CP-minted
// sessions never visit Vector's legacy login/refresh handlers, so they
// hold no csrf_token cookie — and RequireAuth authenticates exclusively
// from the Authorization header (no cookie fallback), so the double-submit
// defence is structurally inapplicable to ANY bearer caller, not just
// sam_live_* api keys. This inverts the pre-PLAT1.9 contract that pinned
// JWT bearers to the full check.
func TestCSRF_JWTBearer_BypassesDoubleSubmit(t *testing.T) {
	handler := CSRF(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/_site/work-items", nil)
	req.Header.Set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.synthetic.jwt")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("JWT bearer POST: got %d, want 200 (bearer auth should bypass CSRF)", rec.Code)
	}
}

// TestCSRF_SafeMethods_AlwaysPass — sanity that the existing GET/HEAD/
// OPTIONS shortcut still applies. Locks the contract for review.
func TestCSRF_SafeMethods_AlwaysPass(t *testing.T) {
	handler := CSRF(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		req := httptest.NewRequest(m, "/_site/work-items", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("%s without CSRF: got %d, want 200", m, rec.Code)
		}
	}
}

func TestIsBearerAuth(t *testing.T) {
	cases := []struct {
		name   string
		header string
		want   bool
	}{
		{"empty", "", false},
		{"jwt", "Bearer eyJhbGc...", true},
		{"api-key proper", "Bearer sam_live_abcdef1234567890", true},
		{"bearer scheme but empty token", "Bearer ", false},
		{"bearer scheme but whitespace token", "Bearer   ", false},
		{"wrong scheme", "Basic sam_live_abc", false},
		{"no scheme", "sam_live_abc", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isBearerAuth(c.header); got != c.want {
				t.Errorf("isBearerAuth(%q) = %v, want %v", c.header, got, c.want)
			}
		})
	}
}
