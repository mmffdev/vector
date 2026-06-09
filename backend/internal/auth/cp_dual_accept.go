package auth

// cp_dual_accept.go — PLAT1.7 slice E: Vector accepts Control-Plane (CP) tokens.
//
// The CP OIDC OP (mmffdev-platform, internal/oidc) issues access tokens that are
// claim-byte-identical to Vector's own AccessClaims (same iss=vector-auth,
// aud=vector-api, sub/email/role/subscription_id/workspace_id/sid/cnf), but signed
// asymmetrically with ES384 (ECDSA P-384, government-grade) and verified via the
// CP's public JWKS — NOT Vector's HS256 shared secret. This is the real OIDC
// end-state where Vector is a pure relying party with no shared signing secret.
//
// SAFETY MODEL — this file changes NOTHING about Vector's behaviour unless an
// operator explicitly opts in:
//
//   - ParseAccessToken (tokens.go) is untouched: HS256-only, exactly as before.
//   - ParseAccessTokenDualAccept tries the LEGACY HS256 path FIRST and returns its
//     result whenever it succeeds — byte-for-byte the legacy outcome. Only when
//     HS256 fails AND the dual-accept flag is on does it attempt the ES384/JWKS
//     path. So with the flag OFF (default) this is a pure pass-through to legacy.
//   - Even with the flag ON, a valid Vector HS256 token takes the legacy path and
//     the ES384 path is never reached — no divergence is possible for existing
//     tokens. The ES384 path only ever turns a token that legacy would REJECT
//     (a CP-issued ES384 token) into an acceptance; it can never flip an
//     accept→reject.
//
// SHADOW-RUN: when CP_AUTH_SHADOW is on, every dual-accept parse records which
// path resolved the token (legacy / cp-es384 / both-rejected) via the injectable
// shadowSink, so a /dev dashboard (or logs) can show the legacy-vs-CP mix BEFORE
// any cutover. The cutover itself (retire HS256) is PLAT1.12 — explicitly NOT
// done here. This is the safety gate, not the flip.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v5"
)

// dualAcceptAlg is the CP OP's token-signing algorithm (ES384 / ECDSA P-384).
const dualAcceptAlg = "ES384"

// CPDualAcceptEnabled reports whether the ES384/JWKS dual-accept path is active.
// Default OFF — Vector is HS256-only until an operator flips CP_AUTH_DUAL_ACCEPT.
// Gated identically to REQUIRE_SID_CLAIM (true/1/yes, case-insensitive).
func CPDualAcceptEnabled() bool {
	switch strings.ToLower(os.Getenv("CP_AUTH_DUAL_ACCEPT")) {
	case "true", "1", "yes":
		return true
	}
	return false
}

// CPShadowEnabled reports whether shadow-run recording is active. Independent of
// dual-accept: an operator can record the legacy/CP path mix (shadow) without yet
// accepting CP tokens (dual-accept), or both together.
func CPShadowEnabled() bool {
	switch strings.ToLower(os.Getenv("CP_AUTH_SHADOW")) {
	case "true", "1", "yes":
		return true
	}
	return false
}

// ShadowPath names which verification path resolved (or failed) a token.
type ShadowPath string

const (
	ShadowPathLegacyHS256 ShadowPath = "legacy-hs256"
	ShadowPathCPES384     ShadowPath = "cp-es384"
	ShadowPathBothReject  ShadowPath = "both-rejected"
)

// ShadowSink records dual-accept path outcomes for the shadow dashboard. The
// default sink is an in-memory counter; a DB-backed sink (cp_shadow_divergence)
// can replace it in PLAT1.10/1.12 without touching the parse path.
type ShadowSink interface {
	Record(path ShadowPath)
}

// inMemShadowSink is the default ShadowSink: process-local counters. Safe for
// concurrent use.
type inMemShadowSink struct {
	mu     sync.Mutex
	counts map[ShadowPath]uint64
}

