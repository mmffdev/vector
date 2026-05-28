# Agent Handover — LSP MCP servers (`lsp-go` + `lsp-ts`) for code-nav context relief

**Date:** 2026-05-29
**Branch:** `main`
**Last commit (this session):** none — all changes uncommitted, deliberately. See "What is DONE" + git status snapshot below.
**Surface:** two new stdio MCP servers in `.mcp.json` (`lsp-go` via official `gopls mcp`, `lsp-ts` via isaacphi/mcp-language-server wrapping `typescript-language-server`) + workflow tightening to route symbol questions through LSP instead of Grep / `<search>`.
**Status:** Installed, wired, smoke-tested. **Requires Claude Code restart to activate** — the new MCPs are only loaded on session start. After restart, tools like `lsp-go__definition`, `lsp-ts__references`, `lsp-go__implementation` appear in the deferred tool list.

> **Read-before-acting:** the two MCPs are real and tested but invisible to the current session because MCP servers are loaded at startup. Anything you do in this conversation still goes through grep+Read. The benefit lands in the NEXT session. Don't claim "I'll use LSP now" mid-session — you can't until the user restarts.

---

## What this surface is for

The user observed that Vector's ~50k+ LOC codebase blows out Claude Code's context window during navigation — symbol queries ("where does `useSentinel` resolve, every caller") were costing 15–30k tokens via Grep + Read patterns. Solution: bridge Language Server Protocol (LSP) into MCP so Claude can ask typed, semantic questions in one call.

Three structural decisions locked this session:

1. **One MCP per language, not multi-LSP in one binary.** `lsp-go` and `lsp-ts` are separate entries in `.mcp.json`, mirroring the existing `pg-vector` / `pg-artefacts` / `pg-library` pattern. Symmetric, debuggable, no ambiguity about which workspace root drives which server.
2. **Official `gopls mcp` for Go** (ships built-in from v0.20+) — zero third-party trust surface on the backend pillar. Matters for SOC 2 / defence procurement narrative. Rejected `cclsp` (647 stars but dormant since 22 Feb 2026) and tree-sitter-analyzer (TOON savings claim debunked in independent benchmark — 0.001–14% in practice, not 50–70%).
3. **`<search>` skill demoted, not deleted.** It's still the right tool for literal strings (CSS classes, doc text, env vars, file paths). Its description was rewritten to make this explicit: code symbols go through LSP, literals go through `<search>`.

---

## File map — where things live

### MCP wiring
- [.mcp.json](../.mcp.json) — added two stdio entries at the bottom of the existing `mcpServers` block: `lsp-go` (`/opt/homebrew/bin/gopls mcp`) and `lsp-ts` (`/Users/rick/go/bin/mcp-language-server -workspace ${CLAUDE_PROJECT_DIR} -lsp typescript-language-server -- --stdio`). Sits alongside `whisper-local`, `pg-vector`, `pg-artefacts`, `pg-library`. Absolute paths used deliberately to dodge PATH issues at MCP launch.

### Documentation
- [docs/c_c_lsp_mcp.md](../docs/c_c_lsp_mcp.md) — NEW leaf doc (level-2 `c_c_*` per CLAUDE.md authoring rule). Carries pinned versions table, "why this combo + what was rejected", upgrade discipline, cold-start cost measurement, fallback servers. ~50 lines.
- [docs/c_infra_index.md](../docs/c_infra_index.md) — added a one-line index entry pointing at `c_c_lsp_mcp.md` under the existing infra index list.
- [.claude/CLAUDE.md](../.claude/CLAUDE.md) — new working-practices entry "Symbol navigation (LSP)" inserted directly under the existing "Search discipline" line. Names the relevant tools (`lsp-ts__*`, `lsp-go__*`), explains the token math (500–2000 vs 15–30k), and points to `c_c_lsp_mcp.md` for setup.

### Skill scope rewrite
- [.claude/skills/search/SKILL.md](../.claude/skills/search/SKILL.md) — frontmatter `description` rewritten to say "literal strings only, NOT code symbols — for those use lsp-go / lsp-ts". A new bullet "Code symbols" added as the FIRST item in the "When NOT to use this skill" section with concrete examples (`useSentinel`, `polymorphicrefs.Resolve`, `topology.Service`). The skill registry picks up the new description automatically; system-reminder confirmed it's live.

### Audit-snapshot demotion
- [api-snapshots/README.md](../api-snapshots/README.md) — NEW. Names the snapshots as frozen audit artifacts (for SOC 2 / change-review narrative), NOT navigation aids. Points to LSP for live "who calls X" questions. Survives regeneration because it's separate from the snapshot files themselves.

