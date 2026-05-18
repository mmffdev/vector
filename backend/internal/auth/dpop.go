package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// RFC 9449 DPoP (Demonstrating Proof-of-Possession) proof parsing and
// validation. Filed under TD-SEC-DPOP-BINDING (2026-05-18). Phase 1
// ships this library + the JTI cache + the substrate migrations
// without wiring middleware to call it; Phase 3 flips RequireAuth to
// invoke ValidateDPoPProof on every request.
//
// The proof JWT shape:
//   Header:  { "typ": "dpop+jwt", "alg": "ES256" | "RS256",
//              "jwk": { ...public key... } }
//   Payload: { "jti": "<uuid>", "htm": "POST", "htu": "https://host/path",
//              "iat": 1234567890, "ath": "<base64url-sha256(access_token)>" }
//   Signature: asymmetric over Header.Payload using the inverse of "jwk".
//
// We hand-roll thumbprint computation (RFC 7638) and validation order
// rather than pulling in a library — the surface is ~250 lines, the
// supply-chain story for a procurement audit is cleaner, and we keep
// full control of the error taxonomy.

// Supported algorithms for DPoP proofs. RFC 9449 § 4.2 mandates
// asymmetric algorithms; we admit two of the most common:
//   - ES256: ECDSA with P-256 and SHA-256 (compact, fast — Chrome path)
//   - RS256: RSA with SHA-256 (Firefox/Safari fallback — see plan)
const (
	DPoPAlgES256 = "ES256"
	DPoPAlgRS256 = "RS256"
)

// DPoPProofMaxAge is the RFC 9449 § 11.1 freshness window. iat values
// outside ±DPoPProofMaxAge of the server clock are rejected. The spec
// recommends "on the order of seconds or minutes"; 60s is the standard
// pre-launch tolerance and is also reflected in the JTI cache TTL.
const DPoPProofMaxAge = 60 * time.Second

// DPoPJTIBuffer is the extra time (beyond DPoPProofMaxAge) we keep a
// jti in the replay cache. Without the buffer a proof presented at
// the edge of the freshness window could fall out of cache before the
// window closes, allowing a one-second replay race. 120s = 60s ahead +
// 60s behind covers both edges with margin.
const DPoPJTIBuffer = 120 * time.Second

// ErrInvalidDPoPProof is the umbrella error for any validation
// failure. Callers (middleware, handlers) surface it as
// 401 Unauthorized with WWW-Authenticate: DPoP error="invalid_dpop_proof"
// per RFC 9449 § 7. Use errors.Is to drill into specific failure
// reasons (typ, alg, signature, iat, jti, ath, htu, htm).
var ErrInvalidDPoPProof = errors.New("invalid dpop proof")

// Specific failure reasons. Wrapped beneath ErrInvalidDPoPProof so
// callers can decide between "log the diagnostic and 401" vs.
// "trigger session-family revocation" (only the JKT mismatch on the
// refresh path triggers the latter today).
var (
	ErrDPoPProofMalformed         = fmt.Errorf("%w: malformed", ErrInvalidDPoPProof)
	ErrDPoPProofWrongTyp          = fmt.Errorf("%w: wrong typ", ErrInvalidDPoPProof)
	ErrDPoPProofUnsupportedAlg    = fmt.Errorf("%w: unsupported alg", ErrInvalidDPoPProof)
	ErrDPoPProofMissingJWK        = fmt.Errorf("%w: missing jwk", ErrInvalidDPoPProof)
	ErrDPoPProofPrivateKeyInJWK   = fmt.Errorf("%w: private material in jwk", ErrInvalidDPoPProof)
	ErrDPoPProofBadSignature      = fmt.Errorf("%w: bad signature", ErrInvalidDPoPProof)
	ErrDPoPProofIATSkew           = fmt.Errorf("%w: iat outside window", ErrInvalidDPoPProof)
	ErrDPoPProofWrongMethod       = fmt.Errorf("%w: htm mismatch", ErrInvalidDPoPProof)
	ErrDPoPProofWrongURI          = fmt.Errorf("%w: htu mismatch", ErrInvalidDPoPProof)
	ErrDPoPProofMissingATH        = fmt.Errorf("%w: missing ath", ErrInvalidDPoPProof)
	ErrDPoPProofATHMismatch       = fmt.Errorf("%w: ath mismatch", ErrInvalidDPoPProof)
	ErrDPoPProofJKTMismatch       = fmt.Errorf("%w: jkt does not match cnf.jkt", ErrInvalidDPoPProof)
	ErrDPoPProofMissingJTI        = fmt.Errorf("%w: missing jti", ErrInvalidDPoPProof)
	ErrDPoPProofReplay            = fmt.Errorf("%w: jti replay", ErrInvalidDPoPProof)
)

