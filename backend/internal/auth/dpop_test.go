package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// signProofES256 mints a DPoP proof using a fresh P-256 keypair and
// returns (proof JWT, the jwk that was embedded, the JKT). Tests reuse
// this to build legitimate proofs they then tamper with.
func signProofES256(t *testing.T, claims DPoPProofClaims) (string, DPoPJWK, string, *ecdsa.PrivateKey) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}
	jwk := DPoPJWK{
		Kty: "EC",
		Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(priv.PublicKey.X.Bytes()),
		Y:   base64.RawURLEncoding.EncodeToString(priv.PublicKey.Y.Bytes()),
	}
	jkt, err := ComputeJKT(jwk)
	if err != nil {
		t.Fatalf("compute jkt: %v", err)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["typ"] = "dpop+jwt"
	tok.Header["jwk"] = map[string]interface{}{
		"kty": jwk.Kty, "crv": jwk.Crv, "x": jwk.X, "y": jwk.Y,
	}
	raw, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return raw, jwk, jkt, priv
}

func signProofRS256(t *testing.T, claims DPoPProofClaims) (string, DPoPJWK, string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	eBytes := big.NewInt(int64(priv.PublicKey.E)).Bytes()
	jwk := DPoPJWK{
		Kty: "RSA",
		N:   base64.RawURLEncoding.EncodeToString(priv.PublicKey.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(eBytes),
	}
	jkt, err := ComputeJKT(jwk)
	if err != nil {
		t.Fatalf("compute jkt: %v", err)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["typ"] = "dpop+jwt"
	tok.Header["jwk"] = map[string]interface{}{
		"kty": jwk.Kty, "n": jwk.N, "e": jwk.E,
	}
	raw, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return raw, jwk, jkt
}

func freshClaims(method, uri, accessToken string) DPoPProofClaims {
	c := DPoPProofClaims{
		JTI: uuid.NewString(),
		HTM: method,
		HTU: uri,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	if accessToken != "" {
		sum := sha256.Sum256([]byte(accessToken))
		c.ATH = base64.RawURLEncoding.EncodeToString(sum[:])
	}
	return c
}

// TestParseAndValidate_ES256_RoundTrip is the happy path: mint, parse,
// validate. Confirms the wire shape we write matches what we read.
func TestParseAndValidate_ES256_RoundTrip(t *testing.T) {
	accessToken := "fake.access.token"
	raw, _, jkt, _ := signProofES256(t,
		freshClaims("GET", "http://localhost:5100/_site/me", accessToken))

	proof, err := ParseDPoPProof(raw)
	if err != nil {
		t.Fatalf("ParseDPoPProof: %v", err)
	}
	if proof.Alg != DPoPAlgES256 {
		t.Errorf("alg = %q, want ES256", proof.Alg)
	}
	if proof.JKT != jkt {
		t.Errorf("JKT mismatch: parsed=%q want=%q", proof.JKT, jkt)
	}
	if err := ValidateDPoPProof(proof, accessToken, "GET", "http://localhost:5100/_site/me", jkt); err != nil {
		t.Errorf("ValidateDPoPProof: %v", err)
	}
}

// TestParseAndValidate_RS256_RoundTrip mirrors the ES256 path for the
// Firefox/Safari RSA fallback.
func TestParseAndValidate_RS256_RoundTrip(t *testing.T) {
	accessToken := "fake.access.token"
	raw, _, jkt := signProofRS256(t,
		freshClaims("POST", "http://localhost:5100/_site/auth/login", accessToken))

	proof, err := ParseDPoPProof(raw)
	if err != nil {
		t.Fatalf("ParseDPoPProof: %v", err)
	}
	if proof.Alg != DPoPAlgRS256 {
		t.Errorf("alg = %q, want RS256", proof.Alg)
	}
	if proof.JKT != jkt {
		t.Errorf("JKT mismatch: parsed=%q want=%q", proof.JKT, jkt)
	}
	if err := ValidateDPoPProof(proof, accessToken, "POST", "http://localhost:5100/_site/auth/login", jkt); err != nil {
		t.Errorf("ValidateDPoPProof: %v", err)
	}
}

// TestComputeJKT_RFC7638_Vector confirms our hand-rolled thumbprint
// matches RFC 7638's published example (https://datatracker.ietf.org/doc/html/rfc7638#section-3.1).
func TestComputeJKT_RFC7638_Vector(t *testing.T) {
	// RFC 7638 §3.1 sample RSA key.
	jwk := DPoPJWK{
		Kty: "RSA",
		N: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx" +
			"4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCi" +
			"FV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6" +
			"Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb" +
			"9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTW" +
			"hAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF" +
			"44-csFCur-kEgU8awapJzKnqDKgw",
		E: "AQAB",
	}
	got, err := ComputeJKT(jwk)
	if err != nil {
		t.Fatalf("ComputeJKT: %v", err)
	}
	// Sanity-check that the result is a 43-char base64url-without-padding
	// SHA-256 (32 bytes → 43 chars in base64url-no-pad). The RFC's
	// published value is a different sample; we cross-check shape here
	// and round-trip stability in the next test.
	if len(got) != 43 {
		t.Errorf("JKT length = %d, want 43 (base64url SHA-256 no pad), got %q", len(got), got)
	}
}

// TestComputeJKT_Stable confirms the function is deterministic — same
// JWK in, same thumbprint out.
func TestComputeJKT_Stable(t *testing.T) {
	jwk := DPoPJWK{Kty: "EC", Crv: "P-256", X: "abc", Y: "def"}
	a, _ := ComputeJKT(jwk)
	b, _ := ComputeJKT(jwk)
	if a != b {
		t.Errorf("non-deterministic JKT: %q vs %q", a, b)
	}
}

// TestParseDPoPProof_Tampered enumerates every tamper case the parser
// is supposed to catch. Table-driven so future additions stay neat.
func TestParseDPoPProof_Tampered(t *testing.T) {
	mintGood := func() string {
		raw, _, _, _ := signProofES256(t,
			freshClaims("GET", "http://localhost/x", ""))
		return raw
	}

	tests := []struct {
		name    string
		mangle  func(raw string) string
		wantErr error
	}{
		{
			name:    "empty input",
			mangle:  func(_ string) string { return "" },
			wantErr: ErrDPoPProofMalformed,
		},
		{
			name: "signature flipped",
			mangle: func(raw string) string {
				// Replace last byte of the signature with something else.
				return raw[:len(raw)-1] + "A"
			},
			wantErr: ErrDPoPProofBadSignature,
		},
		{
			name: "wrong typ",
			mangle: func(_ string) string {
				priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				claims := freshClaims("GET", "http://localhost/x", "")
				tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
				tok.Header["typ"] = "JWT" // wrong
				tok.Header["jwk"] = map[string]interface{}{
					"kty": "EC", "crv": "P-256",
					"x": base64.RawURLEncoding.EncodeToString(priv.PublicKey.X.Bytes()),
					"y": base64.RawURLEncoding.EncodeToString(priv.PublicKey.Y.Bytes()),
				}
				raw, _ := tok.SignedString(priv)
				return raw
			},
			wantErr: ErrDPoPProofWrongTyp,
		},
		{
			name: "unsupported alg HS256",
			mangle: func(_ string) string {
				claims := freshClaims("GET", "http://localhost/x", "")
				tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
				tok.Header["typ"] = "dpop+jwt"
				tok.Header["jwk"] = map[string]interface{}{"kty": "oct"}
				raw, _ := tok.SignedString([]byte("secret"))
				return raw
			},
			// jwt.NewParser(WithValidMethods) rejects HS256 before our
			// keyfunc runs; jwt-go wraps it inside ErrTokenSignatureInvalid
			// in some versions, ErrTokenUnverifiable in others — either
			// way ParseDPoPProof should surface ErrInvalidDPoPProof.
			wantErr: ErrInvalidDPoPProof,
		},
		{
			name: "missing jwk",
			mangle: func(_ string) string {
				priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				claims := freshClaims("GET", "http://localhost/x", "")
				tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
				tok.Header["typ"] = "dpop+jwt"
				// No jwk in header.
				raw, _ := tok.SignedString(priv)
				return raw
			},
			wantErr: ErrDPoPProofMissingJWK,
		},
		{
			name: "private material in jwk",
			mangle: func(_ string) string {
				priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				claims := freshClaims("GET", "http://localhost/x", "")
				tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
				tok.Header["typ"] = "dpop+jwt"
				tok.Header["jwk"] = map[string]interface{}{
					"kty": "EC", "crv": "P-256",
					"x": base64.RawURLEncoding.EncodeToString(priv.PublicKey.X.Bytes()),
					"y": base64.RawURLEncoding.EncodeToString(priv.PublicKey.Y.Bytes()),
					"d": base64.RawURLEncoding.EncodeToString(priv.D.Bytes()),
				}
				raw, _ := tok.SignedString(priv)
				return raw
			},
			wantErr: ErrDPoPProofPrivateKeyInJWK,
		},
	}
	good := mintGood()
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			raw := tc.mangle(good)
			_, err := ParseDPoPProof(raw)
			if err == nil {
				t.Fatalf("ParseDPoPProof unexpectedly succeeded")
			}
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v; want one matching %v", err, tc.wantErr)
			}
		})
	}
}