### Host binaries (NOT in repo — installed globally)
- `/opt/homebrew/bin/gopls` — v0.22.0, installed via `brew install gopls`. Ships the `mcp` subcommand built-in (since v0.20).
- `/opt/homebrew/bin/typescript-language-server` — v5.3.0, installed via `npm i -g typescript-language-server typescript`.
- `/Users/rick/go/bin/mcp-language-server` — v0.1.1, installed via `go install github.com/isaacphi/mcp-language-server@latest`. NOTE: lives in `$GOPATH/bin`, not on default PATH — hence the absolute path in `.mcp.json`.

---

## What is DONE

- gopls v0.22.0 installed via Homebrew. Verified `gopls mcp` subcommand exists and responds to MCP `initialize` over stdin with `gopls: server is closing: EOF` on graceful shutdown.
- typescript-language-server v5.3.0 + typescript installed globally via npm.
- mcp-language-server v0.1.1 installed via `go install`. Smoke-test against Vector's `app/` indexed **433 TypeScript files in ~1.6s** (M-series silicon, warm disk cache), responded with valid MCP `initialize` (`protocolVersion 2024-11-05`, capabilities=`{logging,tools}`, serverInfo=`MCP Language Server v0.0.2`).
- Both servers wired into [.mcp.json](../.mcp.json) as stdio entries with absolute binary paths and validated arg shapes (single-dash `-workspace` / `-lsp`, not double-dash — the research output had this wrong; corrected at install time).
- New leaf doc [docs/c_c_lsp_mcp.md](../docs/c_c_lsp_mcp.md) created carrying pinned versions, rejection notes (cclsp, tree-sitter-analyzer), upgrade discipline, cold-start cost, fallback servers.
- Index entry added to [docs/c_infra_index.md](../docs/c_infra_index.md).
- CLAUDE.md working-practices block extended with "Symbol navigation (LSP)" guidance.
- `<search>` skill rewritten to scope it to literals only — frontmatter description + "When NOT to use" section both updated.
- api-snapshots marked archive-only via new [api-snapshots/README.md](../api-snapshots/README.md).
- ~~Tested the MCPs from within Claude Code itself.~~ → **Not possible in this session.** MCPs only load at startup. Verification happens after the user restarts.

---

## Where to pick up next

**P1 — Restart Claude Code.** Required to activate `lsp-go` + `lsp-ts`. After restart, the deferred-tool list should include `lsp-go__definition`, `lsp-go__references`, `lsp-go__implementation`, `lsp-go__hover`, `lsp-ts__definition`, `lsp-ts__references`, `lsp-ts__hover`, etc. The exact tool names emerge from the LSP method namespace of each server.

**P2 — First-session shakedown.** On the restart, pick a real navigation question — e.g. "where is `useSentinel` defined and every caller" — and answer it with `lsp-ts__definition` + `lsp-ts__references`. Compare token cost vs the old grep+Read pattern. If the savings are roughly the claimed order of magnitude, the wiring is correct. If they're not, suspect the workspace-root resolution (`${CLAUDE_PROJECT_DIR}` should expand to the repo root).

**P3 — Consider committing the change set.** The session's changes are all uncommitted. Two natural commit groupings:
- `feat(mcp): wire lsp-go + lsp-ts MCP servers for code navigation` — `.mcp.json`, `docs/c_c_lsp_mcp.md`, `docs/c_infra_index.md`.
- `chore(workflow): route symbol nav through LSP, scope <search> to literals` — `.claude/CLAUDE.md`, `.claude/skills/search/SKILL.md`, `api-snapshots/README.md`.

Watch for unrelated dirty entries (per the HARD RULE — see "Inspect index before every commit") — `app/(user)/scope/page.tsx`, `app/(user)/value-sprint/page.tsx`, `app/components/ObjectTreeV2/*`, etc. are pre-session WIP from OTV2 work, NOT part of the LSP change. They must NOT be bundled.

**P4 — Watch the gopls v0.20+ MCP subcommand stability.** The Go team marks it experimental. Set a check-in trigger: any time `brew upgrade gopls` runs and the version crosses a major boundary, re-run the smoke test in [docs/c_c_lsp_mcp.md](../docs/c_c_lsp_mcp.md) before assuming the MCP wire shape is unchanged.