func newInMemShadowSink() *inMemShadowSink {
	return &inMemShadowSink{counts: make(map[ShadowPath]uint64)}
}

func (s *inMemShadowSink) Record(p ShadowPath) {
	s.mu.Lock()
	s.counts[p]++
	s.mu.Unlock()
}

// Counts returns a snapshot of the recorded path tallies.
func (s *inMemShadowSink) Counts() map[ShadowPath]uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[ShadowPath]uint64, len(s.counts))
	for k, v := range s.counts {
		out[k] = v
	}
	return out
}

// defaultShadowSink is the package-level sink. Tests can swap it via SetShadowSink.
var defaultShadowSink ShadowSink = newInMemShadowSink()

// SetShadowSink replaces the package shadow sink (test seam / DB-backed wiring).
func SetShadowSink(s ShadowSink) { defaultShadowSink = s }

// ShadowCounts exposes the default in-memory sink's tallies (nil if a non-default
// sink is installed). Used by a /dev observability handler.
func ShadowCounts() map[ShadowPath]uint64 {
	if s, ok := defaultShadowSink.(*inMemShadowSink); ok {
		return s.Counts()
	}
	return nil
}

// cpJWKS holds the CP OP's published verifying keys, keyed by kid. Loaded from
// CP_JWKS_JSON (the raw JWKS document) and cached. The cache is guarded by a
// mutex (not sync.Once) so tests can reset it via resetCPJWKSCacheForTest when
// they install a different CP_JWKS_JSON.
var (
	cpJWKSMu     sync.Mutex
	cpJWKSLoaded bool
	cpJWKSKeys   map[string]*ecdsa.PublicKey
	cpJWKSErr    error
)

// jwksDoc / jwkEntry mirror the CP signer's published JWKS shape (RFC 7517,
// EC P-384 public keys only).
type jwksDoc struct {
	Keys []jwkEntry `json:"keys"`
}

type jwkEntry struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
}

// loadCPJWKS returns the cached kid→P-384 key map, loading it from CP_JWKS_JSON
// on first use. Empty/absent env yields an empty map (the ES384 path finds no key
// and declines — legacy behaviour unchanged). Malformed JSON or an off-curve
// point is a real error. Cache guarded by cpJWKSMu so tests can reset it.
func loadCPJWKS() (map[string]*ecdsa.PublicKey, error) {
	cpJWKSMu.Lock()
	defer cpJWKSMu.Unlock()
	if cpJWKSLoaded {
		return cpJWKSKeys, cpJWKSErr
	}
	cpJWKSKeys, cpJWKSErr = loadCPJWKSFrom(os.Getenv("CP_JWKS_JSON"))
	cpJWKSLoaded = true
	return cpJWKSKeys, cpJWKSErr
}

// loadCPJWKSFrom parses a raw JWKS document into a kid→P-384 key map. An empty
// document is not an error — it yields an empty map (decline path). Shared by the
// env loader and tests.
func loadCPJWKSFrom(raw string) (map[string]*ecdsa.PublicKey, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]*ecdsa.PublicKey{}, nil
	}
	var doc jwksDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("auth: parse CP JWKS: %w", err)
	}
	keys := make(map[string]*ecdsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "EC" || k.Crv != "P-384" {
			continue // CP signs only with EC P-384; ignore anything else
		}
		pub, err := p384FromXY(k.X, k.Y)
		if err != nil {
			return nil, fmt.Errorf("auth: CP JWKS kid %q: %w", k.Kid, err)
		}
		keys[k.Kid] = pub
	}
	return keys, nil
}

// resetCPJWKSCacheForTest clears the cached JWKS so a test can install a fresh
// CP_JWKS_JSON. Test-only seam (exported-to-package, used by cp_dual_accept_test).
func resetCPJWKSCacheForTest() {
	cpJWKSMu.Lock()
	cpJWKSLoaded = false
	cpJWKSKeys = nil
	cpJWKSErr = nil
	cpJWKSMu.Unlock()
}

