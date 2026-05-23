package lintchecks

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// PLA060 B16.12.6 — product-path handlers MUST emit RFC 9457
// problem+json errors via the httperr package. Raw http.Error writes
// a text/plain body without the wire contract and frequently leaks
// internal error text (pgx / pgconn / driver stack), so it is
// forbidden in non-/dev/ handler files.
//
// Exempt paths:
//   - dev_reset.go / any file under a `dev/` directory (shadow-backend
//     dev-only handlers — see docs/c_c_shadow_backend_exceptions.md).
//   - _test.go files (tests build error responses by hand).
//   - The httperr package itself (where the new helpers live).
//   - main.go (router wiring may stub a 503 with http.Error for a
//     feature-flag-off branch — those bodies are advertisements, not
//     error contracts).
//
// New offenders are an error. To carry an exemption: add the file to
// httpErrorAllowlist below alongside a TD-* entry naming the paydown
// trigger, or convert the call.

// httpErrorAllowlist names files that may still call http.Error today.
// Each entry MUST be paired with a TD entry in docs/c_tech_debt.md.
// PLA060 B16.12.1–.5 converted the five product paths named in the
// prompt 4 scope; a wider scan in B16.12.6 turned up these additional
// offenders. They are covered by TD-HTTPERR-LINT-COVERAGE (S3, deferred
// — next edit of any of these files removes the entry + converts).
var httpErrorAllowlist = map[string]string{
	"nav/entities.go":                          "TD-HTTPERR-LINT-COVERAGE",
	"portfoliomodels/adopt.go":                 "TD-HTTPERR-LINT-COVERAGE",
	"portfoliomodels/adopt_stream.go":          "TD-HTTPERR-LINT-COVERAGE",
	"portfoliomodels/adoption_state.go":        "TD-HTTPERR-LINT-COVERAGE",
	"portfoliomodels/handler_workspace_layers.go": "TD-HTTPERR-LINT-COVERAGE",
}

// scanRoot is the package tree we ratchet. We deliberately limit the
// check to backend/internal/... rather than the whole module so test
// fixtures, vendored code, and the cmd/server stub paths don't trip it.
const scanRoot = "../../internal"

func TestHTTPErrorPlacement(t *testing.T) {
	root, err := filepath.Abs(scanRoot)
	if err != nil {
		t.Fatalf("resolve scanRoot: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("scan root not found: %v", err)
	}

	var offenders []string
	err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		if strings.HasSuffix(path, "_test.go") {
			return nil
		}
		base := filepath.Base(path)
		if base == "httperr.go" {
			return nil
		}
		// Dev-only files (dev_reset.go + anything under a /dev/ segment
		// inside backend/internal). Shadow-backend exemption.
		if base == "dev_reset.go" || base == "dev.go" {
			return nil
		}
		if strings.Contains(path, string(filepath.Separator)+"dev"+string(filepath.Separator)) {
			return nil
		}
		// Allowlist by relative path.
		rel, _ := filepath.Rel(root, path)
		if _, ok := httpErrorAllowlist[rel]; ok {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 1<<20), 1<<20)
		lineNo := 0
		for s.Scan() {
			lineNo++
			line := s.Text()
			// Cheap match: http.Error( — substring is unambiguous in
			// Go because the symbol is qualified.
			if strings.Contains(line, "http.Error(") {
				offenders = append(offenders, rel+":"+itoa(lineNo))
			}
		}
		return s.Err()
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(offenders) == 0 {
		return
	}
	t.Errorf("http.Error found in product handlers — convert to httperr.Write / httperr.WriteCoded:\n  %s\n"+
		"(or add the file to httpErrorAllowlist with a TD-* reference)",
		strings.Join(offenders, "\n  "))
}

// itoa avoids importing strconv just for one line number format.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
