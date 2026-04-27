---
name: crawlio-mcp
description: Complete reference for the Crawlio MCP server — 37 tools, 6 code-mode tools, 4 resources, 4 prompts. Use this skill when orchestrating website crawling, export, enrichment, or analysis via Crawlio MCP.
allowed-tools: mcp__crawlio__*
license: MIT
version: 2.0.0
---

# Crawlio MCP Server

Crawlio MCP exposes **37 tools** (full mode) or **6 tools** (code mode) over stdio transport. The server connects to Crawlio.app's ControlServer for live operations and reads local state files for offline access.

## Modes

### Code Mode (default)
6 tools: `search_api`, `execute_api`, `trigger_capture`, `extract_text_from_image`, `analyze_page`, `compare_pages`. Use `search_api` to discover endpoints, then `execute_api` to call them. `extract_text_from_image` runs Vision OCR locally (no app required). Lower tool count, better for context-constrained clients.

### Full Mode (`--full`)
35 individual tools with typed parameters and annotations. Better for clients that can handle many tools.

---

## Full Mode Tools (37)

### Status & Monitoring (6)

**get_crawl_status** — Engine state + progress counters.
- `since` (int, opt): Sequence number for change detection.

**get_crawl_logs** — Recent log entries with filtering.
- `category` (string, opt): engine | download | parser | localizer | network | ui
- `level` (string, opt): debug | info | default | error | fault
- `limit` (int, opt): Max entries (default 100).

**get_errors** — Error/fault-level logs only. No params.

**get_downloads** — All download items with status, HTTP code, bytes, timing. No params.

**get_failed_urls** — Failed items with URL + error. No params.

**get_site_tree** — File paths as directory tree. No params.

### Control (4)

**start_crawl** — Start a new crawl.
- `url` (string, opt): Single URL.
- `urls` (string[], opt): Multi-seed URLs.
- `destinationPath` (string, opt): Save directory.

**stop_crawl** — Stop crawl, cancel downloads, clear queue. No params.

**pause_crawl** — Pause (in-progress downloads complete). No params.

**resume_crawl** — Resume paused crawl. No params.

### Settings & Configuration (3)

**get_settings** — Current pending settings + policy. No params.

**update_settings** — Partial merge (idle only).
- `settings` (object, opt): maxConcurrent, crawlDelay, timeout, downloadImages, downloadVideo, downloadFonts, downloadScripts, downloadStyles, userAgent, maxRetries, stripTrackingParams, customCookies, customHeaders, preferHTTP2 (bool), proxyConfiguration ({type: "http"/"https"/"socks5", host, port, username?, password?, noProxyHosts?}).
- `policy` (object, opt): scopeMode, maxDepth, maxPagesPerCrawl, respectRobotsTxt, excludePatterns, includePatterns, includeSupportingFiles, downloadCrossDomainAssets, autoUpgradeHTTP, pinnedPublicKeys ({hostname: [sha256HexStrings]}).

**recrawl_urls** — Re-crawl specific URLs.
- `urls` (string[], required).

### Projects (5)

**list_projects** — All saved projects. No params.

**save_project** — Save current project.
- `name` (string, opt).

**load_project** — Load project by ID.
- `id` (string, required).

**delete_project** — Delete project by ID.
- `id` (string, required).

**get_project** — Full project details.
- `id` (string, required).

### Export & Extraction (5)

**export_site** — Export downloaded site.
- `format` (string, required): folder | zip | singleHTML | warc
- `destinationPath` (string, required).
- `warcConfiguration` (object, opt): compressionEnabled (bool, default true), maxFileSize (int, default 1GB, 0=no split), cdxEnabled (bool, default true), dedupEnabled (bool, default true).

**get_export_status** — Export state + progress. No params.

**extract_site** — Run RSC extraction pipeline.
- `destinationPath` (string, opt).

**get_extraction_status** — Extraction state + progress. No params.

**trigger_capture** — WebKit runtime capture (framework detection, network, console, DOM).
- `url` (string, required).

### OCR (1)

**extract_text_from_image** — Extract text from a local image using Vision OCR. No Crawlio.app required.
- `path` (string, required): Absolute file path to image.
- `languages` (string[], opt): Recognition languages (e.g. `["en-US"]`).
- `recognitionLevel` (string, opt): `accurate` (default) or `fast`.

### Enrichment (6)

**get_enrichment** — Browser enrichment data.
- `url` (string, opt): Filter by URL.

**submit_enrichment_bundle** — Complete enrichment bundle.
- `url` (string, required).
- `framework` (object, opt), `networkRequests` (array, opt), `consoleLogs` (array, opt), `domSnapshotJSON` (string, opt).

**submit_enrichment_framework** — Framework detection.
- `url` (string, required), `framework` (object, required).

**submit_enrichment_network** — Network requests.
- `url` (string, required), `networkRequests` (array, required).

**submit_enrichment_console** — Console logs.
- `url` (string, required), `consoleLogs` (array, required).

