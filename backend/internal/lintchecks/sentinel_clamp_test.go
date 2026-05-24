package lintchecks

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// PLA062 S20 — sentinel-clamp-required.
//
// Rule: any handler/service file that touches `artefacts*` (artefact_items,
// artefact_types, artefact_priorities) MUST also read the sentinel clamp
// — via `sentinel.FromCtx(`, `sentinel.WorkspaceIDFromCtx(`, or
// `sentinel.MustFromCtx(`. Without it, the handler is potentially serving
// rows from any workspace the caller's JWT can reach, defeating the
// procurement isolation contract.
//
// This is a structural ratchet, not a semantic one — we don't try to
// parse SQL or follow control flow. We just require that every file
// reading from artefact tables also references the Sentinel API. The
// service-package convention (sql.go owns queries, handler.go owns
// HTTP) means in practice the same file that touches the table is also
// the one that gates on workspace. If they're split, both files must
// reference Sentinel, OR the table-touching file must be a tests / dev
// path that the allowlist exempts.
//
// Files in tests, dev paths, and migration SQL are skipped. The
// allowlist below names pre-existing packages where the migration to
// Sentinel is staged across S21 — every entry MUST be paired with a
// follow-up to remove it.

const (
	sentinelClampReadFromCtx     = "sentinel.FromCtx("
	sentinelClampReadWorkspaceID = "sentinel.WorkspaceIDFromCtx("
	sentinelClampReadMust        = "sentinel.MustFromCtx("
)

// sentinelClampAllowlist names packages where the artefact-table reader
// is not yet calling Sentinel. Each entry MUST be paired with a TD-*
// reference. The list is intended to shrink to empty by S21 close-out.
//
// The S04 backend Sentinel substrate was mounted in main.go (S05); the
// handler refactor that wires sentinel.FromCtx into every artefact
// reader is the S21 deliverable. Until that lands, the readers are
// allowlisted here so the lint can be wired into go test ./... now
// (S20 AC).
var sentinelClampAllowlist = map[string]string{
	"internal/artefactitems":      "TD-SENT-CLAMP-ARTEFACTITEMS — S21 closes",
	"internal/artefactitemsv2":    "TD-SENT-CLAMP-ARTEFACTITEMSV2 — S21 closes",
	"internal/artefacttypes":      "TD-SENT-CLAMP-ARTEFACTTYPES — S21 closes",
	"internal/artefactpriorities": "TD-SENT-CLAMP-ARTEFACTPRIORITIES — S21 closes",
	"internal/portfoliomodels":    "TD-SENT-CLAMP-PORTFOLIOMODELS — S21 closes",
	"internal/flows":              "TD-SENT-CLAMP-FLOWS — S21 closes",
}

// artefactTableReference matches `artefact_items`, `artefact_types`,
// `artefact_priorities`, `artefact_field_values`, `artefact_links`
// (case-sensitive — SQL is uppercase keywords but lowercase table
// names per Vector convention). The leading negative-lookbehind-ish
// guard via `\b` ensures we don't match `not_artefact_items` or similar.
var artefactTableReference = regexp.MustCompile(`\bartefact_(items|types|priorities|field_values|links)\b`)

func TestSentinelClampRequired(t *testing.T) {
	root, err := filepath.Abs(scanRoot)
	if err != nil {
		t.Fatalf("resolve scanRoot: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("scan root not found: %v", err)
	}

	type fileScan struct {
		rel             string
		pkgPath         string
		touchesArtefact bool
		readsClamp      bool
		artefactLines   []int
	}

	scans := map[string]*fileScan{}

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
		if base == "dev.go" || base == "dev_reset.go" {
			return nil
		}
		if strings.Contains(path, string(filepath.Separator)+"dev"+string(filepath.Separator)) {
			return nil
		}

		rel, _ := filepath.Rel(root, path)
		pkgPath := "internal/" + filepath.ToSlash(filepath.Dir(rel))

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 1<<20), 1<<20)

		scan := &fileScan{rel: rel, pkgPath: pkgPath}
		lineNo := 0
		for s.Scan() {
			lineNo++
			line := s.Text()
			// Skip lines that are pure comments — `artefact_types` in a
			// godoc or trailing `//` annotation isn't a SQL/runtime
			// reference. We only flag code-level references.
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "/*") {
				continue
			}
			if artefactTableReference.MatchString(line) {
				scan.touchesArtefact = true
				scan.artefactLines = append(scan.artefactLines, lineNo)
			}
			if strings.Contains(line, sentinelClampReadFromCtx) ||
				strings.Contains(line, sentinelClampReadWorkspaceID) ||
				strings.Contains(line, sentinelClampReadMust) {
				scan.readsClamp = true
			}
		}
		if err := s.Err(); err != nil {
			return err
		}
		scans[path] = scan
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}

	// Aggregate per package: if ANY file in the package reads the
	// clamp, treat the whole package as clamped (handler-vs-service
	// split is fine).
	pkgReadsClamp := map[string]bool{}
	for _, scan := range scans {
		if scan.readsClamp {
			pkgReadsClamp[scan.pkgPath] = true
		}
	}

	var offenders []string
	for _, scan := range scans {
		if !scan.touchesArtefact {
			continue
		}
		if pkgReadsClamp[scan.pkgPath] {
			continue
		}
		if _, exempt := sentinelClampAllowlist[scan.pkgPath]; exempt {
			continue
		}
		// Report the first artefact-table line in the file as anchor.
		anchor := scan.artefactLines[0]
		offenders = append(offenders,
			scan.rel+":"+itoa(anchor)+"  artefact_* read with no sentinel.FromCtx/WorkspaceIDFromCtx/MustFromCtx in the package",
		)
	}
	if len(offenders) == 0 {
		return
	}
	t.Errorf("sentinel clamp missing — artefact-touching code must read sentinel.FromCtx (or WorkspaceIDFromCtx / MustFromCtx) to apply the workspace clamp:\n  %s\n"+
		"(or add the package to sentinelClampAllowlist with a TD-* reference — only for pre-existing offenders, do not extend)",
		strings.Join(offenders, "\n  "))
}