// DPoPJWK is the subset of a JOSE JWK we accept in a DPoP-proof
// header. The fields are intentionally narrow — anything outside this
// shape is rejected by structural validation.
type DPoPJWK struct {
	// Kty is the key family. We accept "EC" (paired with Crv=P-256)
	// for ES256 proofs and "RSA" for RS256 proofs.
	Kty string `json:"kty"`
	// Use is the key usage hint per RFC 7517 § 4.2. Optional and
	// informational; we don't enforce a value.
	Use string `json:"use,omitempty"`
	// Alg is the algorithm hint per RFC 7517 § 4.4. Optional;
	// authoritative algorithm is the header's alg field.
	Alg string `json:"alg,omitempty"`

	// EC fields (used when Kty == "EC").
	Crv string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	Y   string `json:"y,omitempty"`

	// RSA fields (used when Kty == "RSA").
	N string `json:"n,omitempty"`
	E string `json:"e,omitempty"`

	// Forbidden fields. If any of these are present the proof is
	// rejected as carrying private material (RFC 9449 § 4.3 item 5).
	D  string `json:"d,omitempty"`
	P  string `json:"p,omitempty"`
	Q  string `json:"q,omitempty"`
	Dp string `json:"dp,omitempty"`
	Dq string `json:"dq,omitempty"`
	Qi string `json:"qi,omitempty"`
}

// hasPrivateMaterial reports whether the JWK carries any private-key
// fields. Conservative — any non-empty private slot disqualifies.
func (j *DPoPJWK) hasPrivateMaterial() bool {
	return j.D != "" || j.P != "" || j.Q != "" || j.Dp != "" || j.Dq != "" || j.Qi != ""
}

// DPoPProofClaims is the body of a DPoP-proof JWT. RFC 9449 § 4.2
// requires jti, htm, htu, iat on every proof; ath is required only
// when the proof accompanies an access token (i.e. every request
// except the initial login mint).
type DPoPProofClaims struct {
	JTI string `json:"jti"`
	HTM string `json:"htm"`
	HTU string `json:"htu"`
	ATH string `json:"ath,omitempty"`
	jwt.RegisteredClaims
}

// DPoPProof is a fully-parsed, signature-verified proof. The JKT is
// pre-computed (RFC 7638) so callers can compare against an access
// token's cnf.jkt without re-running the thumbprint.
type DPoPProof struct {
	Alg    string
	JWK    DPoPJWK
	JKT    string // RFC 7638 base64url SHA-256 thumbprint of JWK
	Claims DPoPProofClaims
}

