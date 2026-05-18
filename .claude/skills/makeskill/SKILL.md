---
name: makeskill
description: Meta-skill — generate a NEW audit/report skill from the user's preceding chat statement + a name flag. The generated skill follows the canonical audit→HTML+TOC→JSON→next-R### pipeline and writes its report into dev/research/ (Dev → Research tab). Invocation pattern is `<makeskill>-<name>-<scope>`.
argument-hint: -<skillname> [-<scope>]   (e.g. -<ui> -<frontend>)
allowed-tools: Read Write Edit Bash Glob Grep
---

# Make-Skill Skill (`<makeskill>`)

`<makeskill>` is a **factory**. It reads the statement the user wrote in the same chat message just before the `<makeskill>-<name>` token, treats that statement as the audit/report **brief**, and produces a brand-new skill that — when invoked — runs the canonical Vector report pipeline:

> **audit → HTML+TOC → JSON → next sequential R### → write to `dev/research/` → confirm**

This is the same pipeline used by `<codebase>` and `<sec>`. The brief is what changes; the wiring is identical.

## Invocation syntax

```
"<the brief — role + report goal + investigation directives + output expectations>"  <makeskill>-<name> [-<scope>]
```

- `-<name>` — REQUIRED. The tag the new skill will register under (e.g. `-<ui>` → `<ui>`).
- `-<scope>` — OPTIONAL. One of: `-<frontend>`, `-<backend>`, `-<db>`, `-<docs>`, `-<all>`. Defaults to `-<all>` if omitted.

### Examples

```
"You are a UI/UX specialist. Audit every page, component, and route for visual hierarchy, accessibility, and information density. Score against the 7 axes of design quality and produce a research-paper-style report." <makeskill>-<ui> -<frontend>

"You are a database architect. Inspect schema, indexes, query patterns, and migration history for normalisation, query hot-paths, and FK integrity." <makeskill>-<dba> -<db>

"You are a docs editor. Review every markdown file for tone, accuracy, dead links, drift from code, and onboarding clarity." <makeskill>-<docs-audit> -<docs>
```

## Behaviour — step by step

### Step 1 — Parse the invocation

From the current user turn, extract:

- **The brief** — every line of user text in the SAME message that appears BEFORE the `<makeskill>-<...>` token. Trim whitespace. This is the verbatim audit prompt that will be embedded in the new skill. Do NOT paraphrase, summarise, or "improve" it — embed it literally so subsequent runs are deterministic.
- **`<name>`** — the kebab-case identifier immediately after the first `-<` … `>`. Validate: `^[a-z][a-z0-9-]{1,30}$`. Reject empty or whitespace.
- **`<scope>`** — the identifier in the second `-<…>` if present. Must be one of `frontend | backend | db | docs | all`. Default `all`.

If the brief is empty or shorter than ~50 chars, STOP and ask the user to provide a real brief — do not invent one.

### Step 2 — Collision check (HARD STOP if collision)

Check for existing skills with the same name:

```bash
ls .claude/skills/<name>/SKILL.md 2>/dev/null
ls .claude/commands/c_<name>.md 2>/dev/null
```

Also scan the available-skills list in this turn's system context for any registered skill matching `<name>`.

If ANY of the above exist, STOP and report to the user:

```
Skill `<name>` already exists at <path>.
Options:
  1. Pick a different name (run `<makeskill>` again with a new -<flag>)
  2. Overwrite (re-run with `-<name>-<force>` token at the end)
  3. Open the existing skill to extend it manually
```

Do NOT overwrite without the explicit `-<force>` token. Do NOT auto-suffix with a version number.

### Step 3 — Compose the scope filter

Translate the `-<scope>` flag into a concrete scan filter that will appear inside the generated skill's audit instructions. Use this exact mapping:

| Flag         | Scan roots                                                                                | Notes |
|--------------|-------------------------------------------------------------------------------------------|-------|
| `frontend`   | `app/`, `app/components/`, `app/lib/`, `*.css`, `*.tsx`, `*.ts` (excluding `backend/`)    | UI / client-side audits |
| `backend`    | `backend/internal/`, `backend/cmd/`, `backend/dev/`, `*.go`                               | Go service audits |
| `db`         | `db/`, `backend/internal/**/*sql*.go`, `docs/c_schema.md`, `docs/c_sql_cookbook.md`       | Schema + migration audits |
| `docs`       | `docs/`, `BACKLOG.md`, `Vector_Scope.md`, `*.md` at repo root, `.claude/CLAUDE.md`        | Documentation audits |
| `all`        | Entire repo                                                                               | Default; matches `<codebase>` and `<sec>` |

**Always skip in every scope:**

- `node_modules/`
- `.next/`
- `.git/`
- `.claude/worktrees/`
- `cgl-volatile-do-not-commit/`
- `dist/`, `build/`, `out/`
- `*.min.js`, `*.map`, `*.lock` (note as skipped)

### Step 4 — Generate `.claude/skills/<name>/SKILL.md`

Create the directory and write the file. Use the template below verbatim, substituting:

- `{{NAME}}` → the `<name>` flag value
- `{{SCOPE_FLAG}}` → the `<scope>` value (`frontend` / `backend` / `db` / `docs` / `all`)
- `{{SCOPE_ROOTS}}` → the matching scan roots from Step 3's table
- `{{BRIEF}}` → the verbatim user brief from Step 1, indented as fenced markdown block
- `{{SHORT_DESC}}` → first sentence of the brief, truncated to ~120 chars, used in the YAML `description:` field
- `{{TODAY}}` → today's date in `YYYY-MM-DD` (use `date +%Y-%m-%d` if needed)

```markdown
---
name: {{NAME}}
description: {{SHORT_DESC}} Saves to dev/research/ as next R### entry (Dev → Research tab).
argument-hint: (no arguments required)
allowed-tools: Read Grep Glob Bash Write Agent
---

# `<{{NAME}}>` Skill — generated by `<makeskill>` on {{TODAY}}

Runs the brief below against the **{{SCOPE_FLAG}}** scope of the codebase, compiles a research-paper-style markdown report, converts it to the canonical HTML+TOC format, and saves it as the next sequential `dev/research/R###.json` — viewable in Dev → Research.

## Scan scope (`{{SCOPE_FLAG}}`)

Include:
{{SCOPE_ROOTS}}

Always skip:
- `node_modules/`, `.next/`, `.git/`, `.claude/worktrees/`, `cgl-volatile-do-not-commit/`
- `dist/`, `build/`, `out/`
- `*.min.js`, `*.map`, `*.lock` (note as skipped)

## Behaviour

### Step 1 — Compute next R ID

```bash
ls dev/research/R*.json 2>/dev/null | grep -oE 'R[0-9]+' | sort -V | tail -1
```

Zero-pad to 3 digits and increment: `R001`, `R002`, …

### Step 2 — Run the audit (using the embedded brief below)

Spawn a sub-agent (`subagent_type: general-purpose`) with the AUDIT BRIEF below as its task. Keep it sub-agent-driven so the main context stays lean for the HTML conversion step.

---

## AUDIT BRIEF (verbatim — do not paraphrase)

{{BRIEF}}

---

### Step 3 — Convert to HTML with TOC

Mirror the shape of recent `dev/research/R*.json` files (read one to confirm the current convention before writing). Wrap the report in:

```html
<div class="dui-doc">
  <div class="dui-toc-layout">
    <aside class="dui-toc">
      <h3>Contents</h3>
      <ol>
        <!-- one <li><a href="#slug">Section name</a></li> per H2 -->
      </ol>
    </aside>
    <div>
      <!-- converted markdown content here -->
    </div>
  </div>
</div>
```

