package auth

// B16.8 P4 — Have-I-Been-Pwned (HIBP) breach-password check.
//
// Uses the k-anonymity Pwned Passwords API
// (https://api.pwnedpasswords.com/range/{SHA1prefix5}). We send only
// the first 5 hex characters of the SHA-1 of the candidate password;
// the API returns every full SHA-1 in the same bucket (currently
// ~500-1000 hashes per bucket) along with sighting counts. The raw
// password never leaves the process; SHA-1 is one-way; only the
// prefix is on the wire.
//
// SHA-1 is used because HIBP demands it — k-anonymity over SHA-256
// would require their corpus to be re-hashed (it isn't, won't be).
// SHA-1 here is NOT a security primitive: the raw password is the
// secret, the hash is just an HIBP query token. bcrypt remains the
// at-rest password hash.
//
// Modes (HIBP_CHECK_MODE env):
//
//   "disabled"   (default in dev/test) — never call HIBP, never block.
//   "telemetry"  — call HIBP, log every breach hit with the user_id
//                  and the sighting count, but DO NOT block the user.
//                  Use this to measure false-positive rate before
//                  enforcing.
//   "enforce"    — call HIBP, log every hit, AND reject the change
//                  with ErrBreachedPassword. The user sees a clear
//                  message asking them to choose a different password.
//
// Fail-open: a network error, slow API, or unexpected response shape
// is logged but never blocks a password write. The user's account
// security cannot become hostage to a third-party API. The audit log
// captures every fail-open so ops can spot a sustained outage.

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/audit"
)

// ErrBreachedPassword is returned by CheckPasswordNotBreached when
// HIBP_CHECK_MODE=enforce and the candidate password appears in a
// known breach corpus. Telemetry-only mode never returns this.
var ErrBreachedPassword = errors.New("password appears in known breach corpus")

// hibpClient is the package-scope HTTP client used for HIBP calls.
// 3s timeout — well below the bcrypt cost on the same write path
// so a slow API doesn't dominate the wall-clock for a password
// change. Overridable via SetHIBPClient for tests.
var hibpClient = &http.Client{Timeout: 3 * time.Second}

// SetHIBPClient swaps the package-scope HTTP client. Test-only entry
// point — production callers go through the default.
func SetHIBPClient(c *http.Client) { hibpClient = c }

// hibpEndpoint is the k-anonymity range API. Overridable via env
// HIBP_API_BASE for tests that point at a local fixture server.
func hibpEndpoint() string {
	if v := os.Getenv("HIBP_API_BASE"); v != "" {
		return strings.TrimRight(v, "/") + "/range/"
	}
	return "https://api.pwnedpasswords.com/range/"
}

// hibpMode reads HIBP_CHECK_MODE. Any value other than "telemetry" or
// "enforce" is treated as disabled — explicit-opt-in semantics so a
// typo doesn't accidentally enforce.
func hibpMode() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("HIBP_CHECK_MODE")))
	switch v {
	case "telemetry", "enforce":
		return v
	default:
		return "disabled"
	}
}

// CheckPasswordNotBreached queries HIBP for the candidate password.
// userID is used only for the audit log; pass uuid.Nil for unauth'd
// flows (e.g. password-reset where the user isn't yet identified by
// session). Returns ErrBreachedPassword only when mode=enforce AND a
// breach is found AND the API responded successfully.
func (s *Service) CheckPasswordNotBreached(ctx context.Context, raw string, userID uuid.UUID) error {
	mode := hibpMode()
	if mode == "disabled" {
		return nil
	}

	// Hash + split into prefix (sent) + suffix (matched locally).
	sum := sha1.Sum([]byte(raw))
	full := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix, suffix := full[:5], full[5:]

	count, err := queryHIBP(ctx, prefix, suffix)
	if err != nil {
		// Fail-open: log and move on. Never block on third-party outage.
		s.Audit.Log(ctx, audit.Entry{
			UserID: nilIfZero(userID),
			Action: "auth.hibp_check_failed",
			Metadata: map[string]any{
				"mode":  mode,
				"error": err.Error(),
			},
		})
		return nil
	}

	if count == 0 {
		// Clean — no audit row needed (the common path).
		return nil
	}

	s.Audit.Log(ctx, audit.Entry{
		UserID: nilIfZero(userID),
		Action: "auth.hibp_breach_hit",
		Metadata: map[string]any{
			"mode":           mode,
			"sighting_count": count,
		},
	})

	if mode == "enforce" {
		return ErrBreachedPassword
	}
	return nil
}

// queryHIBP issues the range request and scans the response for the
// suffix. Returns the sighting count, or 0 if not found, or an error
// for any non-200 / read failure.
func queryHIBP(ctx context.Context, prefix, suffix string) (int, error) {
	url := hibpEndpoint() + prefix
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	// HIBP recommends a descriptive User-Agent so they can contact us
	// during incidents. "vector" is the product code.
	req.Header.Set("User-Agent", "vector-backend (security)")
	// Add-Padding: true asks HIBP to pad the response body to a fixed
	// size, defeating any size-correlation traffic analysis between
	// "all rare prefix" and "common prefix" buckets.
	req.Header.Set("Add-Padding", "true")

	resp, err := hibpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("hibp: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}

	// Response is CRLF-separated lines: SUFFIX:COUNT
	// Suffixes are uppercased hex; the padded "filler" rows we asked
	// for via Add-Padding carry count=0 so a contains-match isn't
	// vulnerable to the padding.
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimRight(line, "\r")
		i := strings.IndexByte(line, ':')
		if i <= 0 || i >= len(line)-1 {
			continue
		}
		if line[:i] == suffix {
			c, err := strconv.Atoi(line[i+1:])
			if err != nil {
				return 0, fmt.Errorf("hibp: bad count %q", line[i+1:])
			}
			return c, nil
		}
	}
	return 0, nil
}

func nilIfZero(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