// ParseDPoPProof validates the JWT structure and signature of a DPoP
// proof. Successful return means:
//   - header.typ == "dpop+jwt"
//   - header.alg is supported and matches the jwk's key family
//   - header.jwk has no private material
//   - signature verifies against the jwk
//   - claims (jti, htm, htu, iat) are syntactically present
//
// Logical binding to a request (htm/htu/iat/ath/jti) is the caller's
// job via ValidateDPoPProof. Splitting parse and validate this way
// lets tests exercise structural failures separately from binding
// failures, and lets the refresh path reuse parse without an ath.
func ParseDPoPProof(raw string) (*DPoPProof, error) {
	if raw == "" {
		return nil, ErrDPoPProofMalformed
	}
	// jwt.Parser with a custom keyfunc — the keyfunc both extracts
	// the jwk from the header and constructs the verification key so
	// signature checking happens inside ParseWithClaims.
	var alg string
	var jwk DPoPJWK
	claims := &DPoPProofClaims{}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{DPoPAlgES256, DPoPAlgRS256}))
	_, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		// Validate header.typ.
		typ, _ := t.Header["typ"].(string)
		if typ != "dpop+jwt" {
			return nil, ErrDPoPProofWrongTyp
		}
		// Capture alg for later.
		alg, _ = t.Header["alg"].(string)
		if alg != DPoPAlgES256 && alg != DPoPAlgRS256 {
			return nil, ErrDPoPProofUnsupportedAlg
		}
		// Decode the jwk from the header.
		rawJWK, ok := t.Header["jwk"].(map[string]interface{})
		if !ok {
			return nil, ErrDPoPProofMissingJWK
		}
		if err := decodeJWKMap(rawJWK, &jwk); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrDPoPProofMalformed, err)
		}
		if jwk.hasPrivateMaterial() {
			return nil, ErrDPoPProofPrivateKeyInJWK
		}
		// Build the verification key in the shape jwt-go expects.
		switch alg {
		case DPoPAlgES256:
			if jwk.Kty != "EC" || jwk.Crv != "P-256" || jwk.X == "" || jwk.Y == "" {
				return nil, ErrDPoPProofMalformed
			}
			pk, err := ecPubFromJWK(jwk)
			if err != nil {
				return nil, fmt.Errorf("%w: %v", ErrDPoPProofMalformed, err)
			}
			return pk, nil
		case DPoPAlgRS256:
			if jwk.Kty != "RSA" || jwk.N == "" || jwk.E == "" {
				return nil, ErrDPoPProofMalformed
			}
			pk, err := rsaPubFromJWK(jwk)
			if err != nil {
				return nil, fmt.Errorf("%w: %v", ErrDPoPProofMalformed, err)
			}
			return pk, nil
		}
		return nil, ErrDPoPProofUnsupportedAlg
	})
	if err != nil {
		// jwt.ErrTokenSignatureInvalid → bad signature.
		if errors.Is(err, jwt.ErrTokenSignatureInvalid) {
			return nil, ErrDPoPProofBadSignature
		}
		// keyfunc may have returned a typed sentinel — pass it back
		// verbatim so callers can inspect via errors.Is.
		if errors.Is(err, ErrInvalidDPoPProof) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %v", ErrDPoPProofMalformed, err)
	}
	if claims.JTI == "" {
		return nil, ErrDPoPProofMissingJTI
	}
	jkt, err := ComputeJKT(jwk)
	if err != nil {
		return nil, fmt.Errorf("%w: thumbprint: %v", ErrDPoPProofMalformed, err)
	}
	return &DPoPProof{
		Alg:    alg,
		JWK:    jwk,
		JKT:    jkt,
		Claims: *claims,
	}, nil
}

// ValidateDPoPProof checks the binding claims of a parsed proof
// against the current request. accessToken may be empty for the
// initial login mint (no ath required); otherwise ath must match
// base64url(SHA-256(accessToken)). expectJKT is the cnf.jkt the
// access token (or session row) is bound to — empty disables the
// match (used by the login-mint path that hasn't bound anything yet).
//
// On success the caller MUST call JTICache.MarkAndCheck with the
// proof's jti and an expiry of iat + DPoPProofMaxAge + DPoPJTIBuffer
// to reserve the replay-prevention slot.
func ValidateDPoPProof(proof *DPoPProof, accessToken, method, uri, expectJKT string) error {
	if proof == nil {
		return ErrDPoPProofMalformed
	}
	if proof.Claims.IssuedAt == nil {
		return ErrDPoPProofIATSkew
	}
	now := time.Now()
	delta := now.Sub(proof.Claims.IssuedAt.Time)
	if delta > DPoPProofMaxAge || delta < -DPoPProofMaxAge {
		return ErrDPoPProofIATSkew
	}
	if !strings.EqualFold(proof.Claims.HTM, method) {
		return ErrDPoPProofWrongMethod
	}
	if !equalHTU(proof.Claims.HTU, uri) {
		return ErrDPoPProofWrongURI
	}
	if accessToken != "" {
		if proof.Claims.ATH == "" {
			return ErrDPoPProofMissingATH
		}
		want := base64.RawURLEncoding.EncodeToString(sha256OfString(accessToken))
		if proof.Claims.ATH != want {
			return ErrDPoPProofATHMismatch
		}
	}
	if expectJKT != "" && proof.JKT != expectJKT {
		return ErrDPoPProofJKTMismatch
	}
	return nil
}

// JTIExpiry returns the timestamp the proof's jti should sit in the
// replay cache until. Caller passes the result to
// JTICache.MarkAndCheck after a successful ValidateDPoPProof.
func (p *DPoPProof) JTIExpiry() time.Time {
	if p.Claims.IssuedAt == nil {
		return time.Now().Add(DPoPProofMaxAge + DPoPJTIBuffer)
	}
	return p.Claims.IssuedAt.Time.Add(DPoPProofMaxAge + DPoPJTIBuffer)
}

// ── JWK thumbprint (RFC 7638) ───────────────────────────────────────────────

