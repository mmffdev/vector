# c_addpaper — Add Research Paper (Topic, Search-Only Shorthand)

**Loaded on demand — read this file when the user writes `<addpaper>` followed by a topic.**

This is the lightweight shorthand for **web-search-only** research papers. For URL crawling + search, use `<research>` (see [`c_research.md`](c_research.md)) which has more horsepower.

`<addpaper>` gathers content via web search, then hands off to [`c_write-research-paper.md`](c_write-research-paper.md) which writes the JSON paper to `dev/research/RNNN.json` (PM's research store, viewable in Dev → Research tab).

---

## Input

User provides: `<addpaper> <topic>`

Example: `<addpaper> Docker Swarm networking`

---

## Steps

### 1. Clarify Research Type

Ask:

> Is this research about:
> A) **A product/tool/platform** (e.g., "Stripe API", "Kubernetes")
> B) **A concept/technique/question** (e.g., "Agile retrospectives", "API rate limiting")
> C) **A comparison/landscape** (e.g., "React testing frameworks 2026")

User's answer guides the research focus and output structure.

### 2. Web Search & Content Gathering

Perform 2–3 web searches to triangulate the topic.

**For products/tools:**
- `<name> features <year>`
- `<name> vs alternatives`
- official documentation links

**For concepts/techniques:**
- `<topic> best practices`
- `<topic> tutorial <year>`
- `<topic> problems challenges`

**For comparisons:**
- `<topic> comparison 2026`
- `<name1> vs <name2>`

Extract from each result: main concepts / features / definitions, key statistics / trends, use cases / benefits, limitations / tradeoffs, recent updates.

### 3. Compile Findings

Organise the search results into the **PM JSON content format** — semantic HTML inside a single string. The shape mirrors the existing `dev/research/R*.json` files:

- `<h2>` for top-level sections, `<h3>` for sub-sections
- `<p>`, `<ul>/<ol>/<li>`, `<table>/<thead>/<tbody>/<tr>/<th>/<td>`, `<code>`, `<pre><code>`
- No `<script>`, `<style>`, or event handlers
- HTML-escape entities in attribute values
- Pure HTML string — no JSX

Recommended sections: **Overview**, **Key Findings**, **Detailed Analysis** (with sub-headings), **Sources** (numbered `<ol>`), **Gaps** (what couldn't be verified).

### 4. Infer Metadata

From the compiled findings, infer:
- **`title`** — short descriptive (5–8 words)
- **`category`** — one of: Architecture, Database, API, Frontend, Security, DevOps, Research, Other
- **`summary`** — single sentence, ≤120 chars (shown in the accordion header)

### 5. Hand Off to Shared Writer

**Read [`c_write-research-paper.md`](c_write-research-paper.md)** (sibling file in `.claude/commands/`) and provide:

- `topic` — the original `<addpaper>` argument
- `title` — inferred title
- `category` — inferred category
- `summary` — one-sentence accordion header
- `content` — the compiled HTML string (from step 3)

That writer allocates the next `RNNN` ID, stamps today's date, and writes the JSON file. Returns the allocated ID and asks about stories.

---

## Research Quality

Use **Claude Sonnet 4.6** for synthesis. Multi-query triangulation, structured sections, and source-traceable findings need stronger reasoning than Haiku.

**Source rule:** every factual claim must be traceable to a fetched page. No fabrication — if it can't be found, list it under **Gaps**.

---

## When to Decline Stories

After the paper is written and the user is asked **"Want stories?"**, apply these heuristics:

**Decline (respond "no") if:**
- Pure intelligence gathering, competitor survey, or product catalogue
- No actionable technical outcomes
- Findings are exploratory with no implementation plan

**Accept (respond "yes") if:**
- Research describes a technology / tool / technique to adopt
- Clear implementation work is implied
- The topic is a feature request or architectural decision

If the user accepts, [`c_addpaper-stories.md`](c_addpaper-stories.md) takes over — it proposes story candidates and hands off to the project's `/stories` skill (which creates Planka cards through the 7-gate system).

---

## Integration

```
<addpaper> topic
      │
      ▼
  Web search → compile HTML findings
      │
      ▼
  Read c_write-research-paper.md
      (provide: topic, title, category, summary, content)
      │
      ▼
  RNNN.json written to dev/research/, story prompt shown
      │
      ▼
  If "yes" to stories → read c_addpaper-stories.md → hand off to /stories
```

This protocol does **not** write files or create cards — that's the writer's and `/stories` skill's job respectively.
