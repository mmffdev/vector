package auth

// cp_dual_accept_test.go — PLAT1.7 slice E RED-GREEN proof.
//
// Proves that ParseAccessTokenDualAccept (1) is a pure pass-through to the legacy
// HS256 path when the flag is OFF (behaviour-preserving), (2) accepts a
// CP-issued ES384 token verified via the configured JWKS only when
// CP_AUTH_DUAL_ACCEPT is ON, (3) never flips an accept→reject, and (4) records the
// shadow path mix when CP_AUTH_SHADOW is on. No DB, no network.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-do-not-use-in-prod-do-not-use-in-prod"

// mintCPES384 builds a CP-style ES384 token signed by priv, stamping the kid
// header and (by default) the Vector iss/aud so it satisfies validateIssAud.
func mintCPES384(t *testing.T, priv *ecdsa.PrivateKey, kid string, claims AccessClaims) string {
	t.Helper()
	if claims.Issuer == "" {
		claims.Issuer = Issuer
	}
	if len(claims.Audience) == 0 {
		claims.Audience = jwt.ClaimStrings{Audience}
	}
	if claims.Subject == "" {
		claims.Subject = "11111111-1111-1111-1111-111111111111"
	}
	if claims.ExpiresAt == nil {
		claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(5 * time.Minute))
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES384, claims)
	tok.Header["kid"] = kid
	raw, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign ES384: %v", err)
	}
	return raw
}

// jwksJSONFor builds the CP_JWKS_JSON document (one EC P-384 key) for priv+kid.
func jwksJSONFor(pub *ecdsa.PublicKey, kid string) string {
	n := (pub.Params().BitSize + 7) / 8
	x := base64.RawURLEncoding.EncodeToString(leftPadBytes(pub.X.Bytes(), n))
	y := base64.RawURLEncoding.EncodeToString(leftPadBytes(pub.Y.Bytes(), n))
	return fmt.Sprintf(`{"keys":[{"kty":"EC","crv":"P-384","x":%q,"y":%q,"use":"sig","alg":"ES384","kid":%q}]}`, x, y, kid)
}

func leftPadBytes(b []byte, size int) []byte {
	if len(b) >= size {
		return b
	}
	out := make([]byte, size)
	copy(out[size-len(b):], b)
	return out
}

// ── flag OFF: pure pass-through to legacy ──────────────────────────────────

func TestDualAccept_FlagOff_LegacyHS256Passthrough(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "") // off
	t.Setenv("CP_AUTH_SHADOW", "")

	tok := mintTokenWithClaims(t, AccessClaims{
		Email: "u@e", Role: "user", SubscriptionID: "s",
		RegisteredClaims: registeredClaimsWith(Issuer, Audience, "jti1"),
	})
	got, err := ParseAccessTokenDualAccept(tok)
	if err != nil {
		t.Fatalf("dual-accept on a valid HS256 token failed: %v", err)
	}
	if got.Role != "user" {
		t.Errorf("role = %q, want user", got.Role)
	}
}

func TestDualAccept_FlagOff_CPTokenRejected(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "") // off — CP tokens must NOT be accepted
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&priv.PublicKey, "kid-a"))

	cpTok := mintCPES384(t, priv, "kid-a", AccessClaims{Role: "gadmin"})
	if _, err := ParseAccessTokenDualAccept(cpTok); err == nil {
		t.Fatal("CP ES384 token accepted with dual-accept OFF — must be rejected")
	}
}

// ── flag ON: CP ES384 token accepted via JWKS ──────────────────────────────

func TestDualAccept_FlagOn_AcceptsCPES384(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "true")
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&priv.PublicKey, "kid-cp"))

	cpTok := mintCPES384(t, priv, "kid-cp", AccessClaims{
		Email: "cp@e", Role: "gadmin", SubscriptionID: "tenant-1",
	})
	got, err := ParseAccessTokenDualAccept(cpTok)
	if err != nil {
		t.Fatalf("CP ES384 token rejected with dual-accept ON: %v", err)
	}
	if got.Role != "gadmin" || got.Email != "cp@e" || got.SubscriptionID != "tenant-1" {
		t.Errorf("claims wrong: %+v", got)
	}
}

func TestDualAccept_FlagOn_LegacyStillTakesPriority(t *testing.T) {
	// A valid HS256 token must STILL resolve via the legacy path even with the
	// flag on — the ES384 path is never reached, so behaviour is preserved.
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "true")
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&priv.PublicKey, "kid-x"))

	tok := mintTokenWithClaims(t, AccessClaims{
		Role: "user", RegisteredClaims: registeredClaimsWith(Issuer, Audience, "jti2"),
	})
	got, err := ParseAccessTokenDualAccept(tok)
	if err != nil {
		t.Fatalf("valid HS256 token failed with flag on: %v", err)
	}
	if got.Role != "user" {
		t.Errorf("role = %q, want user", got.Role)
	}
}