**P5 — Evaluate `lsp-go__implementation` against the "trace `NewService(...)`" HARD RULE.** The rule encodes a workaround for missing symbol resolution. After P2 shakedown, see if `lsp-go__implementation` on a service interface gives a complete enough answer to amend the rule's wording (the DB-routing half stays — only the symbol-resolution half should be obviated). DON'T touch the rule without explicit user sign-off — HARD RULES are load-bearing.

**P6 — Consider an ast-grep MCP as a third entry later.** Not now. ast-grep MCP shines for structural codemods (rename pattern X→Y across the repo with AST-level precision). If routine refactors land on Vector's plate (e.g. column-prefix renames during the wipe-and-reseed pipeline), revisit. The recommendation page already names it as a future addition.

---

## Known caveats

- **MCPs only load at startup.** You cannot test or use the new servers in the session that installs them. Anything you do mid-session still goes through grep+Read. Restart is mandatory.
- **`mcp-language-server` uses single-dash flags** (`-workspace`, `-lsp`), not double-dash. The research output had the wrong shape; if you're regenerating the entry from notes, the [.mcp.json](../.mcp.json) version on disk is authoritative.
- **`mcp-language-server` lives at `/Users/rick/go/bin/`, NOT on default PATH.** Absolute path used in `.mcp.json` deliberately — if you change Go's GOPATH or do a fresh install on another machine, this path is the first thing that breaks. Watch for it in any laptop-bootstrap work (note: there's an `infra/laptop-bootstrap-portable-memory` branch — if it carries the bootstrap script, the LSP install steps belong there too).
- **`gopls mcp` is experimental per the Go team.** Pinned at v0.22.0 in the docs. If a future `brew upgrade` jumps to a major-version boundary and the MCP wire shape changes, the `.mcp.json` entry may need adjustment. Smoke-test command lives in [docs/c_c_lsp_mcp.md](../docs/c_c_lsp_mcp.md).
- **First tool call of each session pays a TS cold-start cost** — measured at 1.6s for 433 files on this hardware. Subsequent queries fast. If the first nav query in a session feels slow, that's the index warming, not the wire being broken.
- **`<search>` is NOT deleted — only scoped.** Future agents must NOT remove it. Literal-string queries (CSS class names, doc text, magic strings, env vars, file paths) still go through the 4-Haiku fan-out. The skill description is the gate that keeps it from being misused for symbol queries.
- **api-snapshots are NOT deleted, only demoted.** They remain load-bearing for SOC 2 / change-review audit narrative. The README in `api-snapshots/` says "frozen evidence", not "remove these". The `<audit>` skill's regeneration jobs continue unchanged.
- **The "Never assume a database" HARD RULE still stands in full.** LSP collapses the *symbol-resolution* part of "find the handler, read NewService in main.go, cross-check c_c_db_routing.md" — but the *DB-routing* part (which pool? which database?) is not a symbol question. Sentinel-clamp, table-by-pool mapping, vaPool/libPools distinction — none of that comes from LSP. Tighten the rule's wording only with explicit user sign-off.
- **There is a `.claude/memory/project_otv2_refactor_intent.md` untracked file** at session start. It is NOT from this work — it's pre-existing OTV2-context state. Don't include it in the LSP commit.
- **There is a `docs/Varlock/` untracked directory** at session start. Unrelated. Don't bundle.
- **`api-snapshots/caller-map.json` and `dead-apis.txt` are in `git status` as modified** at session start. Pre-existing audit-snapshot regeneration churn, NOT part of this work. The `api-snapshots/README.md` we added IS part of this work and is a new file. Don't conflate.

---

## How to verify

1. **Pre-restart check (run now, in shell):**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | /opt/homebrew/bin/gopls mcp
   ```
   Expected: prints `Listening for MCP messages on stdin...` then closes with `gopls: server is closing: EOF`. If it errors with "unknown subcommand", gopls is below v0.20 — upgrade.

2. **Pre-restart TS check:**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | /Users/rick/go/bin/mcp-language-server -workspace "$PWD" -lsp typescript-language-server -- --stdio
   ```
   (run from repo root). Expected: indexes within ~2s, returns valid `initialize` result, then sits open until killed.

3. **Restart Claude Code.** Quit and reopen the session.

4. **Confirm MCP tools are loaded.** In the new session, look at the deferred-tool list (visible via `ToolSearch` queries or in tool announcements). Expect to see tools prefixed `lsp-go__` and `lsp-ts__`.

5. **First semantic test:** ask "where is `useSentinel` defined" — should resolve to one `lsp-ts__definition` call returning `app/sentinel/...` with a line number. If the tool returns "no symbol found", the workspace root is wrong; check `${CLAUDE_PROJECT_DIR}` expansion in `.mcp.json`.

