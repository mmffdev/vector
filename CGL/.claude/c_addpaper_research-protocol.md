# c_addpaper_research — Research Agent (URL Crawl + Web Search)

**Loaded on demand — read this file when the user writes `<research>` followed by a URL and/or topic.**

This protocol is the **input phase** for `<research>`. It crawls websites, searches the web, and compiles findings. On the `--page` flag, it hands off to `c_write-research-paper.md` to create a paper.

---

## Input Parsing

Parse the user's `<research>` argument for:

| Token | Meaning |
|---|---|
| `http://...` or `https://...` | URL to crawl (optional) |
| `"quoted text"` | Topic to search for (optional) |
| `--page` | Create a new research paper (TSX + DB) |
| `--output /path/to/file` | Save markdown report to file |
| `--search-only` | Skip URL crawling; web search only |
| `--no-search` | Skip web search; crawl only |

If neither URL nor topic provided, ask: **"What would you like me to research?"**

---

## Execution Flow

### Phase 1: Gather Content

**If URL provided (and not `--search-only`):**
- Fetch the URL
- Parse main content (title, sections, code blocks)
- Extract internal links and crawl up to 5 related pages (depth 1)
- Compile findings into structured sections

**If topic provided (and not `--no-search`):**
- Web search for the topic using 3–5 search queries
- Compile results into structured sections
- If URL was also provided, interleave findings with URL content

**If both skipped:**
- Ask for clarification

### Phase 2: Route Output

After gathering content, check flags:

#### If `--page` flag:

1. Extract title and category from content
2. Synthesise 3–5 sentence executive summary
3. Hand off to `c_write-research-paper.md`:
   ```
   Read ~/.claude/c_write-research-paper.md
   Provide:
     - content: compiled markdown findings
     - title: inferred from content or user input
     - category: inferred from content (e.g., "DevOps", "Architecture", "Feature Profiles")
     - date: today's date (YYYY-MM-DD)
   ```
4. That protocol will allocate ID, create TSX, register DB, and ask about stories.

#### If `--output /path` flag:

1. Write the full markdown report to the specified path
2. Print confirmation: **"Report saved to `/path`"**
3. Stop (no paper creation, no story prompt)

#### If neither flag:

1. Display the compiled markdown report in chat
2. Print notice: **"To save this as a research paper: `<research> <topic> --page`"**
3. Stop

---

## Content Compilation

Regardless of input source, structure the findings as:

```
# Topic: [Title]

## Overview
[1–3 sentence summary]

## Key Findings
- Finding 1
- Finding 2
- ...

## [Custom Section Title]
[Details, data, analysis]

## References
- [URL 1](url)
- [URL 2](url)
```

For `--page` output, extract the Overview section as the executive summary and use the full structure as "Detailed Findings" in the TSX.

---

## Flags Summary

| Flag | Behaviour |
|---|---|
| `--page` | Create research paper (allocate ID, TSX, DB, story prompt) |
| `--output /path` | Save markdown report to file path |
| `--search-only` | Skip URL crawling; web search only |
| `--no-search` | Skip web search; crawl only |

**Typical usage:**
```
<research> https://docs.example.com "Topic" --page
  → crawl URL + search web + create paper

<research> "Vite 6 features" --page
  → web search only + create paper

<research> https://example.com --output /tmp/report.md
  → crawl URL only + save to file

<research> "Agile tools 2026" --search-only --output /tmp/agile.md
  → web search only + save to file
```

---

## Web Search & Crawl Quality

### Web Search Best Practices
- Use 2–3 search queries to triangulate the topic
- Prioritise recent results (last 12 months)
- Extract key facts, trends, and data points
- Include source URLs for all findings

### URL Crawl Best Practices
- Fetch and parse the main page first
- Follow internal links (same domain) up to depth 1
- Skip navigation/footer/sidebar boilerplate
- Extract main content (body text, headings, code blocks)
- Include source URLs and section anchors

### When to Favour Search vs Crawl
- **Crawl alone** (`--no-search`): when user provides a comprehensive documentation site
- **Search alone** (`--search-only`): when researching trends, comparisons, or scattered information
- **Both** (default): when user provides a starting URL + wants broader context

---

## Model Notes

Use **Claude Sonnet 4.6** for research synthesis. Haiku 4.5 is lighter; Sonnet handles:
- Multi-page crawling + synthesis across sources
- Extracting actionable insights from noisy search results
- Structuring complex findings coherently

---

## Integration with c_write-research-paper.md

When `--page` is specified, you do **not** create the paper directly. Instead:

1. Compile all content
2. Extract title + category
3. Write 3–5 sentence executive summary
4. **Read `~/.claude/c_write-research-paper.md`** and provide the above fields
5. That protocol handles ID allocation, TSX creation, DB registration, and story prompt

This keeps the two protocols focused: `c_addpaper_research-protocol.md` gathers content; `c_write-research-paper.md` writes the paper.
