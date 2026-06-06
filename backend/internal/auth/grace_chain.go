package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// maxGraceChainHops bounds the grace-window chain-walk. A legitimate
// browser produces at most one rotation per active tab per refresh cycle,
// so a handful of stale hops within the 30s grace window is the realistic
// ceiling; 8 is comfortably above that while still capping a crafted or
// pathological chain (resolveLiveHead returns "no live head" past it).
const maxGraceChainHops = 8

// chainHop is one link in the refresh-token rotation chain as seen by the
// grace-window walk. Liveness (revoked/expired) + the pointer to the next
// link (successorHash) drive resolveLiveHead; the identity fields
// (sessID/userID/boundJKT/expiresAt) are carried so the live head the
// walk lands on can be used directly by refreshFromSuccessor without a
// re-query. In unit tests only the walk-relevant fields are set.
type chainHop struct {
	hash          string
	revoked       bool
	expired       bool
	successorHash string // "" = end of chain

	sessID    uuid.UUID
	userID    uuid.UUID
	boundJKT  string
	expiresAt time.Time
}

// resolveLiveHead walks the refresh-token rotation chain forward from
// startHash, following each revoked hop's successorHash, until it reaches
// a LIVE hop (not revoked, not expired) or runs out of chain / hops.
//
// This is the core of the Cause-2 fix (TD-AUTH-MULTITAB-STALE-RT-COOKIE):
// when a second browser tab rotates the shared refresh cookie, the first
// tab's token becomes 2+ rotations stale, so its immediate successor is
// itself revoked. A single-hop resolver fails there; walking the chain
// reaches the live head the browser actually holds.
//
// Bounds (defence-in-depth against a crafted/long chain):
//   - maxHops caps the number of links followed. A chain longer than the
//     cap returns (zero, false) rather than walking unbounded.
//   - a missing hop (dangling successorHash) terminates the walk.
//
// SECURITY: this function chooses WHICH successor to land on; it does not
// authenticate. The DPoP binding check (incomingJKT vs the resolved
// head's bound jkt) stays at the call site and is unaffected — a stolen
// token still fails that check and triggers revoke-all. The walk never
// inspects jkt.
//
// fetch returns the hop for a given hash and whether it exists. The
// returned chainHop is the live head when ok is true.
func resolveLiveHead(startHash string, fetch func(string) (chainHop, bool), maxHops int) (chainHop, bool) {
	hash := startHash
	for hop := 0; hop < maxHops; hop++ {
		h, ok := fetch(hash)
		if !ok {
			return chainHop{}, false // dangling / unknown link — stop
		}
		if !h.revoked && !h.expired {
			return h, true // live head reached
		}
		if h.successorHash == "" {
			return chainHop{}, false // end of chain, nothing live
		}
		hash = h.successorHash
	}
	return chainHop{}, false // exceeded the hop bound
}

// fetchChainHop returns the DB-backed hop-fetch closure resolveLiveHead
// needs: given a token hash, it loads that session row (liveness +
// identity + the pointer to the next link). A missing row → (zero, false)
// so the walk terminates safely on a dangling successor. An expired-but-
// not-revoked row is marked expired so it is not treated as a live head.
func (s *Service) fetchChainHop(ctx context.Context) func(string) (chainHop, bool) {
	return func(hash string) (chainHop, bool) {
		var h chainHop
		err := s.Pool.QueryRow(ctx, sqlSelectChainHopByHash, hash).
			Scan(&h.sessID, &h.userID, &h.expiresAt, &h.revoked, &h.boundJKT, &h.successorHash)
		if err == pgx.ErrNoRows {
			return chainHop{}, false
		}
		if err != nil {
			return chainHop{}, false
		}
		h.hash = hash
		h.expired = h.expiresAt.Before(time.Now())
		return h, true
	}
}
