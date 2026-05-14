package topology_test

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestPackageBoundary asserts that the topology package is the SOLE
// writer for topology_nodes, topology_role_grants, topology_view_state,
// and topology_commits. It fails CI if any .go file outside
// backend/internal/topology/ contains an INSERT/UPDATE/DELETE SQL string
// targeting one of those tables.
//
// M6.2.7 cutover (PLA-0006): the three boundary tables moved from
// mmff_vector (org_nodes / roles_org_nodes / org_node_view_state /
// org_levels) to vector_artefacts (topology_nodes / topology_role_grants /
// topology_view_state). The boundary follows the new tables — the
// legacy names are now read-only fossils served by the ETL scripts.
//
// Mirrors the addressables boundary test (see
// backend/internal/addressables/boundary_test.go) — same mechanism,
// different tables. SQL migrations under db/vector_artefacts/schema/ are
// exempt because the rg invocation scopes to .go files.
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

	pattern := `(?i)(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(topology_nodes|topology_role_grants|topology_view_state|topology_commits)\b`

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

	allowed := filepath.Join(repoRoot, "backend", "internal", "topology") + string(filepath.Separator)
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
		t.Fatalf("topology write boundary violated — these files write topology_nodes/topology_role_grants/topology_view_state/topology_commits directly instead of going through backend/internal/topology/:\n%s",
			strings.Join(violations, "\n"))
	}
}
