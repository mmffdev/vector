---
name: test
description: "Test a page against quality assertions — accessibility, performance, security, SEO, mobile readiness. Use -p flag to route to Playwright instead of Crawlio."
allowed-tools: mcp__crawlio-browser__search, mcp__crawlio-browser__execute, mcp__crawlio-browser__connect_tab, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_network_requests, Bash
---

# Test — Quality Assertions

Run pass/fail assertions across accessibility, performance, security, SEO, and mobile readiness. Every assertion becomes a finding. Confidence auto-caps when data is missing.

## Flags

- (no flag) — use Crawlio `smart` API (default, always available)
- `-p` — use Playwright MCP for browser-level interaction testing

## Protocol

### Default (Crawlio)

1. **search** for extraction commands: `search("extract page accessibility")`
2. **connect_tab** to the target URL
3. **execute** Code Mode: `smart.extractPage()` gathers all dimensions in one call
4. Emit one `smart.finding()` per assertion — claim states pass or fail
5. Return `smart.findings()` + `page.gaps`

### With `-p` flag (Playwright)

Check whether the Playwright MCP is loaded:
- If `mcp__playwright__browser_navigate` is available → proceed with Playwright tools
- If not available → tell the user: "Playwright MCP is disabled. Run `<playwright>` to enable it, restart Claude Code, then re-run `<test> -p`."

When Playwright is loaded:
1. `browser_navigate` to the target URL
2. `browser_snapshot` to get the accessibility tree
3. `browser_evaluate` to run assertions (viewport, meta tags, console errors)
4. `browser_network_requests` to inspect security headers and resource loading
5. `browser_take_screenshot` for visual evidence
6. Report findings in the same format as Crawlio mode

## Code Example

```js
const page = await smart.extractPage();

// Accessibility
if (page.accessibility) {
  smart.finding({
    claim: page.accessibility.imagesWithoutAlt === 0
      ? "All images have alt text"
      : `${page.accessibility.imagesWithoutAlt} images missing alt text`,
    evidence: [`imagesWithoutAlt: ${page.accessibility.imagesWithoutAlt}`, `nodeCount: ${page.accessibility.nodeCount}`],
    sourceUrl: page.capture.url, confidence: "high",
    method: "extractPage", dimension: "accessibility"
  });
  smart.finding({
    claim: page.accessibility.landmarkCount > 0
      ? `${page.accessibility.landmarkCount} ARIA landmarks found`
      : "No ARIA landmarks — add banner, main, contentinfo",
    evidence: [`landmarkCount: ${page.accessibility.landmarkCount}`],
    sourceUrl: page.capture.url, confidence: "high",
    method: "extractPage", dimension: "accessibility"
  });
}

// Performance
if (page.performance) {
  const lcp = page.performance.webVitals?.lcp;
  const cls = page.performance.webVitals?.cls;
  smart.finding({
    claim: lcp && lcp < 2500 ? `LCP good (${lcp}ms)` : `LCP needs work (${lcp || "unknown"}ms)`,
    evidence: [`LCP: ${lcp}ms`, `CLS: ${cls}`, `thresholds: LCP<2500, CLS<0.1`],
    sourceUrl: page.capture.url, confidence: lcp ? "high" : "low",
    method: "extractPage", dimension: "performance"
  });
}

// Security
if (page.security) {
  smart.finding({
    claim: page.security.securityState === "secure"
      ? "TLS connection is secure" : `Security state: ${page.security.securityState || "unknown"}`,
    evidence: [`protocol: ${page.security.protocol || "unknown"}`],
    sourceUrl: page.capture.url, confidence: "high",
    method: "extractPage", dimension: "security"
  });
}

// SEO
if (page.capture?.meta) {
  const m = page.capture.meta;
  smart.finding({
    claim: m.title && m.description ? "Title + meta description present" : "SEO meta tags incomplete",
    evidence: [`title: ${m.title || "missing"} (${m.title?.length || 0} chars)`,
               `description: ${m.description || "missing"} (${m.description?.length || 0} chars)`],
    sourceUrl: page.capture.url, confidence: "high",
    method: "extractPage", dimension: "seo"
  });
}

// Mobile readiness
if (page.mobileReadiness) {
  smart.finding({
    claim: page.mobileReadiness.hasViewportMeta ? "Viewport meta tag present" : "Missing viewport meta",
    evidence: [`viewport: ${page.mobileReadiness.viewportContent || "none"}`],
    sourceUrl: page.capture.url, confidence: "high",
    method: "extractPage", dimension: "mobile-readiness"
  });
}

// Tech stack
const tech = await smart.detectTechnologies();
if (tech.technologies?.length) {
  smart.finding({
    claim: `${tech.technologies.length} technologies detected`,
    evidence: tech.technologies.map(t => t.name),
    sourceUrl: page.capture.url, confidence: "high",
    method: "detectTechnologies", dimension: "technology"
  });
}

return { findings: smart.findings(), gaps: page.gaps };
```

## Anti-Patterns

- Do NOT use `smart.screenshot()` — extractPage captures everything needed
- Do NOT use `sleep()` to wait for metrics — extractPage handles page load
- Do NOT use `location.href` — use `page.capture.url`
- Always `search()` first if unsure which fields extractPage returns

## Output

The skill produces `Finding[]` via `smart.findings()`. Dimensions: **accessibility**, **performance**, **security**, **seo**, **mobile-readiness**, **technology**. When data is missing, confidence auto-caps to "low" and the gap appears in `page.gaps`.
