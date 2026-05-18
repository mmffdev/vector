---
name: codebase
description: Run a full codebase quality audit (7-dimension research-paper review) and save it to dev/research/ as the next sequential R### entry, viewable in Dev → Research. One-shot — no other shortcut required.
argument-hint: (no arguments required)
allowed-tools: Read Grep Glob Bash Write Agent
---

# Codebase Quality Audit Skill (`<codebase>`)

Performs a deep-dive review of the entire codebase against 7 quality dimensions (Coding Standards, Cleanliness, Approach, Ease of Understanding, Ease of Management, Ease of Future-Proofing, Ease of Maintenance), compiles a research-paper-style markdown report, converts it to the HTML+TOC format used by the Dev → Research panel, and saves it as the next sequential `dev/research/R###.json`.

This is the **only** shortcut needed — it runs the audit AND files the report in one shot. There is no separate `<report>` step.

## Behaviour

### Step 1 — Compute next R ID

Scan `dev/research/` for existing `R*.json` files and compute the next sequential ID:

```bash
ls dev/research/R*.json 2>/dev/null | grep -oE 'R[0-9]+' | sort -V | tail -1
```

Zero-pad to 3 digits: `R001`, `R002`, … (current head is in the high R0NN range — increment from whatever the scan returns; do NOT hardcode).

### Step 2 — Run the audit

Spawn a sub-agent (preferred — keeps main context lean) with the AUDIT PROMPT below against the entire codebase. Scan recursively. Skip binary/minified/vendored files (note them as skipped). Assume production deployment context.

Recommended agent: `subagent_type: general-purpose` with a self-contained brief; or perform inline if the codebase is small enough.

**Always skip:**
- `node_modules/`
- `.next/`
- `.claude/worktrees/`
- `cgl-volatile-do-not-commit/`
- `dist/`, `build/`, `out/`
- `.git/`
- Any `*.min.js`, `*.map`, `*.lock` files (note as skipped)

---

## AUDIT PROMPT

You are an expert software engineer and code quality analyst. Your task is to perform a **deep-dive review of the entire codebase** and produce a **research-paper-style report**.

### Scope of Review

Analyze every relevant file in the codebase (source code, configuration, tests, scripts, documentation) and evaluate it against the following axes:

1. **Coding Standards** – Consistency with language/framework best practices, naming conventions, formatting, linting rules, and use of language idioms.
2. **Cleanliness** – Absence of dead code, duplication, commented-out blocks, overly long functions/classes, magic numbers/strings, and obvious code smells.
3. **Approach** – Architectural choices, design patterns, separation of concerns, modularity, error handling, and whether the solution fits the problem domain.
4. **Ease of Understanding** – Readability, meaningful naming, comments where needed, documentation (README, inline docs, API docs), and logical flow.
5. **Ease of Management** – How easy it is to add/remove features, configuration management, dependency management, environment setup, and build/deploy process.
6. **Ease of Future-Proofing** – Abstraction levels, coupling, reliance on brittle APIs, test coverage, handling of edge cases, and adaptability to change.
7. **Ease of Maintenance** – Testability, logging, debugging support, error traceability, CI/CD setup, and how long it would take a new developer to fix a bug.

### Required Investigation Actions

- **Scan all directories** — Do not skip hidden folders, test folders, or build scripts unless they are clearly generated.
- **Identify patterns** — Note recurring anti-patterns or exemplary patterns.
- **Static analysis** — Mentally simulate linting and common security/performance pitfalls.
- **Cross-reference** — Check if documentation matches implementation.
- **Dependency review** — Analyze `package.json` / `requirements.txt` / `go.mod` / etc. for bloat, outdated versions, or tight coupling.
- **Test assessment** — Review test coverage, test quality, and edge-case handling.

### Output Report Format

Produce a **research paper** with the following sections:

#### Title
**Codebase Quality Audit: [Project Name or "Current Project"]**

#### Abstract
Summary of overall findings, key strengths, and critical weaknesses (150–200 words).

#### 1. Methodology
Briefly describe your review process, tools used (e.g., mental static analysis, pattern recognition, dependency inspection), and scope limitations.

#### 2. Findings by Dimension
For each of the 7 dimensions, provide:
- **Rating** (Excellent / Good / Fair / Poor / Critical)
- **Evidence** (concrete file/line examples or patterns found)
- **Analysis** (why this matters)

#### 3. Cross-Cutting Observations
- Duplication & Reusability
- Documentation Quality
- Testing & Testability
- Error Handling & Logging
- Security Nuances

