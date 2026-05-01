# c_research-paper-format — PM Research Paper JSON Format (Shared)

**Loaded on demand — read this file when [`c_write-research-paper.md`](c_write-research-paper.md) needs the canonical JSON shape.**

This file owns the **JSON shape, field semantics, and content-HTML rules** for all PM research papers. Papers live at `dev/research/R*.json` and are auto-discovered by the Dev → Research tab.

---

## JSON shape

Every paper is a single JSON object with exactly these fields:

```json
{
  "id": "RXXX",
  "title": "Short descriptive title (5–8 words)",
  "category": "Architecture | Database | API | Frontend | Security | DevOps | Research | Other",
  "topic": "The URL or research question passed as input",
  "date": "YYYY-MM-DD",
  "summary": "One sentence shown in the accordion header (≤ 120 chars)",
  "content": "<h2>Section heading</h2><p>HTML content...</p>"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Zero-padded 3-digit, prefix `R` (e.g. `R001`, `R042`) |
| `title` | yes | Human-readable, 5–8 words |
| `category` | yes | One of the eight enum values above |
| `topic` | yes | Original `<addpaper>` arg or research question |
| `date` | yes | Creation date, `YYYY-MM-DD` (no time) |
| `summary` | yes | One-line accordion header, **≤120 chars** |
| `content` | yes | Single HTML string (see rules below) |

---

## content rules

The `content` field is a **single HTML string** — semantic HTML only.

**Allowed tags:**
- Structure: `<h2>`, `<h3>`, `<p>`, `<hr>`
- Lists: `<ul>`, `<ol>`, `<li>`
- Tables: `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`
- Inline: `<strong>`, `<em>`, `<code>`, `<a href="...">`
- Code blocks: `<pre><code>...</code></pre>`

**Forbidden:**
- `<script>`, `<style>`, or any tag with event handlers (`onclick`, `onload`, etc.)
- Inline `style=` attributes (the renderer applies its own styles)
- JSX syntax (`{...}`) — pure HTML only
- `<h1>` (the renderer prepends the title as h1)

**Encoding:**
- HTML-escape entities in attribute values (`&`, `<`, `>`, `"`)
- Inside the JSON string, escape `"` as `\"` and `\` as `\\`

---

## Left-column TOC wrapper (mandatory when ≥2 `<h2>` sections)

Every paper with two or more `<h2>` sections **must** wrap its content in a left-column table-of-contents layout. The Dev → Research panel renders this as a sticky sidebar with sidebar-style hover and scroll-spy highlighting (driven by `dev/styles/dev.css` — no inline styles).

### Required HTML pattern

```html
<div class="r-toc-layout">
  <aside class="r-toc">
    <div class="r-toc__label">Contents</div>
    <ol class="r-toc__list">
      <li><a href="#section-slug-1">1. Section Title One</a></li>
      <li><a href="#section-slug-2">2. Section Title Two</a></li>
      <!-- one <li> per <h2> in the body, in document order -->
    </ol>
  </aside>
  <div class="r-toc-body">
    <h2 id="section-slug-1">1. Section Title One</h2>
    <p>...</p>
    <h2 id="section-slug-2">2. Section Title Two</h2>
    <p>...</p>
    <!-- rest of the paper -->
  </div>
</div>
```

### Slug rules

For each `<h2>`, derive its `id` and matching anchor `href` by:

1. Strip inner HTML tags from the heading text.
2. Lowercase, replace any run of non-alphanumeric chars with `-`.
3. Trim leading/trailing `-`. If empty, use `section`.
4. If the slug collides with an earlier one in the same paper, append `-2`, `-3`, etc.

Examples:
- `7. Core Column Set (universal, every artefact type)` → `7-core-column-set-universal-every-artefact-type`
- `Phase 1 Implementation Status (2026-05-01)` → `phase-1-implementation-status-2026-05-01`

### Hard rules

- **No inline `style=` attributes** anywhere in the wrapper. All styling lives in `dev/styles/dev.css` under `.r-toc*`.
- **Class names are exact**: `r-toc-layout`, `r-toc`, `r-toc__label`, `r-toc__list`, `r-toc-body`. Don't rename.
- **Every `<h2>` in the body must have an `id`** matching its TOC entry's `href` — otherwise scroll-spy breaks.
- **Skip the wrapper** entirely when the paper has 0 or 1 `<h2>` — a one-item TOC is noise.
- **Sub-headings** (`<h3>` and below) are not included in the TOC.

---

## Recommended sections

For consistency across papers, prefer this section order:

1. **Overview** — 1–3 sentence intro, why this matters
2. **Key Findings** — bulleted list of the most important takeaways
3. **Detailed Analysis** — deep dive with `<h3>` sub-headings
4. **Data Tables** — any structured data extracted (feature lists, comparisons, specs)
5. **Sources** — numbered `<ol>` of every URL fetched, with title (`<a href="url">title</a>`)
6. **Gaps** — what couldn't be found or verified

Pure product surveys may use a **Feature Catalogue** structure instead — see existing `dev/research/R001.json` for an example.

---

## Quality rules

- **No fabrication** — every factual claim must trace back to a numbered source. Unverifiable items go in **Gaps**.
- **Prefer primary sources** — official docs > blog posts > forum threads.
- **Date awareness** — note when content appears outdated.
- **Structured data first** — extract tables, feature lists, specs as HTML tables rather than prose.

---

## Notes

- The frontend reads `dev/research/R*.json` and renders `content` directly. No TSX, no React component per paper.
- This is intentionally simpler than mmff-Ops's TSX format (which includes `version`, `revised`, action-plan tables, and a build step). PM stays JSON-pure to keep the research store editable by hand and viewable without recompiling.
- If you need versioning or revision tracking, edit the JSON in place and rely on git history — there is no in-file `version` field.
