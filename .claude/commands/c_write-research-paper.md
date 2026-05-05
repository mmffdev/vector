# c_write-research-paper — Write Research Paper (Shared Writer)

**Loaded on demand — read this file when [`c_addpaper.md`](c_addpaper.md) (or any future research-creating protocol) needs to materialise a paper.**

This is the **shared CREATE step** for PM research papers. It receives compiled content + metadata, allocates the next ID by scanning `dev/research/`, stamps today's date, and writes the JSON file.

Filesystem-only — the frontend (Dev → Research tab) auto-discovers papers from `dev/research/R*.json`.

---

## Input

The calling protocol must provide:

| Field | Type | Example |
|---|---|---|
| `topic` | string | `"Docker Swarm networking"` (the original `<addpaper>` arg) |
| `title` | string (5–8 words) | `"Docker Swarm Networking — Production Patterns"` |
| `category` | string | one of: `Architecture`, `Database`, `API`, `Frontend`, `Security`, `DevOps`, `Research`, `Other` |
| `summary` | string (≤120 chars) | one-sentence accordion header |
| `content` | string (HTML) | semantic HTML — see [`c_research-paper-format.md`](c_research-paper-format.md) |

The writer stamps `date` itself — callers do not supply it.

---

## Steps

### 1. Allocate next ID (filesystem)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector/dev/research"
LAST=$(ls R*.json 2>/dev/null | sort | tail -1 | sed -E 's/R0*([0-9]+)\.json/\1/')
NEXT=$(printf "R%03d" $((${LAST:-0} + 1)))
echo "Next ID: $NEXT"
```

(Return to the repo root before subsequent steps.)

### 2. Stamp today's date

```bash
TODAY=$(date "+%Y-%m-%d")
```

### 3. Read the format spec

**Read [`c_research-paper-format.md`](c_research-paper-format.md)** for the canonical JSON shape and content-HTML rules. All template rules live there — this file only handles the CREATE flow.

> **HARD RULE — dev-ui catalog only.** The Research tab is a Dev Setup page; the writer MUST emit only `.dui-*` classes (`.dui-doc`, `.dui-toc-layout`, `.dui-toc`, `.dui-table`, `.dui-pre`, `.dui-pill`). Never invent a class. Never inline `style=`. See [`docs/c_c_dev_ui_primitives.md`](../../docs/c_c_dev_ui_primitives.md).

> **TOC wrapper is mandatory.** Before writing, wrap the supplied `content` in the `.dui-toc-layout` / `.dui-toc` pattern defined under "Left-column TOC wrapper" in the format spec — one `<li>` per `<h2>`, matching `id`/`href` slugs, no inline styles. Skip only if the paper has fewer than 2 `<h2>` sections.

### 4. Write the JSON file

Create `dev/research/{NEXT}.json` with the shape defined in `c_research-paper-format.md`. Substitute:

- `id` → the allocated ID (e.g. `R003`)
- `title` → the supplied title
- `category` → the supplied category
- `topic` → the supplied topic
- `date` → `$TODAY`
- `summary` → the supplied summary
- `content` → the supplied HTML (escape JSON special chars: `\`, `"`, control chars)

**Important:** The `content` field is a single JSON string. Escape `"` as `\"` and `\` as `\\`. Use `python3 -c 'import json; print(json.dumps({...}))'` for safety with large content blocks.

### 5. Confirm to user

Print:

> **{NEXT} written** — `dev/research/{NEXT}.json`
> Title: {title}
> Category: {category}
> Date: {date}

### 6. Ask: Accept stories?

Print:

> **Proposed Stories**
> Would you like to propose user stories for this research?
> (yes/no — only relevant if this paper describes a feature change or technical upgrade)

**If no:** Done. The paper is complete.

**If yes:** Read [`c_addpaper-stories.md`](c_addpaper-stories.md) and follow it. That protocol synthesises story candidates from the compiled content and hands off to the project's `/stories` skill (which creates Planka cards through the 7-gate system).

---

## Notes

- **No DB writes.** PM's research store is filesystem-only — the Dev → Research tab reads `dev/research/R*.json` directly.
- **No version / revised fields.** PM's JSON shape does not include them. Updates happen by editing the JSON directly. (mmff-Ops uses TSX with a version-bump system; PM intentionally diverges to stay JSON-pure.)
- Format / shape rules are owned by [`c_research-paper-format.md`](c_research-paper-format.md) — do not duplicate them here.
- Story integration is **optional** — if the user declines stories, the paper is complete.
