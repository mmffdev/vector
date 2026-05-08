package orgdesign_test

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestPackageBoundary asserts that orgdesign is the SOLE writer for
// org_nodes, org_node_roles, org_node_view_state, and org_levels.
// It fails CI if any .go file outside backend/internal/orgdesign/
// contains an INSERT/UPDATE/DELETE SQL string targeting one of those
// tables.
//
// Mirrors the addressables boundary test (see
// backend/internal/addressables/boundary_test.go) — same mechanism,
// different tables. SQL migrations under db/schema/ are exempt
// because the rg invocation scopes to .go files; migration 085's
// bootstrap INSERT into org_nodes is the documented exception
// described in db/schema/085_org_node_id_fk.sql.
func TestPackageBoundary(t *testing.T) {
	repoRoot, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}

	// Skip when ripgrep is unavailable so devs without rg installed
	// aren't blocked locally; CI runs the same regex via lint.
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("ripgrep not installed; CI runs the boundary check via the lint step")
	}

	pattern := `(?i)(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(org_nodes|roles_org_nodes|org_node_view_state|org_levels)\b`

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
	// rg exits 1 on no-match — that's success for us.
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return
		}
		t.Fatalf("rg failed: %v\n%s", err, out.String())
	}

	allowed := filepath.Join(repoRoot, "backend", "internal", "orgdesign") + string(filepath.Separator)
	var violations []string
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}
		if !strings.HasPrefix(parts[0], allowed) {
			violations = append(violations, line)
		}
	}
	if len(violations) > 0 {
		t.Fatalf("orgdesign write boundary violated — these files write org_nodes/roles_org_nodes/org_node_view_state/org_levels directly instead of going through backend/internal/orgdesign/:\n%s",
			strings.Join(violations, "\n"))
	}
}
