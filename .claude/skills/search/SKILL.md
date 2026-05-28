---
name: search
description: Fan-out targeted full-repo search for LITERAL STRINGS — CSS class names, doc text, config keys, magic strings, env vars, file paths. NOT for code symbols (functions, types, components, methods) — for those, use the `lsp-go` and `lsp-ts` MCP tools (definition / references / hover) which give typed answers in one call. Spawns 4 parallel Haiku sub-agents across the four major buckets of the tree. Case-insensitive by default.
---

# `<search>` — Targeted fan-out repo search

**Scope: literal strings only.** Code-symbol questions (where is X defined, every caller of X, what implements interface Y) go through the LSP MCP tools (`lsp-ts__definition`, `lsp-ts__references`, `lsp-go__definition`, `lsp-go__references`, `lsp-go__implementation`) — they're faster, semantically typed, and don't burn 4 Haiku sub-agent calls. See [`docs/c_c_lsp_mcp.md`](../../../docs/c_c_lsp_mcp.md) for the wiring.

Spawns 4 parallel Haiku sub-agents across the repo, collates their hits, and returns one compiled list grouped by area. Fast because the four sub-agents run concurrently and each only sees its own bucket; cheap because Haiku.

---

## Invocation

```
<search> <term>
<search> <term> --case-sensitive
```

- **`<term>`** — the literal string, name, identifier, phrase to search for. May contain spaces.
- **`--case-sensitive`** — exact case match. Default: case-insensitive.

Examples:
- `<search> Richard Cook`
- `<search> SAMANTHA_API_KEY --case-sensitive`
- `<search> portfolio_item_types`

---

## Buckets (4 parallel agents)

Each sub-agent owns one bucket. They run in a single message with 4 `Agent` tool uses in parallel — `subagent_type: general-purpose`, `model: haiku`.

| Bucket | Roots |
|---|---|
| **frontend** | `app/`, `public/`, `dev/styles/`, `dev/pages/`, top-level `*.tsx`/`*.ts`/`*.css` |
| **backend** | `backend/`, `db/` |
| **infra-docs-tooling** | `docs/`, `.claude/`, `dev/` (excluding `dev/styles/` and `dev/pages/` already in frontend), `bin/`, `scripts/`, top-level `*.md`, top-level config (`Makefile`, `package.json`, `tsconfig.json`, `next.config.*`, etc.) |
| **assets-other** | `MMFFDev - Vector Assets/`, `local-assets/` (excluding `local-assets/backups/*.sql` — too big, never relevant), and any top-level path not claimed by the other three |

**Hard excludes everywhere:** `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `.turbo/`, `*.lock`, `reference/repos/` (vendored third-party SDK source — grep there explicitly via `<source-code-context>` when needed), binary files (skip via `rg` defaults).

---

## Steps

### 1 — Validate

If `<term>` is empty or whitespace only: respond "search term required — try `<search> <term>`" and stop.

### 2 — Fan out (single message, 4 parallel `Agent` calls)

Each sub-agent gets a self-contained prompt that includes:
- The literal term (quoted exactly as the user typed it, including spaces).
- The case-sensitivity flag.
- Its assigned bucket's root paths.
- The hard-exclude list.
- The exact output shape required (see below).

**Sub-agent prompt template** (substitute `{TERM}`, `{CASE_FLAG}`, `{BUCKET_NAME}`, `{ROOTS}`):

> Search the following paths for the literal string `{TERM}` (case-{sensitive|insensitive}): {ROOTS}
>
> Use `rg` (ripgrep) — it respects `.gitignore` and skips binary files by default. Command shape:
> ```
> rg {CASE_FLAG} --line-number --with-filename --max-columns=200 -- {TERM_ESCAPED} {ROOT1} {ROOT2} ...
> ```
> Also explicitly exclude: `node_modules`, `.git`, `.next`, `dist`, `build`, `.turbo`, `*.lock`, `local-assets/backups/*.sql`, `reference/repos/`.
>
> Return ONLY a markdown list, one line per hit:
> ```
> - `path/to/file.ext:LINE` — <≤80-char snippet of matching line, trimmed>
> ```
> No prose, no summary, no headers. If zero hits in this bucket, return exactly: `NO HITS`.
> Hard cap: 300 hits. If more, return the first 300 sorted by path and append `… (truncated at 300)`.

Pass `model: "haiku"` and `subagent_type: "general-purpose"` on each call.

### 3 — Collate

When all 4 return, build a single markdown report:

```
# Search: "<term>" (<case-sensitive|case-insensitive>)

## frontend (<N> hits)
- `app/.../foo.tsx:42` — <snippet>
...

## backend (<N> hits)
- `backend/.../bar.go:118` — <snippet>
...

## infra-docs-tooling (<N> hits)
- `docs/c_schema.md:12` — <snippet>
...

## assets-other (<N> hits)
- `MMFFDev - Vector Assets/.../baz.md:5` — <snippet>
...

**Total: <T> hits across <B> buckets.**
```

Buckets with `NO HITS` are listed as `## <bucket> (0 hits)` with no body — keeps the structure stable.

### 4 — Return

Output the collated report directly. No follow-up question, no offer to read files — the caller decides what to do next.

---

## Rules

- **Never use a single Grep call instead of fan-out.** The skill's value is parallelism + bucket coverage. A single grep returns faster but misses the "every area" guarantee the user wants.
- **Term is literal, not regex.** Escape regex metacharacters before passing to `rg` (`rg -F` or proper escaping). The skill does not currently support regex — adding `--regex` is a future flag.
- **Spaces in term are preserved.** `<search> Richard Cook` searches for the literal two-word phrase, not two separate terms.
- **Do not summarise hits.** Return raw `file:line — snippet` rows. Synthesis is the caller's job.
- **Respect `.gitignore`.** `rg`'s default behaviour. Never override with `--no-ignore` unless the user explicitly asks.
- **Snippet length is ≤80 chars.** Long lines (minified bundles, base64 blobs) get trimmed by `rg --max-columns=200` and then by the sub-agent before return.
- **One run only.** Do not auto-retry buckets that returned `NO HITS`. Zero is a valid answer.

---

## When NOT to use this skill

- **Code symbols.** "Where is `useSentinel` defined" / "who calls `polymorphicrefs.Resolve`" / "what implements `topology.Service`" — use the LSP MCP tools (`lsp-ts__definition`, `lsp-ts__references`, `lsp-go__implementation`). One typed call beats a 4-Haiku fan-out that returns grep matches in comments and dead branches.
- **Known target.** If the user names a specific file/symbol and you can `Read` or `Grep` it in one shot, do that instead.
- **Semantic search.** "Where do we handle auth failures?" is a research question for the `Explore` agent, not a literal-string sweep.
- **Code review / audit.** Use `code-reviewer` or `Plan` agents — they read whole files, not excerpts.
