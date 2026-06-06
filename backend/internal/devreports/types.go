// Package devreports is the sole reader/writer for dev_reports in mmff_dev.
//
// dev_reports holds the reports that used to live as JSON files in
// dev/research/, dev/plans/, dev/security-audits/, dev/retros/, dev/code/,
// dev/audits/ (and misc). The schema mirrors the old JSON shape so the
// existing /dev/research render path (HTML blob + scroll-spy) works
// unchanged after the migration to DB-backed storage.
package devreports

import (
	"errors"
	"time"
)

var (
	ErrNotFound     = errors.New("dev report not found")
	ErrInvalidInput = errors.New("invalid dev report input")
)

// ValidTypes is the canonical list of report types. Keep in sync with the
// CHECK constraint in db/mmff_dev/schema/002_dev_reports.sql.
var ValidTypes = []string{"research", "plan", "security", "retro", "code", "api", "misc", "system", "architecture"}

// Meta is the lightweight row returned by the list endpoint. Excludes the
// HTML content blob so the page-load payload stays small (~1 KB per report
// vs ~30 KB with content).
type Meta struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Category    string    `json:"category"`
	Topic       string    `json:"topic"`
	Summary     string    `json:"summary"`
	ContentText string    `json:"content_text"`
	ReportDate  string    `json:"report_date"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Full is the per-report payload returned when one report is opened. Adds
// the HTML content blob plus the original-JSON payload for forward-compat.
type Full struct {
	Meta
	Content string                 `json:"content"`
	Payload map[string]any         `json:"payload,omitempty"`
}

// UpsertInput is the write contract used by skills (via the Next.js
// /api/dev/reporting proxy → backend POST). Title + Content + Type + ID
// are required; everything else is optional.
type UpsertInput struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Category    string         `json:"category"`
	Topic       string         `json:"topic"`
	Summary     string         `json:"summary"`
	Content     string         `json:"content"`
	ContentText string         `json:"content_text"`
	Payload     map[string]any `json:"payload"`
	ReportDate  string         `json:"report_date"`
}

func isValidType(t string) bool {
	for _, v := range ValidTypes {
		if v == t {
			return true
		}
	}
	return false
}