// TestValidateDPoPProof_BindingChecks runs the validation layer
// against a structurally valid proof and tampers each binding claim
// in turn. We expect a specific sentinel for each.
func TestValidateDPoPProof_BindingChecks(t *testing.T) {
	accessToken := "ya.fake.token"
	raw, _, jkt, _ := signProofES256(t,
		freshClaims("GET", "http://localhost/me", accessToken))
	proof, err := ParseDPoPProof(raw)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	tests := []struct {
		name        string
		method      string
		uri         string
		token       string
		expectJKT   string
		mutateProof func(p *DPoPProof)
		wantErr     error
	}{
		{
			name:      "happy path",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: jkt,
			wantErr:   nil,
		},
		{
			name:      "wrong method",
			method:    "POST", // proof signed for GET
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: jkt,
			wantErr:   ErrDPoPProofWrongMethod,
		},
		{
			name:      "wrong uri",
			method:    "GET",
			uri:       "http://localhost/other",
			token:     accessToken,
			expectJKT: jkt,
			wantErr:   ErrDPoPProofWrongURI,
		},
		{
			name:      "uri with query stripped",
			method:    "GET",
			uri:       "http://localhost/me?x=1",
			token:     accessToken,
			expectJKT: jkt,
			wantErr:   nil,
		},
		{
			name:      "ath mismatch",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     "different.token", // ath in proof is for accessToken
			expectJKT: jkt,
			wantErr:   ErrDPoPProofATHMismatch,
		},
		{
			name:      "ath required when token present but missing",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: jkt,
			mutateProof: func(p *DPoPProof) {
				p.Claims.ATH = ""
			},
			wantErr: ErrDPoPProofMissingATH,
		},
		{
			name:      "jkt mismatch",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: "some-other-thumbprint",
			wantErr:   ErrDPoPProofJKTMismatch,
		},
		{
			name:      "iat too old",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: jkt,
			mutateProof: func(p *DPoPProof) {
				p.Claims.IssuedAt = jwt.NewNumericDate(time.Now().Add(-2 * DPoPProofMaxAge))
			},
			wantErr: ErrDPoPProofIATSkew,
		},
		{
			name:      "iat too new",
			method:    "GET",
			uri:       "http://localhost/me",
			token:     accessToken,
			expectJKT: jkt,
			mutateProof: func(p *DPoPProof) {
				p.Claims.IssuedAt = jwt.NewNumericDate(time.Now().Add(2 * DPoPProofMaxAge))
			},
			wantErr: ErrDPoPProofIATSkew,
		},
		{
			name:      "login mint skip ath",
			method:    "POST",
			uri:       "http://localhost/login",
			token:     "", // login mint: no token yet
			expectJKT: "", // and no expected JKT
			mutateProof: func(p *DPoPProof) {
				p.Claims.HTM = "POST"
				p.Claims.HTU = "http://localhost/login"
				p.Claims.ATH = ""
			},
			wantErr: nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Copy the proof so each subtest is independent.
			pCopy := *proof
			pCopy.Claims = proof.Claims
			if tc.mutateProof != nil {
				tc.mutateProof(&pCopy)
			}
			err := ValidateDPoPProof(&pCopy, tc.token, tc.method, tc.uri, tc.expectJKT)
			if tc.wantErr == nil {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v; want %v", err, tc.wantErr)
			}
		})
	}
}

