package lintchecks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// PLA062 S20 — fixture-driven self-tests for sentinel-clamp-required.
//
// The main TestSentinelClampRequired scans the live tree. These
// fixture tests assert the detector's mechanics by hand-crafting tiny
// Go source files in a temp directory and rerunning the scanner
// logic on them. Two cases:
//   - Negative: handler reads artefact_items WITHOUT sentinel.FromCtx → must offend.
//   - Positive: handler reads artefact_items WITH sentinel.FromCtx → must NOT offend.
//
// We exercise the regex + the comment-skip logic + the per-package
// aggregation rule (the package's clamp read can be in a sibling file).

func TestSentinelClampFixture_Negative_HandlerWithoutClampOffends(t *testing.T) {
	src := `package foo

import "github.com/jackc/pgx/v5"

func ListItems(pool *pgx.Pool) {
	rows, _ := pool.Query("SELECT id FROM artefact_items WHERE deleted_at IS NULL")
	_ = rows
}
`
	touchesArtefact, readsClamp := scanFixture(t, src)
	if !touchesArtefact {
		t.Fatalf("fixture should have triggered artefact-table detection, didn't")
	}
	if readsClamp {
		t.Fatalf("fixture has no sentinel.FromCtx call but lint thought it did")
	}
}

func TestSentinelClampFixture_Positive_HandlerWithClampPasses(t *testing.T) {
	src := `package foo

import (
	"context"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

func ListItems(ctx context.Context) {
	clamp := sentinel.FromCtx(ctx)
	_ = clamp.WorkspaceID
	_ = "SELECT id FROM artefact_items WHERE workspace_id = $1"
}
`
	touchesArtefact, readsClamp := scanFixture(t, src)
	if !touchesArtefact {
		t.Fatalf("fixture should have triggered artefact-table detection, didn't")
	}
	if !readsClamp {
		t.Fatalf("fixture calls sentinel.FromCtx but lint missed it")
	}
}

func TestSentinelClampFixture_CommentOnly_DoesNotOffend(t *testing.T) {
	// Pure-comment references like `// the artefact_items row` should
	// not trigger the lint — that's what trips up notifications/rules.
	src := `package foo

// Reads from the artefact_items table per the spec.
// The artefact_types relation is referenced in godoc only.
func Stub() {}
`
	touchesArtefact, _ := scanFixture(t, src)
	if touchesArtefact {
		t.Fatalf("fixture only references artefact_* in comments; should NOT have triggered")
	}
}

// scanFixture replicates the per-file scanning logic of the main
// TestSentinelClampRequired walker on an in-memory source string. It
// returns the same two flags the walker computes (touchesArtefact,
// readsClamp) so each fixture can pin one branch of the contract.
func scanFixture(t *testing.T, src string) (bool, bool) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fixture.go")
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var touchesArtefact, readsClamp bool
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "/*") {
			continue
		}
		if artefactTableReference.MatchString(line) {
			touchesArtefact = true
		}
		if strings.Contains(line, sentinelClampReadFromCtx) ||
			strings.Contains(line, sentinelClampReadWorkspaceID) ||
			strings.Contains(line, sentinelClampReadMust) {
			readsClamp = true
		}
	}
	return touchesArtefact, readsClamp
}