**submit_enrichment_dom** — DOM snapshot.
- `url` (string, required), `domSnapshotJSON` (string, required).

### Observations & Findings (5)

**get_observations** — Append-only observation timeline.
- `host` (string, opt), `op` (string, opt), `source` (string, opt), `since` (number, opt), `limit` (int, opt).

**get_observation** — Look up a single observation or finding by ID.
- `id` (string, required): Observation ID (`obs_xxx` or `fnd_xxx`). Use to verify evidence chains.

**create_finding** — Create curated finding with evidence.
- `title` (string, required), `url` (string, opt), `evidence` (string[], opt), `synthesis` (string, opt), `confidence` (string, opt: high/medium/low/none), `category` (string, opt).

**get_findings** — List curated findings.
- `host` (string, opt), `limit` (int, opt).

**get_crawled_urls** — Downloaded URLs with pagination.
- `status` (string, opt), `type` (string, opt), `limit` (int, opt), `offset` (int, opt).

---

## Code Mode Tools (6)

**search_api** — Search available endpoints by keyword.
```
search_api(query: "enrichment", limit: 10)
```

**execute_api** — Execute HTTP request against ControlServer.
```
execute_api(method: "GET", path: "/status")
execute_api(method: "POST", path: "/start", body: {"url": "https://example.com"})
execute_api(method: "PATCH", path: "/settings", body: {"policy": {"maxDepth": 2}})
execute_api(method: "GET", path: "/crawled-urls?status=completed&limit=50")
```

**trigger_capture** — WebKit runtime capture (same as full mode).
```
trigger_capture(url: "https://example.com")
```

**extract_text_from_image** — Vision OCR on local image (same as full mode).
```
extract_text_from_image(path: "/path/to/image.png")
extract_text_from_image(path: "/path/to/image.jpg", languages: ["en-US"], recognitionLevel: "fast")
```

**analyze_page** — Composite analysis of a single page (capture + enrich + crawl status). Returns `evidenceId`, `evidenceQuality`, `gaps`.
```
analyze_page(url: "https://example.com")
```

**compare_pages** — Compare two pages side-by-side (runs analyze_page on each). Returns `comparisonReadiness`, `symmetric`, `degradationNotes`, `timingDelta`.
```
compare_pages(urlA: "https://example.com", urlB: "https://competitor.com")
```

---

## HTTP-Only Endpoints (3)

Accessible via `execute_api` but not as MCP tools:

- `GET /health` — Server health, version, uptime, PID.
- `GET /debug/metrics` — Engine metrics: connections, queue depth, memory.
- `POST /debug/dump-state` — Full engine state dump.

---

## Resources (4)

| URI | Description |
|-----|-------------|
| `crawlio://status` | Engine state and progress |
| `crawlio://settings` | Current crawl settings |
| `crawlio://site-tree` | Downloaded file tree |
| `crawlio://enrichment` | All browser enrichment data |

### Template (1)

`crawlio://enrichment/{url}` — Per-URL enrichment data.

---

## Prompts (4)

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `crawl-and-analyze` | url (req), maxDepth (opt) | Crawl + analyze results |
| `export-site` | url (req), format (req), destination (opt) | Crawl + export |
| `compare-sites` | url1 (req), url2 (req) | Compare two sites |
| `fix-failed-urls` | none | Diagnose + retry failures |

---

## Common Workflows

### Crawl → Wait → Export
1. `update_settings` — Configure depth, scope, asset options.
2. `start_crawl` — Begin crawl.
3. `get_crawl_status` — Poll until `engineState` is `completed`. Use `since` param for efficient polling.
4. `export_site` — Export as zip/folder/singleHTML/warc.
5. `get_export_status` — Confirm export finished.

### WARC Export with Options
1. `update_settings` — Configure proxy/pinning if needed: `{settings: {proxyConfiguration: {type: "http", host: "proxy.corp", port: 8080}}}`.
2. `start_crawl` — Crawl the target site.
3. `get_crawl_status` — Poll until completed.
4. `export_site` — Export with WARC options: `{format: "warc", destinationPath: "/tmp/archive.warc.gz", warcConfiguration: {compressionEnabled: true, cdxEnabled: true, dedupEnabled: true, maxFileSize: 0}}`.
5. Validate: CDX sidecar created, revisit records for dedup, GZIP compression.

### Enrichment Pipeline
1. `trigger_capture(url)` — Run WebKit capture.
2. `get_enrichment(url)` — Read framework detection, network, console, DOM.
3. `create_finding` — Record insights with evidence.

### Error Recovery
1. `get_failed_urls` — List failures.
2. `recrawl_urls` — Retry failed URLs.
3. `get_crawl_status` — Poll until re-crawl completes.
4. `get_failed_urls` — Check remaining failures.

### Status Polling Pattern
```
1. status = get_crawl_status()
2. seq = status.seq
3. Loop:
   status = get_crawl_status(since: seq)
   if status != "no changes": update seq, check engineState
   sleep 5s
```