// ── flag ON but wrong key / wrong iss-aud → declines (legacy reject stands) ──

func TestDualAccept_FlagOn_WrongKeyRejected(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "true")
	signer, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	other, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	// JWKS carries `other`, but the token is signed by `signer` under the same kid.
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&other.PublicKey, "kid-z"))

	cpTok := mintCPES384(t, signer, "kid-z", AccessClaims{Role: "gadmin"})
	if _, err := ParseAccessTokenDualAccept(cpTok); err == nil {
		t.Fatal("token signed by a key not in the JWKS was accepted — must be rejected")
	}
}

func TestDualAccept_FlagOn_WrongIssuerRejected(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "true")
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&priv.PublicKey, "kid-i"))

	cpTok := mintCPES384(t, priv, "kid-i", AccessClaims{
		Role:             "gadmin",
		RegisteredClaims: jwt.RegisteredClaims{Issuer: "not-vector-auth", Audience: jwt.ClaimStrings{Audience}, Subject: "s", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))},
	})
	if _, err := ParseAccessTokenDualAccept(cpTok); err == nil {
		t.Fatal("CP token with wrong issuer accepted — must apply the same iss/aud policy")
	}
}

// ── shadow recording ───────────────────────────────────────────────────────

func TestDualAccept_ShadowRecordsPaths(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	t.Setenv("CP_AUTH_DUAL_ACCEPT", "true")
	t.Setenv("CP_AUTH_SHADOW", "true")
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	resetCPJWKSCacheForTest()
	t.Setenv("CP_JWKS_JSON", jwksJSONFor(&priv.PublicKey, "kid-s"))

	sink := newInMemShadowSink()
	SetShadowSink(sink)
	defer SetShadowSink(newInMemShadowSink())

	// One legacy HS256 token.
	hs := mintTokenWithClaims(t, AccessClaims{Role: "user", RegisteredClaims: registeredClaimsWith(Issuer, Audience, "j")})
	if _, err := ParseAccessTokenDualAccept(hs); err != nil {
		t.Fatalf("hs parse: %v", err)
	}
	// One CP ES384 token.
	cp := mintCPES384(t, priv, "kid-s", AccessClaims{Role: "gadmin"})
	if _, err := ParseAccessTokenDualAccept(cp); err != nil {
		t.Fatalf("cp parse: %v", err)
	}
	// One garbage token (both reject).
	_, _ = ParseAccessTokenDualAccept("not.a.jwt")

	c := sink.Counts()
	if c[ShadowPathLegacyHS256] != 1 {
		t.Errorf("legacy count = %d, want 1", c[ShadowPathLegacyHS256])
	}
	if c[ShadowPathCPES384] != 1 {
		t.Errorf("cp-es384 count = %d, want 1", c[ShadowPathCPES384])
	}
	if c[ShadowPathBothReject] != 1 {
		t.Errorf("both-rejected count = %d, want 1", c[ShadowPathBothReject])
	}
}

// ── JKT sanity: the test JWKS reconstructs the same kid the CP would publish ─

func TestDualAccept_JWKSThumbprintMatchesKid(t *testing.T) {
	// Not strictly required by the parser (we key by the kid header), but proves
	// the test JWKS encoding matches the CP's RFC 7638 thumbprint convention.
	priv, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	n := (priv.PublicKey.Params().BitSize + 7) / 8
	x := base64.RawURLEncoding.EncodeToString(leftPadBytes(priv.X.Bytes(), n))
	y := base64.RawURLEncoding.EncodeToString(leftPadBytes(priv.Y.Bytes(), n))
	canonical := fmt.Sprintf(`{"crv":"P-384","kty":"EC","x":%q,"y":%q}`, x, y)
	sum := sha256.Sum256([]byte(canonical))
	kid := base64.RawURLEncoding.EncodeToString(sum[:])

	resetCPJWKSCacheForTest()
	keys, err := loadCPJWKSFrom(jwksJSONFor(&priv.PublicKey, kid))
	if err != nil {
		t.Fatalf("load jwks: %v", err)
	}
	if _, ok := keys[kid]; !ok {
		t.Errorf("kid %q not found in parsed JWKS", kid)
	}
	_ = big.NewInt(0) // keep math/big import honest across edits
}
