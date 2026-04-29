# c_addpaper — Add Research Paper (Topic Research Input Phase)

**Loaded on demand — read this file when the user writes `<addpaper>` followed by a topic.**

This protocol is the **input phase** for `<addpaper>`. It's the lightweight shorthand for `<research> --page --search-only`. It gathers content via web search, then hands off to `c_write-research-paper.md` for paper creation.

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

Perform 2–3 web searches to triangulate the topic:

**For products/tools:**
- Search: `<name> features <year>`
- Search: `<name> vs alternatives`
- Search: official documentation links

**For concepts/techniques:**
- Search: `<topic> best practices`
- Search: `<topic> tutorial <year>`
- Search: `<topic> problems challenges`

**For comparisons:**
- Search: `<topic> comparison 2026`
- Search: `<name1> vs <name2>`

Extract from each result:
- Main concepts / features / definitions
- Key statistics / trends
- Use cases / benefits
- Limitations / tradeoffs
- Recent updates (if applicable)

### 3. Compile Findings

Organize search results into structured markdown:

```
# Topic: [Inferred Title from Topic]

## Overview
[1–3 sentence summary of what this is, why it matters]

## Key Findings / Key Features / Key Points
- Finding 1
- Finding 2
- Finding 3
...

## [Custom Section 1]
[Details, analysis, or deep dive]

## [Custom Section 2]
[More details if applicable]

## References
- [URL 1 - title](url)
- [URL 2 - title](url)
```

**Infer title, category, and executive summary** from the findings:
- **Title**: extracted from search results or refined from user's topic
- **Category**: inferred from content (e.g., "DevOps" for Docker, "Architecture" for system design, "Design" for UI frameworks)
- **Executive Summary**: 3–5 sentence synthesis of the most important findings

### 4. Hand Off to Shared Writer

**Read `~/.claude/c_write-research-paper.md`** and provide:
- `content`: full compiled markdown (from step 3)
- `title`: inferred title
- `category`: inferred category
- `date`: today's date (YYYY-MM-DD)

That protocol will:
1. Allocate next paper ID
2. Create the TSX file with standard template (Executive Summary + Action Plan)
3. Register in the database
4. Ask about stories

---

## Research Quality

Use **Claude Sonnet 4.6** for research synthesis (preferred over Haiku 4.5):
- Multi-query triangulation requires strong reasoning
- Synthesizing scattered sources into coherence
- Extracting actionable insights from noisy results

---

## When to Decline Stories

After the paper is created and the user is asked "Want stories?", apply these heuristics:

**Decline stories (respond "no") if:**
- Research is pure product catalogue (Feature Profiles format)
- No actionable technical outcomes
- Findings are exploratory with no implementation plan
- Topic is a company/competitor survey

**Accept stories (respond "yes") if:**
- Research describes a technology, tool, or technique to adopt
- Clear implementation work is implied
- The topic is a feature request or architectural decision

---

## Integration with c_write-research-paper.md

```
<addpaper> topic
      │
      ▼
  Web search → compile findings
      │
      ▼
  Read c_write-research-paper.md
      (provide: content, title, category, date)
      │
      ▼
  TSX created, DB registered, story prompt shown
      │
      ▼
  If "yes" to stories → read c_addpaper-stories.md
```

This protocol does **not** create files or register in DB — that's the job of `c_write-research-paper.md`.
