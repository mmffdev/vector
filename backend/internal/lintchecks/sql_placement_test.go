package lintchecks

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// PLA060 B16.13.1 — SQL literals (backtick-quoted strings that begin
// with SELECT / INSERT / UPDATE / DELETE / WITH) must live in sql.go.
// The project convention: services/handlers reference named constants
// (sql<Verb><Resource>) defined in their package's sql.go. Mixing
// inline SQL into business logic makes diffs noisier, hides the
// query inventory, and lets the same JOIN drift in two places.
//
// Allowlist names packages that already break this rule today. Each
// entry MUST be paired with a TD entry in docs/c_tech_debt.md. The
// allowlist is CLOSED — adding a new entry is a lint failure (do the
// conversion instead). Removing an entry is the goal whenever you
// edit one of these packages.
//
// PLA060 B16.13.3 converts custompages as proof-of-pattern; the
// remaining six packages are tracked under TD-SQL-DRIFT.

// sqlPlacementAllowlist names packages whose non-sql.go files may
// still contain inline SQL backtick literals.
//
// PLA060 plan-time assumption: seven packages were inline-SQL
// offenders (custompages, usertaborder, apikeys, artefacttypes,
// ranking, audit, polymorphicrefs). Reality at B16.13.1 audit time:
// four of those (custompages, usertaborder, artefacttypes, audit)
// already moved their SQL into sql.go on prior unrelated work; three
// real offenders remained — apikeys, ranking, polymorphicrefs.
// B16.13.3 converted apikeys as proof of pattern; the follow-up
// pay-down then converted ranking + polymorphicrefs in 2026-05-23,
// leaving the allowlist empty. TD-SQL-DRIFT closed in the same pass.
//
// The allowlist is CLOSED. Adding ANY new entry is a lint failure —
// do the conversion instead. The empty map kept here documents the
// closed-set intent (and lets a future legitimate exemption land in
// review with the TD-* paperwork attached).
var sqlPlacementAllowlist = map[string]string{
	// package import path → TD-* reference
}

// sqlLiteralStart matches a backtick-delimited literal that opens
// with an UPPERCASE SQL keyword (SELECT / INSERT / UPDATE / DELETE /
// WITH). Case-sensitivity is deliberate: the project convention is
// uppercase SQL, and case-insensitive matching trips on prose like
// "emit `<tag>` with no closing tag" (the close-backtick + " with"
// runs into WITH). Uppercase-only is the smallest rule that captures
// real query openers without parsing Go source.
var sqlLiteralStart = regexp.MustCompile("`\\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\\b")

func TestSQLPlacement(t *testing.T) {
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
		if base == "sql.go" {
			return nil
		}
		// dev_reset.go + dev.go are shadow-backend dev-path files —
		// same exemption as the http.Error placement check. Short-lived
		// dev queries don't have to be hoisted into sql.go.
		if base == "dev.go" || base == "dev_reset.go" {
			return nil
		}
		if strings.Contains(path, string(filepath.Separator)+"dev"+string(filepath.Separator)) {
			return nil
		}

		rel, _ := filepath.Rel(root, path)
		// Compute the package path the way the allowlist expresses it:
		// `internal/<pkg>` where <pkg> is the first directory component
		// of `rel` (which is relative to backend/internal). For nested
		// packages (e.g. notifications/rules), we include the full
		// internal path so callers can allowlist the nested package
		// independently.
		pkgPath := "internal/" + filepath.ToSlash(filepath.Dir(rel))
		if _, exempt := sqlPlacementAllowlist[pkgPath]; exempt {
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
			if sqlLiteralStart.MatchString(line) {
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
	t.Errorf("inline SQL literal found outside sql.go — move to the package's sql.go as a named const sql<Verb><Resource>:\n  %s\n"+
		"(or add the package to sqlPlacementAllowlist with a TD-* reference — only for pre-existing offenders, do not extend)",
		strings.Join(offenders, "\n  "))
}
