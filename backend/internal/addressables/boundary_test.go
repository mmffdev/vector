package addressables_test

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestPackageBoundary asserts that addressables is the SOLE writer for
// page_addressables and page_help. It fails CI if any file outside
// backend/internal/addressables/ contains an INSERT/UPDATE/DELETE SQL
// string targeting either table.
//
// The same regex is wired into lint:addressables in story 00260 so the
// pre-commit hook catches it before CI.
//
// Why ripgrep instead of an AST walk: the SQL strings live as Go raw
// string literals; an AST walk would have to re-parse the SQL to detect
// writes. A regex on the literal text is faster and good enough — false
// positives would be a Go file that names the table inside a comment
// (allowed: see ALLOWED_NON_SQL_USES below).
func TestPackageBoundary(t *testing.T) {
	repoRoot, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}

	// Find rg, skip when unavailable so devs without ripgrep aren't blocked.
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("ripgrep not installed; CI runs the boundary check via npm script in story 00260")
	}

	// Pattern: SQL write keyword + table name on the same line.
	pattern := `(?i)(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(page_addressables|page_help)\b`

	cmd := exec.Command("rg",
		"--no-heading", "--line-number",
		"--type", "go",
		"-e", pattern,
		repoRoot,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err = cmd.Run()
	// rg exits 1 on no-match; that's the success case for us.
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return // no matches — boundary intact
		}
		t.Fatalf("rg failed: %v\n%s", err, out.String())
	}

	// Any matches must be inside backend/internal/addressables/.
	allowed := filepath.Join(repoRoot, "backend", "internal", "addressables") + string(filepath.Separator)
	var violations []string
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		// Each line is "path:line:content".
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}
		if !strings.HasPrefix(parts[0], allowed) {
			violations = append(violations, line)
		}
	}
	if len(violations) > 0 {
		t.Fatalf("addressables write boundary violated — these files write page_addressables/page_help directly instead of going through backend/internal/addressables/:\n%s",
			strings.Join(violations, "\n"))
	}
}
