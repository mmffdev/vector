---
name: extract-and-export
description: Use this skill when the user asks to "download and export a site", "crawl and extract content", "archive a website", "export as WARC/ZIP/PDF", or wants a complete crawl-extract-export pipeline. Crawls the site, extracts structured content, and exports in the requested format.
argument-hint: <url> [maxDepth] [format]
license: MIT
version: 2.0.0
---

# extract-and-export

Complete crawl-extract-export pipeline. Crawls a site, extracts structured content (clean HTML, markdown, metadata, asset manifests), and exports in any of 7 formats.

## When to Use

Use this skill when the user wants to download a site AND get usable output — not just a raw crawl, but extracted content ready for consumption, archival, or deployment.

For crawl-only workflows (no extraction or export), use `crawl-site` instead.

## Arguments

- `$0` (required): The URL to crawl
- `$1` (optional): Maximum crawl depth (default: 3)
- `$2` (optional): Export format (default: `folder`)

### Export Formats

| Format | Description |
|--------|-------------|
| `folder` | Mirror on disk with original directory structure |
| `zip` | Compressed archive, ready to share |
| `singleHTML` | All assets inlined into a single HTML file |
| `warc` | ISO 28500 web archive standard |
| `pdf` | Rendered pages as portable document |
| `extracted` | Structured data only — clean HTML, markdown, metadata, no raw assets |
| `deploy` | Production-ready bundle with crawl-manifest.json |

## Workflow

### 1. Configure Settings

```
update_settings({
  settings: {
    maxConcurrent: 4,
    crawlDelay: 0.5,
    stripTrackingParams: true
  },
  policy: {
    scopeMode: "sameDomain",
    maxDepth: $1 or 3,
    respectRobotsTxt: true,
    includeSupportingFiles: true,
    downloadCrossDomainAssets: true,
    autoUpgradeHTTP: true
  }
})
```

Adjust based on site size:
- Small site (<100 pages): `maxDepth: 10`, `maxConcurrent: 8`
- Medium site (100-1000): `maxDepth: 5`, `maxConcurrent: 4`
- Large site (1000+): `maxDepth: 3`, `maxPagesPerCrawl: 500`

### 2. Start the Crawl

```
start_crawl({ url: "$0" })
```

### 3. Monitor Progress

Poll `get_crawl_status` with `since` parameter for efficient change detection:

```
get_crawl_status()
// Returns: seq: 42, downloaded: 85/150

get_crawl_status({ since: 42 })
// Returns: "No changes" or updated status
```

### 4. Check for Issues

After crawl completes:

```
get_failed_urls()     // Any failures to retry?
get_errors()          // Any engine errors?
```

Retry transient failures:
```
recrawl_urls({ urls: ["https://example.com/failed-page"] })
```

### 5. Review What Was Downloaded

```
get_site_tree()       // File structure overview
get_downloads()       // Detailed download info with content types
```

### 6. Extract Content

```
extract_site()
```

This runs the extraction pipeline and produces per-page artifacts:
- Clean HTML (tracking scripts removed)
- Markdown conversion
- Metadata (title, description, headings, links)
- Asset manifests

Poll `get_extraction_status` if the extraction takes time.

### 7. Export

```
export_site({ format: "$2" or "folder" })
```

Poll `get_export_status` for large exports.

### 8. Report Results

Summarize:
- **Crawl**: Total pages discovered, downloaded, failed
- **Extraction**: Pages processed, artifacts created
- **Export**: Format, location, file size
- **Issues**: Any errors or notable findings

## Tips

- For archival workflows, use `warc` — it's the ISO standard and preserves full HTTP headers
- For AI consumption, use `extracted` — just the structured data, no raw assets
- For sharing, use `zip` — compressed and portable
- For deployment, use `deploy` — includes `crawl-manifest.json` with full metadata
- For large sites, set `maxPagesPerCrawl` to avoid runaway crawls
- Save the project after export for future reference: `save_project({ name: "example.com export" })`
