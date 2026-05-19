// Package cspreport receives Content-Security-Policy violation reports
// posted by the browser and persists them to mmff_vector.csp_reports.
//
// TD-SEC-CSP-NONCES-SRI Phase 2 (2026-05-18).
//
// Wire formats: browsers send EITHER `application/csp-report` (legacy
// "report-uri" — single-violation envelope { "csp-report": {...} }) OR
// `application/reports+json` (modern Reporting API "report-to" — array
// of envelopes { "type": "csp-violation", "body": {...} }). The handler
// accepts both and normalises into a single row per violation.
//
// Security posture: UNAUTHENTICATED on purpose — browsers send these
// without session cookies in many cases, and pre-login pages (login,
// reset, help) need to report too. NOT CSRF-protected for the same
// reason. Aggressive per-IP rate limit is the only DoS protection,
// wired in main.go.
//
// Noise filtering: browser extensions (content scripts injected into
// every page) are a major source of false positives. Reports whose
// blocked_uri or source_file points at chrome-extension://,
// moz-extension://, safari-extension:// etc. are dropped at the
// handler (never persisted) so the soak signal stays clean.
package cspreport

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service holds the DB pool. Handlers consume it via the inserter
// interface to keep `pgxpool` out of handler.go (lint:no-db-in-handlers).
type Service struct {
	pool *pgxpool.Pool
}

func NewService(p *pgxpool.Pool) *Service { return &Service{pool: p} }

// InsertReport persists one normalised CSP violation row.
func (s *Service) InsertReport(
	ctx context.Context,
	r normalisedReport,
	userAgent string,
	remoteIP any,
	raw string,
) error {
	_, err := s.pool.Exec(ctx, sqlInsertCSPReport,
		r.DocumentURI, r.Referrer,
		r.ViolatedDirective, r.EffectiveDirective, r.OriginalPolicy,
		r.Disposition,
		r.BlockedURI, r.SourceFile,
		nullInt(r.LineNumber), nullInt(r.ColumnNumber), nullInt(r.StatusCode),
		userAgent,
		remoteIP,
		raw,
	)
	return err
}

func nullInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}
