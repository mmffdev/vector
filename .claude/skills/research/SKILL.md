---
name: research
description: Spawn the research agent to crawl a website and compile a structured report. Saves to dev/research/ as a numbered JSON entry viewable in the Dev → Research tab.
argument-hint: <url> "<topic>" [--page] [--output path]
allowed-tools: Read Grep Glob WebFetch WebSearch Write Bash Agent
---

# Research Skill

Crawl a website, search the web, and compile a structured report on a given topic.

## Behaviour

1. Parse arguments for URL(s), topic text, and flags
2. Read `.claude/commands/c_research.md` for the full agent protocol
3. Spawn the research agent via the Agent tool with:
   - The protocol from `c_research.md` as context
   - The URL and topic as the task
   - Output format based on flags

## Flags

- **--page** — Save result as a new RXXX entry in `dev/research/`
  - Scan existing `dev/research/R*.json` files to compute the next sequential ID
  - Write `dev/research/RXXX.json` with `{ id, title, category, topic, date, summary, content }`
  - `content` is an HTML string (not JSX/TSX) — viewable in Dev → Research tab
- **--output path** — Save markdown report to the specified file path
- **(no flag)** — Display the compiled report in the chat

## Examples

```
/research https://docs.docker.com/engine/api/ "Docker Engine API v1.47 capabilities" --page
/research "WordPress local development tools landscape 2026" --output /tmp/wp-local-dev.md
/research https://vitejs.dev "Vite 6 new features"
```

$ARGUMENTS
