package security

import (
	"net/http"
	"os"
	"testing"
)

// PLA-0010 / story 00348 — proves the trusted-CIDR gate. The vulnerability
// being closed: chi's middleware.RealIP was rewriting r.RemoteAddr from
// X-Forwarded-For for every request, so any client could forge their
// source IP. ClientIP() now only honours XFF when the immediate TCP
// peer is inside FRONTEND_CLIENTIP_TRUSTED_CIDRS.

func newReq(remote, xff string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = remote
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	return r
}

func withTrustedCIDRs(t *testing.T, val string) {
	t.Helper()
	t.Setenv(TrustedCIDRsEnv, val)
	resetTrustedNetsForTest()
	t.Cleanup(func() {
		// memo bleeds across cases; force re-read on the next call.
		_ = os.Unsetenv(TrustedCIDRsEnv)
		resetTrustedNetsForTest()
	})
}

func TestClientIP_SpoofedXFF_Ignored_WhenPeerNotTrusted(t *testing.T) {
	withTrustedCIDRs(t, "10.0.0.0/8")
	r := newReq("203.0.113.5:54321", "1.2.3.4")
	got := ClientIP(r)
	if got != "203.0.113.5" {
		t.Fatalf("expected RemoteAddr host (203.0.113.5), got %q", got)
	}
}

func TestClientIP_XFF_Honoured_WhenPeerInTrustedCIDR(t *testing.T) {
	withTrustedCIDRs(t, "127.0.0.1/32,::1/128")
	r := newReq("127.0.0.1:54321", "1.2.3.4")
	got := ClientIP(r)
	if got != "1.2.3.4" {
		t.Fatalf("expected first XFF hop (1.2.3.4), got %q", got)
	}
}

func TestClientIP_EmptyTrustList_AlwaysIgnoresXFF(t *testing.T) {
	withTrustedCIDRs(t, "")
	r := newReq("127.0.0.1:54321", "1.2.3.4")
	got := ClientIP(r)
	if got != "127.0.0.1" {
		t.Fatalf("secure default should ignore XFF; got %q", got)
	}
}

func TestClientIP_MultiHopXFF_ReturnsFirstHopOnly(t *testing.T) {
	withTrustedCIDRs(t, "10.0.0.0/8")
	r := newReq("10.0.0.7:443", "1.2.3.4, 5.6.7.8, 9.9.9.9")
	got := ClientIP(r)
	if got != "1.2.3.4" {
		t.Fatalf("expected first hop (1.2.3.4), got %q", got)
	}
}

func TestClientIP_NoXFF_ReturnsRemoteHost(t *testing.T) {
	withTrustedCIDRs(t, "127.0.0.1/32")
	r := newReq("127.0.0.1:54321", "")
	got := ClientIP(r)
	if got != "127.0.0.1" {
		t.Fatalf("expected RemoteAddr host (127.0.0.1), got %q", got)
	}
}

func TestClientIP_RemoteAddrWithoutPort(t *testing.T) {
	withTrustedCIDRs(t, "10.0.0.0/8")
	r := newReq("8.8.8.8", "1.2.3.4")
	got := ClientIP(r)
	if got != "8.8.8.8" {
		t.Fatalf("expected raw RemoteAddr (8.8.8.8), got %q", got)
	}
}

func TestClientIP_IPv6PeerInTrustedCIDR(t *testing.T) {
	withTrustedCIDRs(t, "::1/128")
	r := newReq("[::1]:54321", "2001:db8::1")
	got := ClientIP(r)
	if got != "2001:db8::1" {
		t.Fatalf("expected IPv6 XFF hop (2001:db8::1), got %q", got)
	}
}