#### 4. Case Studies (Deep Dives)
Pick **3 specific files/modules** (one simple, one moderate, one complex) and perform a miniature forensic review showing how the dimensions manifest in real code.

#### 5. Recommendations
Prioritized by impact vs. effort:
- **Critical fixes** (must fix before further development)
- **Structural improvements** (refactoring, modularization)
- **Housekeeping** (linting, formatting, cleanup)
- **Process changes** (code review checklists, docs updates)

#### 6. Conclusion
Final verdict on overall codebase health, estimated time to remediate major issues, and a confidence score (High/Medium/Low).

#### Appendix
- **A: Files reviewed** (top-level listing)
- **B: Suspected issues table** (file, line, issue type, severity)
- **C: Suggested metrics** (e.g., cyclomatic complexity hotspots, duplication percentage)

### Tone & Style

- **Objective and evidence-based** — every claim backed by file/line references or pattern descriptions.
- **Constructively critical** — point out flaws without cynicism, highlight good practices.
- **Research-oriented** — use headings, subheadings, bullet points, and tables where helpful.

Begin the report with: **"Starting comprehensive codebase review..."** then proceed with the investigation and report.

---

### Step 3 — Convert to HTML with TOC

Convert the markdown report to an HTML string using the same `dui-toc-layout` structure as research entries (mirror the shape of recent `dev/research/R*.json` files — confirm by reading one before writing):

```html
<div class="dui-doc">

<div class="dui-toc-layout">

<aside class="dui-toc">
<h3>Contents</h3>
<ol>
  <li><a href="#abstract">Abstract</a></li>
  <li><a href="#methodology">Methodology</a></li>
  <li><a href="#findings">Findings by Dimension</a></li>
  <li><a href="#cross-cutting">Cross-Cutting Observations</a></li>
  <li><a href="#case-studies">Case Studies</a></li>
  <li><a href="#recommendations">Recommendations</a></li>
  <li><a href="#conclusion">Conclusion</a></li>
  <li><a href="#appendix">Appendix</a></li>
</ol>
</aside>

<div>
  <!-- converted markdown content here; h2 tags get id= slugs -->
</div>

</div>
</div>
```

Conversion rules:
- `##` headings → `<h2 id="slug">` where slug is lowercase-hyphenated
- `###` → `<h3>`
- Markdown tables → `<table class="dui-table"><thead>…</thead><tbody>…</tbody></table>`
- `**bold**` → `<strong>`
- `` `code` `` → `<code>`
- Lists → `<ul>/<li>` or `<ol>/<li>`
- Paragraphs → `<p>`
- Severity / rating words get a class where they appear in tables:
  - `Critical` / `Poor` → `<span class="dui-sev dui-sev--critical">…</span>`
  - `Fair` → `<span class="dui-sev dui-sev--high">…</span>`
  - `Good` → `<span class="dui-sev dui-sev--medium">…</span>`
  - `Excellent` → `<span class="dui-sev dui-sev--low">…</span>`

### Step 4 — Write the JSON file

Write `dev/research/R###.json` with the same shape used elsewhere in that directory:

```json
{
  "id": "R###",
  "title": "Codebase Quality Audit — <YYYY-MM-DD>",
  "category": "Codebase Audit",
  "topic": "Full-codebase quality audit against 7 dimensions: Coding Standards, Cleanliness, Approach, Ease of Understanding, Ease of Management, Ease of Future-Proofing, Ease of Maintenance.",
  "date": "<YYYY-MM-DD>",
  "summary": "<one-sentence overall verdict — health rating + top recommendation>",
  "content": "<html string from step 3>"
}
```

Use today's date from the environment (`date +%Y-%m-%d` if needed).

### Step 5 — Confirm

Report back to the user, in this exact form:

```
Codebase audit written: R### → dev/research/R###.json
Verdict: <one-line health summary>
Dimensions: <count Excellent / Good / Fair / Poor / Critical>
Open in Dev → Research to view.
```

## Notes

- `dev/research/` is the existing research index — this skill files codebase audits alongside web-research and security-standards entries, all sharing the same R### sequence.
- The panel at `/dev/research` reads from `GET /api/dev/research` which serves this directory; no app code changes required.
- If you need to skip files for any reason (size, format, binary), list them in Appendix A under "Skipped".
- This skill is self-contained — it does NOT call `<report>` or any other shortcut. The user runs `<codebase>` once; the report lands in the next available R### slot automatically.

$ARGUMENTS
