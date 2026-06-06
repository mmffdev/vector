package auth

// B1/B2 — multi-tab stale refresh-cookie logout (Cause 2).
//
// Root cause: the grace-window resolver re-emitted from the IMMEDIATE
// successor only (a single hop). When a second tab rotates the shared
// browser refresh cookie, the first tab's token becomes TWO+ rotations
// stale; its single-hop successor is itself already revoked, so the path
// fell through to revoke-all → 401 → logout. The coordinator never
// helped because the two tabs refresh ~15s apart (no concurrent lock
// contention). See TD-AUTH-MULTITAB-STALE-RT-COOKIE.
//
// Fix: walk the successor_hash chain forward to the LIVE head, bounded by
// a max-hop cap (defence against a crafted long chain). These tests pin
// the pure walk over an in-memory chain — no DB. Written red-first
// against resolveLiveHead, which does not yet exist.
//
// SECURITY: resolveLiveHead only chooses WHICH legitimate successor a
// same-key tab lands on. The DPoP binding check (incomingJKT vs the
// resolved head's bound jkt) stays in refreshFromSuccessor and is NOT
// relaxed by the walk — a stolen token still fails that check and nukes
// the family. The walk does not look at jkt at all.

import "testing"

// memChain builds a fetch callback over an in-memory chain keyed by hash.
// Only the walk-relevant fields of chainHop (defined in grace_chain.go)
// are set here; the identity fields are exercised by the integration test.
func memChain(hops ...chainHop) func(string) (chainHop, bool) {
	m := make(map[string]chainHop, len(hops))
	for _, h := range hops {
		m[h.hash] = h
	}
	return func(hash string) (chainHop, bool) {
		h, ok := m[hash]
		return h, ok
	}
}

// The bug repro: tab0's original token (A) is revoked and points to B,
// which is ALSO revoked (tab2 rotated again) and points to live head C.
// Single-hop resolution would land on revoked B and fail; the walk must
// reach live C.
func TestResolveLiveHead_WalksPastRevokedSuccessorToLiveHead(t *testing.T) {
	fetch := memChain(
		chainHop{hash: "B", revoked: true, successorHash: "C"},
		chainHop{hash: "C", revoked: false, successorHash: ""}, // live head
	)
	head, ok := resolveLiveHead("B", fetch, 8)
	if !ok {
		t.Fatal("expected to resolve a live head by walking past revoked B")
	}
	if head.hash != "C" {
		t.Errorf("resolved head = %q, want live head C", head.hash)
	}
}

// Immediate successor already live → returns it directly (single hop is
// still the common case and must keep working).
func TestResolveLiveHead_ImmediateLiveSuccessor(t *testing.T) {
	fetch := memChain(
		chainHop{hash: "C", revoked: false, successorHash: ""},
	)
	head, ok := resolveLiveHead("C", fetch, 8)
	if !ok || head.hash != "C" {
		t.Fatalf("immediate live successor: got (%+v, %v), want C/true", head, ok)
	}
}

// Whole chain is revoked with no live head → no resolution (caller then
// returns ErrTokenExpired; genuine reuse handling is unchanged).
func TestResolveLiveHead_NoLiveHeadInChain(t *testing.T) {
	fetch := memChain(
		chainHop{hash: "B", revoked: true, successorHash: "C"},
		chainHop{hash: "C", revoked: true, successorHash: ""},
	)
	if _, ok := resolveLiveHead("B", fetch, 8); ok {
		t.Error("a fully-revoked chain must NOT resolve to a live head")
	}
}

// An expired (but not revoked) head is not live → no resolution.
func TestResolveLiveHead_ExpiredHeadNotLive(t *testing.T) {
	fetch := memChain(
		chainHop{hash: "C", revoked: false, expired: true, successorHash: ""},
	)
	if _, ok := resolveLiveHead("C", fetch, 8); ok {
		t.Error("an expired head must NOT count as a live head")
	}
}

// Max-hop bound: a chain longer than the cap must NOT be walked to the
// end — defence against a crafted/very long revoked chain.
func TestResolveLiveHead_MaxHopBoundStopsWalk(t *testing.T) {
	// B→C→D→E(live), but cap the walk at 2 hops → never reaches E.
	fetch := memChain(
		chainHop{hash: "B", revoked: true, successorHash: "C"},
		chainHop{hash: "C", revoked: true, successorHash: "D"},
		chainHop{hash: "D", revoked: true, successorHash: "E"},
		chainHop{hash: "E", revoked: false, successorHash: ""},
	)
	if _, ok := resolveLiveHead("B", fetch, 2); ok {
		t.Error("walk must stop at the max-hop bound and not resolve E")
	}
}

// A dangling successor_hash (points nowhere) terminates the walk safely.
func TestResolveLiveHead_DanglingSuccessorTerminates(t *testing.T) {
	fetch := memChain(
		chainHop{hash: "B", revoked: true, successorHash: "GONE"},
	)
	if _, ok := resolveLiveHead("B", fetch, 8); ok {
		t.Error("a dangling successor pointer must not resolve a live head")
	}
}
