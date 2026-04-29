---
name: web-research
description: Use this skill when the user asks to "research a site", "compare sites", "analyze technology", or wants structured evidence-based web research. Teaches the acquire-normalize-analyze protocol using CrawlioMCP's composite analysis tools.
license: MIT
version: 2.0.0
---

# web-research

Structured web research protocol for CrawlioMCP. Produces normalized evidence records and findings through composite analysis tools.

`analyze_page` is the Swift-side analogue of crawlio-agent's `extractPage`, but not its mirror. It operates over HTTP against Crawlio's ControlServer rather than controlling a browser viewport directly.

## Core Protocol: Acquire > Normalize > Analyze

### 1. Acquire

Use composite tools to gather evidence. Never use the low-level `trigger_capture` + sleep + `get_enrichment` pattern.

| Goal | Tool | Notes |
|------|------|-------|
| Single-page evidence | `analyze_page` | One call = capture + enrichment + crawl status. Returns `evidenceId`, `evidenceQuality`, `gaps` |
| Two-site comparison | `compare_pages` | Sequential analysis with typed comparison evidence |
| Single evidence lookup | `get_observation` | Verify a specific evidence record by ID |
| Bulk crawl data | `get_crawled_urls` | After a completed crawl |
| Historical timeline | `get_observations` | Append-only audit trail |

### 2. Normalize

Structure evidence from the unified records into canonical form before analysis:

- **Framework**: name, version, rendering mode (SSR/SSG/CSR/ISR)
- **Network**: request count, external domains, resource types
- **Console**: error count, warning patterns
- **Crawl**: status, content type, byte count

Check `enrichmentStatus` before using enrichment data:
- `"ok"` — enrichment data is present and usable
- `"timeout"` — capture completed but enrichment didn't arrive in time; note this gap

Check `evidenceQuality` for overall evidence health:
- `"complete"` — no gaps, all data present
- `"partial"` — has gaps but capture succeeded
- `"degraded"` — capture-level failure or enrichment server error

### 3. Analyze

Compare normalized evidence against a rubric. Produce structured findings via `create_finding`.

## Anti-Patterns

**Never do this:**
```
trigger_capture({ url: "..." })
// sleep(5000)
get_enrichment({ url: "..." })
```

**Do this instead:**
```
analyze_page({ url: "https://example.com" })
```

**Never improvise evidence shapes.** The record from `analyze_page` is the canonical evidence format. Don't restructure it ad hoc.

**Never analyze before normalizing.** Extract fields from the evidence record first, then draw conclusions.

## Comparison Protocol

For side-by-side analysis of two sites:

```
compare_pages({ urlA: "https://site-a.com", urlB: "https://site-b.com" })
```

The response includes a `comparisonSummary` with typed evidence fields:
- `comparisonReadiness` — `ready` (both complete), `cautious` (one partial), `unreliable` (either degraded)
- `symmetric` — whether both sides have identical gap profiles
- `degradationNotes` — human-readable list of gaps per side
- `timingDelta` — absolute timing differences (capture, enrichment polling)
- `enrichmentAgeDeltaMs` — timestamp difference between the two analyses
- `evidenceIdA` / `evidenceIdB` — observation IDs for round-trip verification via `get_observation`

### Comparison Dimensions

When comparing two sites, evaluate across these 10 dimensions:

1. **Framework** — name, version, rendering strategy
2. **Performance** — resource count, total bytes, external dependencies
3. **Security** — HTTPS enforcement, mixed content, CSP presence
4. **SEO** — meta tags, structured data, canonical URLs
5. **Accessibility** — semantic HTML, ARIA usage, alt text
6. **Error surface** — console errors, failed resources, 4xx/5xx responses
7. **Third-party load** — analytics, tracking, CDN usage
8. **Architecture** — SPA vs MPA, API patterns, hydration strategy
9. **Content delivery** — CDN, caching headers, compression
10. **Mobile readiness** — viewport meta, responsive signals

Not all dimensions will have data for every page. Note gaps explicitly.

## Findings

After analysis, persist insights:

```
create_finding({
  title: "Site uses Next.js 14 with ISR",
  url: "https://example.com",
  evidence: ["obs_abc123"],
  synthesis: "Framework detection confirmed Next.js 14.2.0 with incremental static regeneration...",
  confidence: "high",
  category: "framework"
})
```

Findings come **after** normalized evidence, never before.

## Example Workflow

```
// 1. Acquire
result = analyze_page({ url: "https://example.com" })

// 2. Normalize
framework = result.enrichment.framework  // { name: "Next.js", version: "14.2.0" }
networkCount = result.enrichment.networkRequests.length
consoleErrors = result.enrichment.consoleLogs.filter(e => e.level === "error")

// 3. Analyze & Record
create_finding({
  title: "Next.js 14 with high external dependency count",
  url: "https://example.com",
  synthesis: "Detected Next.js 14.2.0. Page loads 47 network requests including 12 third-party domains..."
})
```