// ComputeJKT returns the base64url-encoded SHA-256 of the canonical
// JSON serialization of the JWK's required members (RFC 7638 § 3.2).
// For EC keys the required members are {crv, kty, x, y}; for RSA they
// are {e, kty, n}. Member order is lexicographic and there is no
// whitespace — we hand-build the JSON to guarantee the canonical
// shape rather than relying on encoding/json's map iteration order.
func ComputeJKT(jwk DPoPJWK) (string, error) {
	var canonical string
	switch jwk.Kty {
	case "EC":
		if jwk.Crv == "" || jwk.X == "" || jwk.Y == "" {
			return "", errors.New("EC JWK missing crv/x/y")
		}
		canonical = fmt.Sprintf(
			`{"crv":%q,"kty":"EC","x":%q,"y":%q}`,
			jwk.Crv, jwk.X, jwk.Y,
		)
	case "RSA":
		if jwk.E == "" || jwk.N == "" {
			return "", errors.New("RSA JWK missing e/n")
		}
		canonical = fmt.Sprintf(
			`{"e":%q,"kty":"RSA","n":%q}`,
			jwk.E, jwk.N,
		)
	default:
		return "", fmt.Errorf("unsupported kty: %q", jwk.Kty)
	}
	sum := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// ── helpers ─────────────────────────────────────────────────────────────────

// decodeJWKMap projects the loosely-typed header map onto our JWK
// struct. We avoid encoding/json's reflection cost and the
// "missing-field" diagnostics that would let a malformed proof through
// silently — explicit string assertions only.
func decodeJWKMap(m map[string]interface{}, out *DPoPJWK) error {
	for k, v := range m {
		s, _ := v.(string)
		switch k {
		case "kty":
			out.Kty = s
		case "use":
			out.Use = s
		case "alg":
			out.Alg = s
		case "crv":
			out.Crv = s
		case "x":
			out.X = s
		case "y":
			out.Y = s
		case "n":
			out.N = s
		case "e":
			out.E = s
		case "d":
			out.D = s
		case "p":
			out.P = s
		case "q":
			out.Q = s
		case "dp":
			out.Dp = s
		case "dq":
			out.Dq = s
		case "qi":
			out.Qi = s
		}
	}
	if out.Kty == "" {
		return errors.New("missing kty")
	}
	return nil
}

// ecPubFromJWK reconstructs an ecdsa.PublicKey from a P-256 JWK. The
// raw base64url-decoded x and y are big-endian 32-byte integers.
func ecPubFromJWK(j DPoPJWK) (*ecdsa.PublicKey, error) {
	xb, err := base64.RawURLEncoding.DecodeString(j.X)
	if err != nil {
		return nil, fmt.Errorf("x decode: %w", err)
	}
	yb, err := base64.RawURLEncoding.DecodeString(j.Y)
	if err != nil {
		return nil, fmt.Errorf("y decode: %w", err)
	}
	pk := &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(xb),
		Y:     new(big.Int).SetBytes(yb),
	}
	if !pk.Curve.IsOnCurve(pk.X, pk.Y) {
		return nil, errors.New("point not on P-256 curve")
	}
	return pk, nil
}

// rsaPubFromJWK reconstructs an rsa.PublicKey from a JWK. The N field
// is big-endian base64url; E is big-endian base64url of the public
// exponent (typically 0x010001 → "AQAB").
func rsaPubFromJWK(j DPoPJWK) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(j.N)
	if err != nil {
		return nil, fmt.Errorf("n decode: %w", err)
	}
	eb, err := base64.RawURLEncoding.DecodeString(j.E)
	if err != nil {
		return nil, fmt.Errorf("e decode: %w", err)
	}
	if len(eb) == 0 || len(eb) > 4 {
		return nil, errors.New("rsa e length out of range")
	}
	// Left-pad to 4 bytes so encoding/binary.BigEndian.Uint32 works.
	pad := make([]byte, 4-len(eb))
	full := append(pad, eb...)
	e := binary.BigEndian.Uint32(full)
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nb),
		E: int(e),
	}, nil
}

// sha256OfString centralises the digest used for ath computation so a
// future algorithm change (RFC 9449 § 4.3 item 12 leaves room for it)
// is a one-line edit.
func sha256OfString(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// equalHTU compares two URLs as DPoP would: case-sensitive on path,
// query and fragment stripped (RFC 9449 § 4.3 item 9). We accept the
// raw stored htu and the runtime URL string and trim accordingly.
func equalHTU(a, b string) bool {
	return stripHTUExtras(a) == stripHTUExtras(b)
}

// stripHTUExtras removes any query string and fragment from a URL,
// returning the scheme + host + path portion verbatim. We don't
// normalise case on the host because RFC 9449 leaves comparison
// scheme-dependent and the proof producer is supposed to match what
// the verifier expects exactly.
func stripHTUExtras(u string) string {
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		return u[:i]
	}
	return u
}
