package security

// PLA-0010 / story 00348 — clientIP override is gated by a trusted-CIDR
// whitelist so an attacker downstream of the edge proxy cannot forge their
// source IP via X-Forwarded-For header injection.
//
// Trust model:
//   - r.RemoteAddr is set by Go's net/http from the TCP peer; it can't be
//     spoofed at the application layer.
//   - X-Forwarded-For is set by upstream proxies and is therefore only
//     meaningful when the immediate peer (RemoteAddr) is itself a trusted
//     proxy / tunnel hop. We define that "trusted" set via the env var
//     FRONTEND_CLIENTIP_TRUSTED_CIDRS — comma-separated CIDR blocks.
//   - Empty / unset list → XFF is never honoured (secure default for prod).
//   - Dev tunnel: set FRONTEND_CLIENTIP_TRUSTED_CIDRS=127.0.0.1/32,::1/128
//     in backend/.env.dev so the SSH-tunnel hop is recognised.
//
// The list is parsed once on first call and memoised. Re-reading env on
// every request would be wasted work; if the operator changes the env they
// must restart the backend (same model as JWT_ACCESS_SECRET, COOKIE_SECURE).

import (
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

const TrustedCIDRsEnv = "FRONTEND_CLIENTIP_TRUSTED_CIDRS"

var (
	trustedOnce sync.Once
	trustedNets []*net.IPNet
)

// ClientIP returns the best-known caller address. It honours the first hop
// of X-Forwarded-For only when r.RemoteAddr is inside a whitelisted CIDR;
// otherwise it falls back to the RemoteAddr host.
//
// Replaces the previous per-package helpers in auth, roles, users, wsperms
// (and the no-XFF helper in libraryreleases) — same call shape.
func ClientIP(r *http.Request) string {
	peerHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peerHost = r.RemoteAddr
	}
	if isTrustedPeer(peerHost) {
		if first := firstHopXFF(r.Header.Get("X-Forwarded-For")); first != "" {
			return first
		}
	}
	return peerHost
}

func firstHopXFF(xf string) string {
	if xf == "" {
		return ""
	}
	if i := strings.Index(xf, ","); i >= 0 {
		return strings.TrimSpace(xf[:i])
	}
	return strings.TrimSpace(xf)
}

func isTrustedPeer(host string) bool {
	loadTrustedNets()
	if len(trustedNets) == 0 {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, n := range trustedNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func loadTrustedNets() {
	trustedOnce.Do(func() {
		raw := os.Getenv(TrustedCIDRsEnv)
		if raw == "" {
			return
		}
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			_, n, err := net.ParseCIDR(part)
			if err != nil {
				continue
			}
			trustedNets = append(trustedNets, n)
		}
	})
}

// resetTrustedNetsForTest clears the memoised list so tests can swap env.
// Test-only; never call from production code.
func resetTrustedNetsForTest() {
	trustedOnce = sync.Once{}
	trustedNets = nil
}
