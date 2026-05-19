---
name: index
description: >
  Semantic search and re-index of Vector's memory archive via memsearch.
  Flags: `-i` re-index now, `-q "<query>"` search, `-s` show stats,
  no flag = `-q` on the rest of args. Indexes context/memory/,
  context/transcripts/, and the retired .claude/memory/ archive
  using ONNX bge-m3 (local, no API key, no network).
---

# `<index>` — semantic memory search

## What it is

`<index>` wraps `memsearch` (Python CLI installed at `~/.memsearch-venv/bin/memsearch`) to give Tier-1 semantic recall over Vector's memory surface. Vector store is local Milvus Lite at `~/.memsearch/milvus.db`. Embeddings are ONNX bge-m3 int8 (CPU-only, no API key).

## Flags

| Flag | What it does |
|------|---|
| `-i` | Re-index — sweeps all three paths and updates the vector DB. Run after big memory writes or after a Stop hook added a transcript chunk. |
| `-q "<query>"` | Search — returns top-5 chunks by hybrid similarity. Default top-k = 5; override with `-k N`. |
| `-s` | Stats — chunk count, last-indexed timestamps, model in use. |
| `-r <chunk_hash>` | Expand a chunk to its full markdown section. |
| (no flag) | If args present → treat as `-q "<args>"`. If no args → `-s`. |

## Indexed paths

- `context/memory/` — daily logs (`{YYYY-MM-DD}.md`)
- `context/transcripts/` — Stop-hook captures (gitignored, local only)
- `.claude/memory/` — retired 76-file archive (incident-earned safety, project decisions, conventions)

## How to invoke

```bash
# search
~/.memsearch-venv/bin/memsearch search "never git stash" -k 5

# re-index
~/.memsearch-venv/bin/memsearch index \
  "$CLAUDE_PROJECT_DIR/context/memory" \
  "$CLAUDE_PROJECT_DIR/context/transcripts" \
  "$CLAUDE_PROJECT_DIR/.claude/memory"

# stats
~/.memsearch-venv/bin/memsearch stats
```

## When to use

- The user asks about a past decision or rule that isn't in `context/MEMORY.md` (Tier 0 missed).
- You want to recover an incident-earned safety pattern from the retired `.claude/memory/` archive.
- You suspect a transcript from yesterday/last week contains the answer.

## When NOT to use

- The answer is already in `context/MEMORY.md` (Tier 0 — already in your context, zero cost). Always check there first.
- The user is asking about live code state — read the code, don't memory-search it.
- The user is asking about *recent* / *current* state — `git log` and direct reads beat a frozen index.

## Re-index cadence

- Manual via `<index> -i`.
- Automatic nightly at 00:05 via launchd (`com.mmffdev.vector.memsearch-index.plist`).

## Config

Memsearch config is at `~/.memsearch/config.toml`. Embedding provider is `onnx`, model `gpahal/bge-m3-onnx-int8`. Milvus Lite DB at `~/.memsearch/milvus.db`. No env vars required.
