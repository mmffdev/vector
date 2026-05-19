package cspreport

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/netip"
	"strings"
)

type Handler struct {
	svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{svc: s} }

// legacyEnvelope is the report-uri payload: { "csp-report": { ... } }.
// Field names use the RFC 9116 hyphenated form on the wire.
type legacyEnvelope struct {
	Report legacyReport `json:"csp-report"`
}

type legacyReport struct {
	DocumentURI        string `json:"document-uri"`
	Referrer           string `json:"referrer"`
	ViolatedDirective  string `json:"violated-directive"`
	EffectiveDirective string `json:"effective-directive"`
	OriginalPolicy     string `json:"original-policy"`
	BlockedURI         string `json:"blocked-uri"`
	SourceFile         string `json:"source-file"`
	LineNumber         int    `json:"line-number"`
	ColumnNumber       int    `json:"column-number"`
	StatusCode         int    `json:"status-code"`
}

// modernEnvelope is one entry in the Reporting API array. The body is
// camelCase under that spec.
type modernEnvelope struct {
	Type      string       `json:"type"`
	URL       string       `json:"url"`
	UserAgent string       `json:"user_agent"`
	Body      modernReport `json:"body"`
}

type modernReport struct {
	DocumentURL        string `json:"documentURL"`
	Referrer           string `json:"referrer"`
	ViolatedDirective  string `json:"violatedDirective"`
	EffectiveDirective string `json:"effectiveDirective"`
	OriginalPolicy     string `json:"originalPolicy"`
	Disposition        string `json:"disposition"`
	BlockedURL         string `json:"blockedURL"`
	SourceFile         string `json:"sourceFile"`
	LineNumber         int    `json:"lineNumber"`
	ColumnNumber       int    `json:"columnNumber"`
	StatusCode         int    `json:"statusCode"`
}

// normalisedReport is what gets persisted — one row per violation.
type normalisedReport struct {
	DocumentURI        string
	Referrer           string
	ViolatedDirective  string
	EffectiveDirective string
	OriginalPolicy     string
	Disposition        string
	BlockedURI         string
	SourceFile         string
	LineNumber         int
	ColumnNumber       int
	StatusCode         int
}

// extensionURISchemes lists prefixes that indicate a browser-extension
// content script is the source. Reports rooted at these are dropped to
// keep the soak signal clean — they're outside our threat model.
var extensionURISchemes = []string{
	"chrome-extension://",
	"moz-extension://",
	"safari-extension://",
	"safari-web-extension://",
	"webkit-masked-url://",
}

func isExtensionNoise(r normalisedReport) bool {
	candidates := []string{r.BlockedURI, r.SourceFile}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		for _, prefix := range extensionURISchemes {
			if strings.HasPrefix(c, prefix) {
				return true
			}
		}
	}
	return false
}

func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	// Cap body size — CSP reports are small (~1-2 KB typical). 64 KB
	// is generous and protects against a flood of huge bodies.
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if len(body) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	contentType := r.Header.Get("Content-Type")
	ua := r.Header.Get("User-Agent")
	remoteIP := clientIP(r)

	reports := parseReports(body, contentType)
	if len(reports) == 0 {
		// Unrecognised payload — swallow as 204 (don't surface to
		// browsers, they'd just retry). Log for diagnostics.
		log.Printf("cspreport: unparseable body (content-type=%q, %d bytes)", contentType, len(body))
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ctx := r.Context()
	for _, rep := range reports {
		if isExtensionNoise(rep) {
			continue
		}
		if err := h.svc.InsertReport(ctx, rep, ua, remoteIP, string(body)); err != nil {
			log.Printf("cspreport: insert failed: %v", err)
			// Don't fail the response — browsers don't retry
			// usefully and we'd rack up rate-limit hits.
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// parseReports returns 0..N normalised reports from either wire format.
// Unknown formats yield 0 reports; caller handles the empty case.
func parseReports(body []byte, contentType string) []normalisedReport {
	// Strip optional ;charset=… suffix.
	ct := strings.TrimSpace(strings.ToLower(strings.Split(contentType, ";")[0]))

	switch ct {
	case "application/csp-report", "application/json":
		// Some browsers send application/json with the legacy envelope.
		var env legacyEnvelope
		if err := json.Unmarshal(body, &env); err == nil && env.Report.ViolatedDirective != "" {
			return []normalisedReport{{
				DocumentURI:        env.Report.DocumentURI,
				Referrer:           env.Report.Referrer,
				ViolatedDirective:  env.Report.ViolatedDirective,
				EffectiveDirective: env.Report.EffectiveDirective,
				OriginalPolicy:     env.Report.OriginalPolicy,
				Disposition:        "", // legacy doesn't include this
				BlockedURI:         env.Report.BlockedURI,
				SourceFile:         env.Report.SourceFile,
				LineNumber:         env.Report.LineNumber,
				ColumnNumber:       env.Report.ColumnNumber,
				StatusCode:         env.Report.StatusCode,
			}}
		}
	case "application/reports+json":
		var envs []modernEnvelope
		if err := json.Unmarshal(body, &envs); err == nil {
			out := make([]normalisedReport, 0, len(envs))
			for _, e := range envs {
				if e.Type != "csp-violation" {
					continue
				}
				out = append(out, normalisedReport{
					DocumentURI:        e.Body.DocumentURL,
					Referrer:           e.Body.Referrer,
					ViolatedDirective:  e.Body.ViolatedDirective,
					EffectiveDirective: e.Body.EffectiveDirective,
					OriginalPolicy:     e.Body.OriginalPolicy,
					Disposition:        e.Body.Disposition,
					BlockedURI:         e.Body.BlockedURL,
					SourceFile:         e.Body.SourceFile,
					LineNumber:         e.Body.LineNumber,
					ColumnNumber:       e.Body.ColumnNumber,
					StatusCode:         e.Body.StatusCode,
				})
			}
			return out
		}
	}
	return nil
}

// clientIP extracts the request origin IP, honouring X-Forwarded-For
// (first hop only). Falls back to RemoteAddr.
func clientIP(r *http.Request) any {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first := strings.TrimSpace(strings.Split(xff, ",")[0])
		if addr, err := netip.ParseAddr(first); err == nil {
			return addr.String()
		}
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.String()
	}
	return nil
}
