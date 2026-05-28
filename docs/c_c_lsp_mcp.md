# LSP MCP servers — code navigation for Claude Code

Wired to address context blowout on Vector's two-stack codebase (Next.js TS frontend, Go backend). Both run stdio, alongside the existing `pg-*` + `whisper-local` entries in [`.mcp.json`](../.mcp.json).

## Pinned versions

| Server | Binary | Version (2026-05-29) | Source |
| --- | --- | --- | --- |
| `lsp-go` | `/opt/homebrew/bin/gopls` | **v0.22.0** | Homebrew (`brew install gopls`) |
| `lsp-ts` | `/Users/rick/go/bin/mcp-language-server` | **v0.1.1** | `go install github.com/isaacphi/mcp-language-server@latest` |
| `lsp-ts` LSP backend | `/opt/homebrew/bin/typescript-language-server` | **5.3.0** | `npm i -g typescript-language-server typescript` |

`gopls` ships its MCP subcommand built-in from v0.20+ (official Go team). `mcp-language-server` is a third-party bridge — community-maintained, 1.5k stars, last release May 2025.

## Why this combo (and what was rejected)

- **One MCP per language** maps cleanly onto Vector's `pg-vector` / `pg-artefacts` / `pg-library` shape — symmetric, debuggable, no ambiguity about which workspace root is active.
- **Official `gopls mcp` chosen** over third-party Go wrappers (`yantrio/mcp-gopls`, `hloiseau/mcp-gopls`) — zero extra trust surface on the backend pillar; matters for SOC 2 / defence narrative.
- **cclsp rejected**: 647 stars but dormant since 22 Feb 2026. Multi-LSP-from-one-config is nicer ergonomics, but a stale tool in the hot path of every code-nav request is the wrong call.
- **tree-sitter-analyzer rejected**: TOON's 50–70% token-savings claim measures JSON→TOON serialization, not Read→tool. Independent benchmark (dev.to/trknhr) found 0.001–14% in practice. And tree-sitter only answers syntactic questions; LSP answers typed ones (e.g. "who calls `polymorphicrefs.Resolve`").

## Upgrade discipline

`gopls mcp` is marked **experimental** by the Go team. Pin behaviour:

1. Re-check `gopls version` before every minor Go upgrade.
2. If MCP wire shape changes between gopls versions, update this doc and the entry in `.mcp.json` together — never one-sided.
3. `mcp-language-server@v0.1.1` is the last release as of writing (May 2025). If/when v0.2 ships, smoke-test before pinning by running:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | mcp-language-server -workspace "$PWD" -lsp typescript-language-server -- --stdio
   ```
   Expect: `"result":{"protocolVersion":"2024-11-05","capabilities":{...},"serverInfo":{...}}` within a few seconds.

## Cold-start cost

- `lsp-ts` indexes the TS workspace on first invocation. Measured on Vector 2026-05-29: **433 files in ~1.6s** (M-series silicon, warm disk cache). First tool call of each Claude Code session pays this once.
- `lsp-go` defers heavy work until the first symbol query; cold start near-instant.

## Fallback servers (if either pin goes bad)

- TS: `mickeyinfoshan/lsp-mcp` (single-binary multi-LSP, March 2026, pre-alpha) or `mizchi/typescript-mcp` (lsmcp, 448 stars).
- Go: revert to grep + read pattern — the HARD RULE about tracing `NewService(...)` in `backend/cmd/server/main.go` ([`.claude/CLAUDE.md`](../.claude/CLAUDE.md)) still works without MCP, just slower.