// p384FromXY reconstructs an ECDSA P-384 public key from base64url JWK coords.
func p384FromXY(xB64, yB64 string) (*ecdsa.PublicKey, error) {
	xb, err := base64.RawURLEncoding.DecodeString(xB64)
	if err != nil {
		return nil, fmt.Errorf("decode x: %w", err)
	}
	yb, err := base64.RawURLEncoding.DecodeString(yB64)
	if err != nil {
		return nil, fmt.Errorf("decode y: %w", err)
	}
	pub := &ecdsa.PublicKey{
		Curve: elliptic.P384(),
		X:     new(big.Int).SetBytes(xb),
		Y:     new(big.Int).SetBytes(yb),
	}
	if !pub.Curve.IsOnCurve(pub.X, pub.Y) {
		return nil, errors.New("public point not on P-384")
	}
	return pub, nil
}

// ErrCPTokenNoKey is returned internally when an ES384 token names a kid the
// configured JWKS doesn't carry — treated as "decline" (legacy reject stands).
var ErrCPTokenNoKey = errors.New("auth: CP token kid not in configured JWKS")

// parseCPES384 verifies raw as a CP-issued ES384 token via the configured JWKS,
// applying the SAME iss/aud policy as the legacy path. Returns the claims on
// success. Any failure (no key, bad sig, wrong iss/aud) returns an error and the
// caller keeps the legacy rejection.
func parseCPES384(raw string) (*AccessClaims, error) {
	keys, err := loadCPJWKS()
	if err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, ErrCPTokenNoKey
	}
	claims := &AccessClaims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != dualAcceptAlg {
			return nil, fmt.Errorf("auth: CP token alg = %v, want %s", t.Header["alg"], dualAcceptAlg)
		}
		kid, _ := t.Header["kid"].(string)
		pub, ok := keys[kid]
		if !ok {
			return nil, ErrCPTokenNoKey
		}
		return pub, nil
	}, jwt.WithValidMethods([]string{dualAcceptAlg}))
	if err != nil {
		return nil, err
	}
	// Identical iss/aud policy as the legacy path — a CP token must satisfy the
	// same B16.8.8 contract.
	if err := validateIssAud(claims.RegisteredClaims); err != nil {
		return nil, err
	}
	return claims, nil
}

// ParseAccessTokenDualAccept is the behaviour-preserving slice-E entrypoint.
//
// It ALWAYS tries the legacy HS256 path first (ParseAccessToken) and returns that
// result whenever it succeeds — so with the dual-accept flag off, or for any
// existing Vector token, this is exactly ParseAccessToken. Only when the legacy
// path fails AND CP_AUTH_DUAL_ACCEPT is on does it attempt the CP ES384/JWKS path,
// which can only turn a legacy-reject into an accept (never the reverse).
//
// When CP_AUTH_SHADOW is on it records which path resolved the token so the
// legacy-vs-CP mix is observable before the PLAT1.12 cutover. Callers that want
// the strict legacy contract keep calling ParseAccessToken directly.
func ParseAccessTokenDualAccept(raw string) (*AccessClaims, error) {
	legacyClaims, legacyErr := ParseAccessToken(raw)
	if legacyErr == nil {
		if CPShadowEnabled() {
			defaultShadowSink.Record(ShadowPathLegacyHS256)
		}
		return legacyClaims, nil
	}

	// Legacy rejected. Only consider the CP path when explicitly enabled.
	if !CPDualAcceptEnabled() {
		return nil, legacyErr
	}
	cpClaims, cpErr := parseCPES384(raw)
	if cpErr == nil {
		if CPShadowEnabled() {
			defaultShadowSink.Record(ShadowPathCPES384)
		}
		return cpClaims, nil
	}
	if CPShadowEnabled() {
		defaultShadowSink.Record(ShadowPathBothReject)
	}
	// Surface the LEGACY error (stable, existing behaviour for callers/tests);
	// the CP attempt was additive and its failure must not change the error a
	// non-CP token already produced.
	return nil, legacyErr
}
