package devtools

import (
	"os"
	"strings"
)

// devEnvAllowed reports whether destructive devtools actions may run in the
// current process. It FAILS CLOSED, mirroring auth.mfaDevBypass: it returns
// true ONLY when BACKEND_ENV is an explicit, recognised non-production value.
// Any unset, unknown, or production-ish value returns false, so a misconfigured
// or production deployment can never execute a reseed/cleanup even if the route
// is somehow reachable.
//
// This is defence-in-depth on top of the route's permission gate — the gate
// controls WHO can call it; this controls WHERE it can run at all.
func devEnvAllowed() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("BACKEND_ENV"))) {
	case "dev", "development", "local", "test":
		return true
	}
	// Note: staging is deliberately EXCLUDED. These actions hard-delete tenant
	// data with no audit trail; restrict them to throwaway local/dev DBs.
	return false
}

// DevEnvAllowed is the exported guard for callers outside the package (the HTTP
// handler in handler.go). It is a thin wrapper over the unexported devEnvAllowed
// so the fail-closed BACKEND_ENV check stays in one place.
func DevEnvAllowed() bool { return devEnvAllowed() }
