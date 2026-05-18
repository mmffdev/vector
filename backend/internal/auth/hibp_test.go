package auth

// B16.8 P4 — HIBP client unit tests.
//
// Covers the network/parsing surface in isolation — the audit-log
// side-effect inside CheckPasswordNotBreached needs a real *audit.Logger
// with a live pool and is covered by the live login/change-password
// smoke against the side instance instead.

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHIBPMode_DefaultsToDisabled(t *testing.T) {
	t.Setenv("HIBP_CHECK_MODE", "")
	if got := hibpMode(); got != "disabled" {
		t.Fatalf("empty env: want disabled, got %q", got)
	}
	t.Setenv("HIBP_CHECK_MODE", "yes")
	if got := hibpMode(); got != "disabled" {
		t.Fatalf("typo env: want disabled, got %q", got)
	}
}

func TestHIBPMode_ParsesTelemetryAndEnforce(t *testing.T) {
	t.Setenv("HIBP_CHECK_MODE", "TELEMETRY")
	if got := hibpMode(); got != "telemetry" {
		t.Fatalf("upper: want telemetry, got %q", got)
	}
	t.Setenv("HIBP_CHECK_MODE", " enforce ")
	if got := hibpMode(); got != "enforce" {
		t.Fatalf("trimmed: want enforce, got %q", got)
	}
}

// queryHIBP is the meat — issues the range request and scans the
// response for the suffix. These tests stand up a fake HIBP server and
// pin the wire contract: prefix-5 in path, suffix-35 + colon + count
// per line, padded rows with count=0 ignored, missing suffix → 0.

func hashHexUpper(s string) string {
	h := sha1.Sum([]byte(s))
	return strings.ToUpper(hex.EncodeToString(h[:]))
}

func newFakeHIBP(t *testing.T, lines string, wantPrefix string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/"+wantPrefix) {
			t.Errorf("path missing prefix %q: %s", wantPrefix, r.URL.Path)
			http.Error(w, "bad prefix", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Add-Padding") != "true" {
			t.Errorf("Add-Padding header missing")
		}
		// Use CRLF — matches the real HIBP wire format. The parser
		// trims them.
		_, _ = fmt.Fprint(w, strings.ReplaceAll(lines, "\n", "\r\n"))
	}))
}

func TestQueryHIBP_HitReturnsCount(t *testing.T) {
	pwd := "password123"
	full := hashHexUpper(pwd)
	prefix, suffix := full[:5], full[5:]

	body := suffix + ":4271\n" +
		"0000000000000000000000000000000000F:99\n" + // unrelated bucket entry
		"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1\n"
	srv := newFakeHIBP(t, body, prefix)
	defer srv.Close()
	t.Setenv("HIBP_API_BASE", srv.URL)
	SetHIBPClient(srv.Client())
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	count, err := queryHIBP(context.Background(), prefix, suffix)
	if err != nil {
		t.Fatalf("queryHIBP: %v", err)
	}
	if count != 4271 {
		t.Fatalf("count: want 4271, got %d", count)
	}
}

func TestQueryHIBP_MissReturnsZero(t *testing.T) {
	// Random suffix that won't appear in the response.
	full := hashHexUpper("definitely-not-in-corpus-7b9d")
	prefix, suffix := full[:5], full[5:]

	// Response contains only "padding" rows — none match the suffix.
	body := "0000000000000000000000000000000000F:0\n" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0\n"
	srv := newFakeHIBP(t, body, prefix)
	defer srv.Close()
	t.Setenv("HIBP_API_BASE", srv.URL)
	SetHIBPClient(srv.Client())
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	count, err := queryHIBP(context.Background(), prefix, suffix)
	if err != nil {
		t.Fatalf("queryHIBP: %v", err)
	}
	if count != 0 {
		t.Fatalf("count: want 0, got %d", count)
	}
}

func TestQueryHIBP_PaddedRowsAreIgnored(t *testing.T) {
	// HIBP's Add-Padding response emits randomised filler rows with
	// count=0. We must not interpret a filler that happens to equal
	// the user's suffix as a real breach hit. Add-Padding's filler
	// suffixes are random — the contract is they all carry count=0,
	// so even if one DID equal our suffix we'd still report 0.
	//
	// Construct the case: the response has a row whose suffix matches
	// ours but count is 0 → must return 0, not match-with-0.
	pwd := "edge-padding-collision"
	full := hashHexUpper(pwd)
	prefix, suffix := full[:5], full[5:]

	body := suffix + ":0\n" +
		"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\n"
	srv := newFakeHIBP(t, body, prefix)
	defer srv.Close()
	t.Setenv("HIBP_API_BASE", srv.URL)
	SetHIBPClient(srv.Client())
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	count, err := queryHIBP(context.Background(), prefix, suffix)
	if err != nil {
		t.Fatalf("queryHIBP: %v", err)
	}
	if count != 0 {
		t.Fatalf("padded-row collision: want 0, got %d", count)
	}
}

func TestQueryHIBP_Non200ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	}))
	defer srv.Close()
	t.Setenv("HIBP_API_BASE", srv.URL)
	SetHIBPClient(srv.Client())
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	_, err := queryHIBP(context.Background(), "ABCDE", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
	if err == nil {
		t.Fatalf("want error on 429, got nil")
	}
	if !strings.Contains(err.Error(), "429") {
		t.Fatalf("error should name status: %v", err)
	}
}

func TestQueryHIBP_NetworkErrorReturnsError(t *testing.T) {
	// Point at an address that refuses connections. The Service.CheckPassword
	// caller swallows this into fail-open; here we just verify queryHIBP
	// surfaces it so the audit log can record the cause.
	t.Setenv("HIBP_API_BASE", "http://127.0.0.1:1")
	SetHIBPClient(&http.Client{Timeout: 100 * time.Millisecond})
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	_, err := queryHIBP(context.Background(), "ABCDE", "00000")
	if err == nil {
		t.Fatalf("want error on unreachable host, got nil")
	}
}

func TestQueryHIBP_MalformedCountReturnsError(t *testing.T) {
	pwd := "malformed-count-case"
	full := hashHexUpper(pwd)
	prefix, suffix := full[:5], full[5:]

	body := suffix + ":not-a-number\n"
	srv := newFakeHIBP(t, body, prefix)
	defer srv.Close()
	t.Setenv("HIBP_API_BASE", srv.URL)
	SetHIBPClient(srv.Client())
	defer SetHIBPClient(&http.Client{Timeout: 3 * time.Second})

	_, err := queryHIBP(context.Background(), prefix, suffix)
	if err == nil {
		t.Fatalf("want error on malformed count, got nil")
	}
}
