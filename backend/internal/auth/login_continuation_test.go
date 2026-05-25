package auth

// Tests for isSafeContinuationPath — the gate on what may be stored
// in the post-login redirect cookie. The pre-2026-05-24 version
// accepted any leading-slash path except `/v2/*`; in production that
// allowed background probes (Chrome DevTools workspace discovery,
// favicon, security.txt) to poison the cookie. After a successful
// login the frontend would send the user to the probe path rather
// than their start page.
//
// These tests pin both directions: probe paths reject, real app
// routes accept.

import "testing"

func TestIsSafeContinuationPath_Accepts(t *testing.T) {
	for _, p := range []string{
		"/",
		"/dashboard",
		"/work-items",
		"/portfolio-items",
		"/user/account-settings",
		"/workspace-admin/workspace-details",
		"/portfolio-items?meg=abc",
		"/work-items/12345",
		"/teams/eng/v1.2/page", // dot inside an earlier segment is fine
	} {
		if !isSafeContinuationPath(p) {
			t.Errorf("isSafeContinuationPath(%q) = false, want true", p)
		}
	}
}

func TestIsSafeContinuationPath_RejectsProbes(t *testing.T) {
	for _, p := range []string{
		// Original symptom — Chrome DevTools workspace discovery.
		"/.well-known/appspecific/com.chrome.devtools.json",
		// Other /.well-known probes.
		"/.well-known/security.txt",
		"/.well-known/openid-configuration",
		"/.well-known",
		// Next.js BFF mounts.
		"/api/health",
		"/api",
		// Build assets.
		"/_next/static/chunks/main.js",
		"/_next",
		// Go backend mount (would loop the bouncer).
		"/_site/auth/me",
		"/_site",
		// Legacy v2 API surface.
		"/v2/items",
		"/v2",
		// File-extension probes — the terminal segment carries an
		// extension, so it's a static-asset probe not a page route.
		"/favicon.ico",
		"/robots.txt",
		"/sitemap.xml",
		"/manifest.json",
		"/logo.svg",
		"/style.css",
		"/source.map",
		"/image.png",
		"/fonts/regular.woff2",
	} {
		if isSafeContinuationPath(p) {
			t.Errorf("isSafeContinuationPath(%q) = true, want false (probe)", p)
		}
	}
}

func TestIsSafeContinuationPath_RejectsMalformed(t *testing.T) {
	for _, p := range []string{
		"",                          // empty
		"no-leading-slash",          // relative
		"//evil.example.com/path",   // protocol-relative
		"/\\evil.example.com/path",  // protocol-relative via backslash
	} {
		if isSafeContinuationPath(p) {
			t.Errorf("isSafeContinuationPath(%q) = true, want false (malformed)", p)
		}
	}
}