6. **Second semantic test:** ask "every caller of `useSentinel`" — one `lsp-ts__references` call should return a list of file:line ranges. Compare against a manual `rg useSentinel app/` count for sanity (LSP should return strictly fewer — typed callers only, not comment / string mentions).

---

## Commits in scope

**None.** All changes are uncommitted as of session end. See P3 above for the recommended two-commit split.

Files dirty at session end *because of this work* (subset of full `git status`):
- `M .claude/CLAUDE.md`
- `M .claude/skills/search/SKILL.md`
- `M .mcp.json`
- `M docs/c_infra_index.md`
- `?? api-snapshots/README.md`
- `?? docs/c_c_lsp_mcp.md`

Files dirty at session end *unrelated to this work* (must NOT be bundled):
- `M api-snapshots/caller-map.json`, `M api-snapshots/dead-apis.txt` — audit-snapshot churn from prior session.
- `M app/(user)/scope/page.tsx`, `M app/(user)/value-sprint/page.tsx`, `M app/components/ObjectTreeV2/*`, `M app/components/work-items-tree-config.tsx`, `M app/lib/shareableParams.ts` — OTV2 generic-rowtype WIP, prior session.
- `?? .claude/memory/project_otv2_refactor_intent.md` — OTV2 context, prior session.
- `?? Rally-openapi-spec.json`, `?? docs/Varlock/`, `?? login-snapshot.yml` — unrelated.

---

## Open design questions

- **Should the `<search>` skill be split into two skills (`<search>` for literals, `<symbol>` for code) instead of relying on the skill description to gate usage?** Current model: one skill, description-gated. Risk: future agents may ignore the "code symbols → LSP" guidance and reach for `<search>` anyway. A separate `<symbol>` skill that wraps the LSP tool family with a unified interface (definition + references + hover behind one flag-driven entry) would be a stronger fence. Not done because it adds skill-maintenance surface; revisit if drift is observed.
- **Does the `gopls mcp` MCP subcommand return enough context per tool result to fully replace Read, or only the immediate symbol range?** Unknown without empirical testing. If `lsp-go__definition` returns only the signature line and not the surrounding ~10 lines of context, follow-up Reads will still be needed (smaller, but not eliminated). Frame this in P2 shakedown.
- **Should we add ast-grep MCP as a third entry now, or wait?** Decision: wait. ast-grep is for structural codemods, not navigation. Not the same problem. Add when routine cross-file refactors land on the plate — particularly if the wipe-and-reseed pipeline produces column-rename codemod work.
- **Is `infra/laptop-bootstrap-portable-memory` the right place to fold the LSP install steps?** Branch exists per `git for-each-ref` output. Don't touch the branch without checking what it contains and getting user sign-off — laptop-bootstrap is the kind of place where stray edits cause portability bugs.
- **Should there be a CLAUDE.md HARD RULE that mandates LSP-first for symbol queries?** Soft guidance is in place (working-practices entry + skill description). A HARD RULE would have teeth but also risk over-application — there ARE cases where Grep on symbols is appropriate (e.g. searching across types/comments simultaneously). Leave as soft guidance unless drift is observed.

---

## Web research sources (preserved for audit / future revisits)

Background research that drove the rejection of cclsp + tree-sitter-analyzer and the selection of `gopls mcp` + isaacphi/mcp-language-server:

- [LSP for Claude Code: Symbol-Level Search at Scale (claudefa.st)](https://claudefa.st/blog/tools/mcp-extensions/lsp-mcp-server) — the "500 vs 50000 token" framing.
- [ktnyt/cclsp commit history](https://github.com/ktnyt/cclsp/commits/main) — confirmed dormant since 22 Feb 2026.
- [isaacphi/mcp-language-server (GitHub)](https://github.com/isaacphi/mcp-language-server) — 1.5k stars, last release v0.1.1 May 2025; de facto community standard.
- [Assessing TOON Token Savings (dev.to/trknhr)](https://dev.to/trknhr/assessing-toon-token-savings-in-an-mcp-server-2b3i) — debunks the tree-sitter-analyzer 50–70% claim.
- [gopls MCP feature docs (go.dev)](https://go.dev/gopls/features/mcp) — official, experimental, v0.20+.
- [Experiment with gopls MCP (calvinmclean, dev.to)](https://dev.to/calvinmclean/experiment-with-gopls-mcp-improving-agent-context-for-go-development-37bo) — real-world token numbers.

---

**Last updated:** 2026-05-29
**Authored:** 2026-05-29 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
