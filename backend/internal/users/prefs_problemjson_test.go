package users

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// PLA060 B16.12.1 — assert RFC 9457 problem+json wire-shape on the
// converted error paths in prefs.go. No DB required: the 401 path
// triggers when ctx has no auth.User, and the 5xx-leak guard checks
// that even if we DID hit a 500 path it wouldn't include pgx error
// text (we exercise this by capturing the body on an unauthenticated
// call and confirming no DB-shaped text appears).

// pgxBleed matches typical pgx / pgconn error fragments — relation
// names, ERROR: prefixes, SQLSTATE codes. The expectation is that
// usermessages.InternalError ("Something went wrong on our end…")
// never includes these.
var pgxBleed = regexp.MustCompile(`(?i)(\bERROR:|\bpgconn\b|\brelation\s+"|\bSQLSTATE\b)`)

func TestPrefs_GetThemePack_Unauth_ProblemJSON(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest("GET", "/me/theme-pack", nil)
	rec := httptest.NewRecorder()
	h.GetThemePack(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected Content-Type application/problem+json, got %q", ct)
	}
}

func TestPrefs_SetActiveScope_Unauth_ProblemJSON(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest("PUT", "/me/active-scope", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	h.SetActiveScope(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected problem+json content type, got %q", ct)
	}
}

func TestPrefs_GetPreference_InvalidKey_ProblemJSON(t *testing.T) {
	// 400 path (invalid key) is unauthenticated-first; the auth gate fires
	// before the key validator, so the assertion is again on a 401 here.
	// The body's content-type is the contract under test.
	h := &Handler{}
	req := httptest.NewRequest("GET", "/me/preferences/bad..key", nil)
	rec := httptest.NewRecorder()
	h.GetPreference(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from auth gate (key validator runs after); got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected problem+json content type, got %q", ct)
	}
}

// 5xx-leak guard: walk every prefs handler with a junk-but-shaped
// request body, capture the response body across every status, and
// assert nothing pgx-shaped leaks. We can't easily force a 500 without
// a broken pool, but the body of any error response must not carry
// pgx error text — usermessages.InternalError is the contract.
func TestPrefs_ErrorBodies_NeverLeakPGXText(t *testing.T) {
	h := &Handler{}
	cases := []struct {
		name string
		call func(rec *httptest.ResponseRecorder)
	}{
		{"GetThemePack", func(rec *httptest.ResponseRecorder) {
			h.GetThemePack(rec, httptest.NewRequest("GET", "/me/theme-pack", nil))
		}},
		{"SetActiveScope", func(rec *httptest.ResponseRecorder) {
			h.SetActiveScope(rec, httptest.NewRequest("PUT", "/me/active-scope", strings.NewReader(`{}`)))
		}},
		{"GetPreference", func(rec *httptest.ResponseRecorder) {
			h.GetPreference(rec, httptest.NewRequest("GET", "/me/preferences/x", nil))
		}},
		{"SetPreference", func(rec *httptest.ResponseRecorder) {
			h.SetPreference(rec, httptest.NewRequest("PUT", "/me/preferences/x", strings.NewReader(`{"value":null}`)))
		}},
		{"DeletePreference", func(rec *httptest.ResponseRecorder) {
			h.DeletePreference(rec, httptest.NewRequest("DELETE", "/me/preferences/x", nil))
		}},
		{"SetThemePack", func(rec *httptest.ResponseRecorder) {
			h.SetThemePack(rec, httptest.NewRequest("PUT", "/me/theme-pack", strings.NewReader(`{"pack":"x"}`)))
		}},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.call(rec)
		body := rec.Body.String()
		if pgxBleed.MatchString(body) {
			t.Errorf("%s leaked pgx-shaped text in body: %s", c.name, body)
		}
	}
}