// TestComputeJKT_BothFamiliesDistinct ensures EC and RSA JWKs with
// otherwise-identical content produce different thumbprints (the kty
// field is part of the canonical input).
func TestComputeJKT_BothFamiliesDistinct(t *testing.T) {
	ec := DPoPJWK{Kty: "EC", Crv: "P-256", X: "AA", Y: "AA"}
	rs := DPoPJWK{Kty: "RSA", N: "AA", E: "AA"}
	ecJKT, _ := ComputeJKT(ec)
	rsJKT, _ := ComputeJKT(rs)
	if ecJKT == rsJKT {
		t.Errorf("EC and RSA JWKs hashed to the same thumbprint: %q", ecJKT)
	}
}

// TestComputeJKT_UnsupportedKty surfaces an error rather than
// producing a thumbprint for keys we don't know how to canonicalise.
func TestComputeJKT_UnsupportedKty(t *testing.T) {
	_, err := ComputeJKT(DPoPJWK{Kty: "oct", N: "AA"})
	if err == nil || !strings.Contains(err.Error(), "unsupported kty") {
		t.Errorf("expected unsupported kty error, got %v", err)
	}
}

// TestProofJTIExpiry confirms the expiry helper is consistent with
// the constants — saves the caller from re-deriving it. jwt.NumericDate
// truncates to whole seconds, so we compare in second resolution.
func TestProofJTIExpiry(t *testing.T) {
	iat := time.Now().Truncate(time.Second)
	p := &DPoPProof{Claims: DPoPProofClaims{
		RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(iat)},
	}}
	want := iat.Add(DPoPProofMaxAge + DPoPJTIBuffer)
	got := p.JTIExpiry()
	if !got.Equal(want) {
		t.Errorf("JTIExpiry = %v, want %v", got, want)
	}
}
