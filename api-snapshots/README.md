# `api-snapshots/` — archive-only

These files are **frozen audit artifacts**, not navigation aids. Don't grep them to answer "who calls X" or "is Y dead" — the answers drift the moment the next regeneration runs.

## What lives here

- **`caller-map.json`** — frontend → backend route call graph at last regen.
- **`dead-apis.txt`** — backend routes with no detected frontend caller at last regen.
- **`blast-radius-latest.md`** / **`blast-radius-v2-latest.md`** — change-impact snapshots.
- **`v1/`**, **`v2/`** — frozen OpenAPI snapshots for the v1 / v2 API surface.
- **`CHANGELOG.md`** — snapshot-version log.

## Why archive-only

For live "who calls this function" / "is this exported symbol referenced anywhere" questions, use the LSP MCP tools — `lsp-ts__references`, `lsp-go__references`, `lsp-go__implementation`. They give typed, current answers in one call. See [`docs/c_c_lsp_mcp.md`](../docs/c_c_lsp_mcp.md).

The snapshots here exist for a different purpose: **frozen evidence for SOC 2 / change-review narratives.** They show "what the API surface looked like at commit X" or "what callers existed at audit time Y". A regenerated snapshot replaces the prior state; comparing snapshots across regenerations is the audit story.

## Regeneration

- `blast-radius-*` — produced by the `<audit>` / blast-radius workflows.
- `caller-map.json` + `dead-apis.txt` — produced by API-audit scripts; do not edit by hand.
- `v1/`, `v2/` — produced by openapi-codegen at release time.