Conversion rules:
- `##` → `<h2 id="slug">` (slug = lowercase-hyphenated)
- `###` → `<h3>`
- Markdown tables → `<table class="dui-table"><thead>…</thead><tbody>…</tbody></table>`
- `**bold**` → `<strong>`
- `` `code` `` → `<code>`
- Lists → `<ul>/<li>` or `<ol>/<li>`
- Paragraphs → `<p>`
- Rating / severity words in tables get a class:
  - `Critical` / `Poor` → `<span class="dui-sev dui-sev--critical">…</span>`
  - `Fair` → `<span class="dui-sev dui-sev--high">…</span>`
  - `Good` → `<span class="dui-sev dui-sev--medium">…</span>`
  - `Excellent` → `<span class="dui-sev dui-sev--low">…</span>`

### Step 4 — Write the JSON file

Write `dev/research/R###.json`:

```json
{
  "id": "R###",
  "title": "{{NAME}} report — <YYYY-MM-DD>",
  "category": "{{NAME}}",
  "topic": "<one-sentence restatement of the brief's goal>",
  "date": "<YYYY-MM-DD>",
  "summary": "<one-sentence overall verdict>",
  "content": "<html string from step 3>"
}
```

### Step 5 — Confirm

```
{{NAME}} report written: R### → dev/research/R###.json
Verdict: <one-line summary>
Open in Dev → Research to view.
```

## Notes

- Generated by `<makeskill>` — re-running `<makeskill>` with the same `-<{{NAME}}>` flag will be REJECTED. To regenerate, delete this file first or use the `-<force>` token.
- The `dev/research/` panel reads from `GET /api/dev/research`; no app code changes required.

$ARGUMENTS
```

### Step 5 — Register pointer in `.claude/CLAUDE.md`

Append a one-line entry following the project's authoring rule (bold label → arrow → markdown link → half-sentence hook). Insert it just before the `**Codebase file index**` line so all skill pointers cluster at the bottom.

Use this exact format:

```
- **`<{{NAME}}>` skill** → [`.claude/skills/{{NAME}}/SKILL.md`](skills/{{NAME}}/SKILL.md) — generated by `<makeskill>` on {{TODAY}}; runs the {{NAME}}-brief audit against {{SCOPE_FLAG}} scope; writes next R### into `dev/research/`.
```

Use the `Edit` tool, not `Write` (so we don't overwrite CLAUDE.md). Read CLAUDE.md first to satisfy the Edit tool's read-before-edit requirement.

### Step 6 — Confirm to user

Report exactly:

```
New skill registered: <{{NAME}}>
  File:    .claude/skills/{{NAME}}/SKILL.md
  Scope:   {{SCOPE_FLAG}}
  Brief:   <first 80 chars of brief>…
  Pointer: added to .claude/CLAUDE.md

Run `<{{NAME}}>` whenever you want a fresh report — it auto-files the next R### in dev/research/.
```

## Rules — non-negotiable

1. **Embed the brief verbatim.** Do not rewrite, summarise, expand, or "polish" the user's statement. The whole point is that the same brief produces the same report every run.
2. **Never overwrite an existing skill** without an explicit `-<force>` token in the same invocation.
3. **Never invent the brief.** If the user wrote `<makeskill>-<ui>` with no preceding statement, STOP and ask. Do not auto-generate a UI audit brief from thin air.
4. **Always file the pointer.** The new skill is invisible to future sessions until it's in `.claude/CLAUDE.md`.
5. **Default scope is `-<all>`.** If the user doesn't pass a scope flag, the new skill audits the whole repo (matching `<codebase>` / `<sec>` behaviour).
6. **Reject reserved names.** Block names that collide with built-in tools or core project skills: `research`, `sec`, `codebase`, `scope`, `stories`, `memory`, `retro`, `migration`, `cookbook`, `backlog`, `server`, `services`, `playwright`, `selenium`, `npm`, `tree`, `accounts`, `tests`, `librarian`, `launcher`, `shortcuts`, `db-backup`, `make-app`, `make-dev-app`, `code-standards`, `write-research-paper`, `addpaper`, `addpaper-stories`, `research-paper-format`, `makeskill`. Tell the user the name is reserved and ask for another.

$ARGUMENTS
