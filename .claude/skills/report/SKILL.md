---
name: report
description: Umbrella skill for every audit / analysis that produces a narrative report on the Dev → Reporting page. Flags pick the report type; each one runs its own protocol, builds the HTML body, and POSTs to /_site/admin/dev/reporting so the report lands in mmff_dev.dev_reports and is viewable immediately. Replaces the retired /research, /codebase, /sec, /code, /retro, /plan skills.
argument-hint: -r <url> "<topic>" | -b | -s | -c [<file>] | -retro [--auto-loop] | -p
allowed-tools: Read Grep Glob WebFetch WebSearch Write Edit Bash Agent
---

# `<report>` — unified report producer

`<report>` is the **only** entrypoint for skills that write a narrative report. Each flag runs a different audit and files its output in [`dev_reports`](../../../db/mmff_dev/schema/002_dev_reports.sql) via the backend handler. The Dev → Reporting page picks them up immediately (DB-backed, no file watchers, no Next.js rebuild).

**Why one skill, not five.** The old `/research`, `/codebase`, `/sec`, `/code`, `/retro` skills all ended the same way: build HTML, slot into a numbered `R### / SA### / CO### / RETRO-###` JSON file under `dev/<type>/`, hope the viewer picks it up. That filesystem write-path is gone — `dev_reports` is the source of truth — so the skills collapse into one umbrella with shared transport.

## Flags

| Flag | Type | What it does | ID prefix |
|------|------|--------------|-----------|
| `-r <url> "<topic>"` | research | Spawn the research agent, crawl + compile a structured paper | `RES###` |
| `-b` | research | Full 7-dimension codebase quality audit (research-paper style) | `RES###` |
| `-s` | security | Full codebase security audit (OWASP + Trust-No-One bar) | `SEC###` |
| `-c [<file>]` | code | Single-file import/dependency trace + boundary-violation check | `COD###` |
| `-retro [--auto-loop]` | retro | Honest retrospective: 5 Whys + reversal + ledger sync | `RET###` |
| `-p` | plan | Offline implementation plan from chat + repo context; proposes stories; on confirm, hands off to `<scope> -a` | `PLA###` |

No flag → list available flags and stop. Unknown flag → list available flags and stop. **Never** pick a default.

## Common pipeline (every flag)

Every flag does the same three things at the end:

1. **Build the HTML body** — the article content, including any `<h2 id="...">` and `<h3 id="...">` anchors the panel's scroll-spy will use to build the TOC. The Dev → Reporting panel rebuilds the TOC client-side from the actual headings in the body — you do NOT need to bake in a `<aside class="dui-toc">` sidebar. Just emit clean section headings.
2. **Compute the next ID for the report type** by calling the list endpoint and reading the max `id` matching the prefix. Increment, zero-pad to 3 digits (`RES057` → `RES058`).
3. **POST to the backend** at `POST /_site/admin/dev/reporting/` with the upsert payload:
   ```json
   {
     "id": "<PREFIX>###",
     "type": "research|security|code|retro",
     "title": "...",
     "category": "...",
     "topic": "...",
     "summary": "<one-sentence verdict>",
     "content": "<HTML body>",
     "report_date": "YYYY-MM-DD",
     "payload": { /* optional structured sidecar */ }
   }
   ```

### How to call the endpoint

The backend handler is at `/_site/admin/dev/reporting/`. Use the dev API key from `backend/.env.dev` (`DEV_API_KEY`) as a Bearer token — no browser session needed:

```bash
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)

# Compute next ID
curl -s -H "Authorization: Bearer $KEY" \
  "http://localhost:5100/_site/admin/dev/reporting/?type=research" \
  | python3 -c 'import sys,json; rs=json.load(sys.stdin)["reports"]; nums=[int(r["id"][3:]) for r in rs if r["id"].startswith("RES")]; print(f"RES{max(nums+[0])+1:03d}")'

# Upsert the report
curl -s -X POST -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  --data @/tmp/report.json \
  "http://localhost:5100/_site/admin/dev/reporting/"
```

The Write tool is fine for staging the JSON to `/tmp/report.json` before the POST. Do NOT write to `dev/research/`, `dev/security-audits/`, `dev/code/`, or `dev/retros/` — those directories are legacy and no longer read.

---

## Section templates (consistency contract)

Every report follows a per-type **section template**: a fixed ordered list of required `<h2 id>` sections that MUST appear in every report of that type, plus a final **Change Log** section. Beyond the required sections, the audit has **free rein** to add additional `<h2>` sections and any number of `<h3>` sub-headings — but the required ones must be present, in order, with the canonical id slug.

The Dev → Reporting panel rebuilds the TOC from the actual headings in the stored content, so two reports of the same type read with the same TOC skeleton, in the same order. This is what makes the page browsable at scale.

### Template by type

| Flag | Required sections (in order) | Canonical id slugs |
|------|------------------------------|---------------------|
| `-r` research | Synopsis, Scope, Findings, References, Change Log | `synopsis`, `scope`, `findings`, `references`, `change-log` |
| `-b` codebase | Synopsis, Methodology, Findings by Dimension, Cross-Cutting Observations, Case Studies, Recommendations, Conclusion, Appendix, Change Log | `synopsis`, `methodology`, `findings-by-dimension`, `cross-cutting-observations`, `case-studies`, `recommendations`, `conclusion`, `appendix`, `change-log` |
| `-s` security | Synopsis, Executive Summary, Findings Table, Remediation Priorities, Passed Checks, Change Log | `synopsis`, `executive-summary`, `findings-table`, `remediation-priorities`, `passed-checks`, `change-log` |
| `-c` code | Synopsis, Entry File Layer, Direct Imports, First-Order Neighbours, Violations, Warnings, Conclusion, Change Log | `synopsis`, `entry-file-layer`, `direct-imports`, `first-order-neighbours`, `violations`, `warnings`, `conclusion`, `change-log` |
| `-retro` retro | Synopsis, Signals, Root Cause Table, What Went Well, Ledger Update, Tech-Debt Promotions, CLAUDE.md Proposals, Change Log | `synopsis`, `signals`, `root-cause-table`, `what-went-well`, `ledger-update`, `tech-debt-promotions`, `claudemd-proposals`, `change-log` |
| `-p` plan | Synopsis, Problem, Approach, Areas Impacted, Implementation Steps, Proposed Stories, Risks, Verification, Change Log | `synopsis`, `problem`, `approach`, `areas-impacted`, `implementation-steps`, `proposed-stories`, `risks`, `verification`, `change-log` |

### Synopsis section (every type)

**Synopsis** is a 2–4 sentence executive overview. Tone: matter-of-fact, evidence-based. Always answer:
1. What was audited / researched / traced.
2. The headline verdict.
3. The single most important takeaway.

Put it FIRST. It's what the user reads when they click into a row — the rest of the report justifies it.

### Change Log section (every type)

**Change Log** is an `<h2 id="change-log">` section at the bottom of every report. On the **first** write of a report id, emit:

```html
<h2 id="change-log">Change Log</h2>
<ul>
  <li><strong>YYYY-MM-DD</strong> — Initial report.</li>
</ul>
```

On every **re-run / upsert** of an existing id (i.e. when you're regenerating a report rather than creating a new one), append a new `<li>` ABOVE the previous entries — newest first:

```html
<h2 id="change-log">Change Log</h2>
<ul>
  <li><strong>YYYY-MM-DD</strong> — <short description of what changed in this regeneration></li>
  <li><strong>2026-05-21</strong> — Initial report.</li>
</ul>
```

The dev API key flow lets you GET the existing report first (`GET /_site/admin/dev/reporting/<id>`), parse the existing Change Log, prepend the new entry, and POST the merged content back. The Upsert path replaces the whole row, so the panel always shows the freshest version.

### Free rein

Between required sections — and INSIDE each required section — the audit may add:
- Additional `<h2>` sections (e.g. an `<h2 id="appendix-b">Appendix B</h2>` next to the canonical `appendix`)
- Any number of `<h3>` sub-headings (these nest under their parent `<h2>` in the panel's TOC)
- Tables, lists, code blocks, callouts

The required-section contract is a **minimum**, not a maximum. The point is that every research report you open has a "Findings" section, every retro has a "Root Cause Table", every dependency trace has a "Violations" section — predictable structure, browseable at scale.

### Validation discipline

After building the HTML body, the agent SHOULD self-check before the POST:

```
- For each required section in the type's template:
    grep '<h2 id="<slug>">' in the rendered HTML — exactly 1 match.
- Confirm Change Log is the LAST <h2 id="change-log"> in the body.
- Confirm Synopsis is the FIRST <h2 id="synopsis"> in the body.
```

If any required section is missing, add an empty stub (`<h2 id="X">X</h2><p><em>Not applicable for this run.</em></p>`) rather than skip — the TOC consistency contract is non-negotiable.

---

## `-r` — Research (web crawl + paper)

### Arguments

```
<report> -r <url> "<topic text>" [--output path]
```

- `<url>` — seed URL the agent crawls.
- `<topic text>` — what to investigate (free-form, quoted if it has spaces).
- `--output path` — optional: also save the raw markdown to a file (e.g. for inclusion in a PR description).

### Behaviour

1. Parse the URL + topic.
2. Spawn the research agent via the `Agent` tool with `subagent_type: general-purpose`. Brief it to crawl the seed URL, follow same-domain links 2 hops deep, search the web for adjacent context, and emit a markdown report matching the **research template** (see § Section templates).
3. Convert the agent's markdown report to HTML — `##` → `<h2 id="slug">`, `###` → `<h3 id="slug">` (slug = lowercase-hyphenated heading text), tables → `<table>`, lists preserved.
4. POST with `type: "research"`, `category` from the agent's domain (e.g. "Architecture", "API design"), `topic` = the seed URL, `summary` = the Synopsis text.

### Output format (markdown)

Sections in this exact order, matching the research template:

```
## Synopsis          id="synopsis"   (2–4 sentences: what was researched + headline finding + top takeaway)
## Scope             id="scope"      (what's in scope of the paper, what's out, methodology used)
## Findings          id="findings"   (the body of the research — sub-divide with <h3> as needed)
## References        id="references" (every URL crawled or cited, with one-line context)
## Change Log        id="change-log" (newest first; auto-appended on regeneration)
```

The audit has free rein to insert additional `<h2>` sections between Findings and References (e.g. "Vector Applicability", "Patterns Observed", "Open Questions"), and any number of `<h3>` sub-headings within Findings.

### Examples

```
<report> -r https://docs.docker.com/engine/api/ "Docker Engine API v1.47 capabilities"
<report> -r "https://vitejs.dev" "Vite 6 new features"
```

---

## `-b` — Codebase audit (full 7-dimension review)

### Arguments

```
<report> -b
```

No arguments — the audit runs against the whole repo.

### Behaviour

Spawn a sub-agent (preferred — keeps main context lean) with the AUDIT PROMPT below. Use `subagent_type: general-purpose`. Skip these dirs always: `node_modules/`, `.next/`, `.claude/worktrees/`, `cgl-volatile-do-not-commit/`, `dist/`, `build/`, `out/`, `.git/`. Skip `*.min.js`, `*.map`, `*.lock` (note as skipped in the appendix).

#### AUDIT PROMPT (verbatim — substitute nothing)

You are an expert software engineer and code quality analyst. Your task is to perform a **deep-dive review of the entire codebase** and produce a **research-paper-style report**.

**Scope of review.** Evaluate every relevant file against 7 axes:

1. **Coding Standards** — consistency, naming conventions, formatting, linting, idioms.
2. **Cleanliness** — dead code, duplication, commented-out blocks, overly long functions, magic numbers/strings.
3. **Approach** — architectural choices, design patterns, separation of concerns, modularity, error handling.
4. **Ease of Understanding** — readability, meaningful naming, comments where needed, docs, logical flow.
5. **Ease of Management** — add/remove features, config management, dependency management, env setup, build/deploy.
6. **Ease of Future-Proofing** — abstraction levels, coupling, brittle APIs, test coverage, adaptability.
7. **Ease of Maintenance** — testability, logging, debugging, error traceability, CI/CD, time-to-fix for a new dev.

**Required investigation actions.** Scan all dirs (not just `app/` or `backend/`). Identify recurring anti-patterns AND exemplary patterns. Mentally simulate linting + common security/perf pitfalls. Cross-reference docs vs implementation. Review `package.json` / `go.mod` for bloat. Assess test coverage + quality.

**Output report format** — markdown with EXACTLY these `##` sections in this order. Each becomes an `<h2 id>` anchor in the final HTML using the canonical slug from the type's section template (see § Section templates above):

```
## Synopsis                    id="synopsis"   (2–4 sentences: what was audited, headline verdict, top takeaway)
## Methodology                 id="methodology"   (review process, scope limits)
## Findings by Dimension       id="findings-by-dimension"
   For each of the 7 axes:  Rating (Excellent/Good/Fair/Poor/Critical), Evidence (file:line), Analysis.
## Cross-Cutting Observations  id="cross-cutting-observations"
   Duplication & Reusability · Documentation · Testing · Error Handling · Security.
## Case Studies                id="case-studies"
   Pick 3 specific files/modules (simple, moderate, complex) — forensic mini-review each.
## Recommendations             id="recommendations"
   Prioritised by impact vs effort:
     - Critical fixes (must fix before further development)
     - Structural improvements (refactoring)
     - Housekeeping (linting, formatting)
     - Process changes (review checklists, docs)
## Conclusion                  id="conclusion"
   Overall health verdict + estimated time to remediate + confidence (High/Medium/Low).
## Appendix                    id="appendix"
   A. Files reviewed (top-level listing)
   B. Suspected issues table (file, line, issue, severity)
   C. Suggested metrics
## Change Log                  id="change-log"   (newest first; auto-appended on regeneration — see § Section templates)
```

**Tone** — objective, evidence-based, every claim cites file:line. Constructively critical.

### After the audit

Convert markdown → HTML (`##` → `<h2 id>`, `###` → `<h3 id>`, tables / lists / bold / code preserved). POST with:

```
type:     "research"   (codebase audit lives in the research bucket)
category: "Codebase Audit"
topic:    "Full-codebase quality audit against 7 dimensions"
summary:  one-sentence health verdict
```

---

## `-s` — Security audit

### Arguments

```
<report> -s
```

No arguments — runs against the whole codebase.

### Behaviour

Same pattern as `-b`: spawn a sub-agent with the AUDIT PROMPT below. Skip the same dirs (`node_modules`, `.next`, etc.). Assume production deployment context (defence + finance bar per `context/USER.md`).

#### AUDIT PROMPT (verbatim)

You are an expert security & code quality auditor. Perform a complete audit of this entire codebase. For each finding state: **FILE**, **LINE** (if applicable), **SEVERITY** (Critical / High / Medium / Low), **RECOMMENDATION**.

### 1. Data & user security
- Hardcoded secrets, API keys, tokens, passwords, credentials.
- PII exposure (email, phone, SSN, address, IP, device IDs) in logs / URLs / error messages.
- SQL / NoSQL / GraphQL injection.
- XSS (unsanitised output to DOM / HTML templates).
- CSRF (missing tokens on state-changing requests).
- Insecure deserialisation (`eval`, `pickle.loads`, `JSON.parse` on untrusted data without validation).
- Missing HTTPS enforcement, HSTS, secure cookie flags.
- IDOR (user can access another user's resource by ID swap).
- Missing rate limiting on auth / password reset / API endpoints.
- Overly permissive CORS (`*` with credentials).

### 2. Permission granting & access control
- Map all RBAC/ABAC logic. Flag endpoints / functions without permission checks.
- Privilege escalation paths.
- Broken function-level authorisation (missing middleware).
- JWT / OAuth / session validation: signature, expiry, audience, issuer.
- Default / fallback permissions broader than intended.
- Client-side permission checks that can be bypassed (UI hides but API doesn't).
- Public access to internal admin / debug / backup endpoints.

### 3. Data storage
- Plaintext passwords, credit cards, government IDs (must use bcrypt / Argon2 / PBKDF2).
- Unencrypted sensitive data at rest (PII, tokens, secrets) in DB / local storage / files.
- Missing / weak encryption on backups, logs, caches.
- Database connection strings using elevated credentials.
- Logging of sensitive data (passwords, tokens, session IDs, payment info).
- Insecure file uploads (no type / size validation, web-accessible without auth).
- Missing TTL / expiration on temp files, sessions, cached sensitive data.

### 4. Code quality
- Error handling that leaks stack traces / DB errors / system details.
- Dead code, commented secrets, debug endpoints left in production.
- Unsafe functions (`eval`, `exec`, `system`, `child_process` with user input, `Function()` constructor).
- Race conditions (check-then-act without locks).
- Missing input validation on public APIs.
- Improper crypto (homebrew, ECB, static IV, non-constant-time comparison).
- Outdated deps with known CVEs.

### 5. Additional guidelines
- OWASP Top 10 compliance gaps.
- GDPR / CCPA: user data deletion, consent logging, data portability.
- Missing audit logs for auth, permission changes, data exports.
- Insecure defaults (default admin creds, debug mode on, verbose errors).
- Missing security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).

### Output format (markdown)

Sections in this exact order, matching the security template (see § Section templates):

```
## Synopsis                id="synopsis"  (2–4 sentences: posture verdict, top risk, recommended action)
## Executive Summary       id="executive-summary"  (top 5 highest-risk findings, longer detail)
## Findings Table          id="findings-table"  (File | Line | Severity | Category | Finding | Recommendation)
## Remediation Priorities  id="remediation-priorities"  (ordered by risk + effort)
## Passed Checks           id="passed-checks"  (categories correctly implemented)
## Change Log              id="change-log"   (newest first; auto-appended on regeneration)
```

### After the audit

Convert markdown → HTML, then POST with:

```
type:     "security"
category: "Security"
topic:    "Full codebase security audit"
summary:  one-sentence overall posture verdict
```

Severity words inline get a class: wrap `Critical` in `<span class="dui-sev dui-sev--critical">`, `High` in `dui-sev--high`, `Medium` in `dui-sev--medium`, `Low` in `dui-sev--low`.

---

## `-c [<file>]` — Code dependency trace

### Arguments

```
<report> -c              # uses IDE selection / chat-attached file
<report> -c <path>       # explicit path (absolute or repo-relative)
```

Resolve the entry file in this order:
1. `ide_selection` tag or chat attachment
2. `<path>` argument
3. Ask the user — STOP, don't guess

### Behaviour

Spawn a sub-agent with the TRACE BRIEF below. Substitute `{{ENTRY_FILE}}` with the absolute path. Use `subagent_type: general-purpose` (or `Explore` for pure search). Keep depth at 1 — entry file + first-order neighbours only.

#### TRACE BRIEF (verbatim — substitute `{{ENTRY_FILE}}`)

You are auditing the dependency graph of a single source file in the Vector repo.

**Entry file:** `{{ENTRY_FILE}}`

Your job:

1. **Open the entry file.** List every `import` / `require` / `from` / Go `import (` declaration. For each, capture the imported path AND classify it:
   - **same-layer** sibling (same directory or peer)
   - **upstream** (allowed to import — a primitive / util / lower layer)
   - **downstream** (entry file should NOT be importing — page importing layout, infra importing domain)
   - **cross-boundary** (jumps an architectural seam — backend imported from frontend)

2. **Infer the entry file's architectural layer** from its path. Conventions visible in this repo (don't invent new ones — if path doesn't match, say so):

   **Frontend layering (`app/`):**
   - `app/(user)/**/page.tsx` — pages (top of stack)
   - `app/components/` — primitives / shared UI
   - `app/lib/` — client libraries, API clients, helpers
   - `app/contexts/` — React contexts
   - `app/hooks/` — hooks
   - `app/redesign/` — parallel shell (see `docs/c_c_transport_segregation.md`)
   - **Direction rule:** pages may import components / lib / contexts / hooks. Components may import lib. Lib MUST NOT import components or contexts (god-object risk — see `app/lib/apiSite/index.ts`). Contexts must not import pages. Anything in `app/` MUST NOT import from `backend/`.

   **Backend layering (`backend/internal/`):**
   - `<pkg>/handler.go` — HTTP only; calls service; no SQL, no business logic.
   - `<pkg>/service.go` — transactions, crypto, audit; calls sql.go; no HTTP.
   - `<pkg>/sql.go` — SQL constants only; no business logic.
   - **Direction rule:** handler → service → sql. Services may call other services via interfaces. Handlers must not import other handlers. SQL files must not import non-SQL files. No frontend imports.

   **Cross-stack:** `app/` (frontend) and `backend/` (Go) MUST NEVER import each other. Seam is HTTP via `app/lib/apiSite/` and `app/lib/api.ts`.

   **Transport segregation (PLA-0039):** `/_site` and `/samantha/v2` have separate DTOs. Cross-imports are violations. See `docs/c_c_transport_segregation.md`.

   **DB pool routing:** Three pools: `pool` (mmff_vector), `vaPool` (vector_artefacts), `libPools` (mmff_library). Per `docs/c_c_db_routing.md`. A service holding one pool must not call SQL against another DB's tables without going through the owning service.

3. **For each import, classify as:**
   - `ok` — direction correct or same-layer
   - `warn` — same-direction but unusual (deep relative paths, parallel feature module)
   - `violation` — crosses an architectural seam wrong way (cite the rule)

4. **Walk one level deep** into each project-local import — entry file's first-order graph plus immediate children only. Do NOT walk further. Do NOT walk into `node_modules`, `.next`, `dist`, std-lib.

5. **Output a markdown report** — sections in this exact order, matching the code template (see § Section templates):

```
## Synopsis              id="synopsis"  (2–4 sentences: entry file + layer + verdict)
## Entry File Layer      id="entry-file-layer"  (inferred layer + applicable rule set)
## Direct Imports        id="direct-imports"
| path | layer | direction | classification | rule cited |

## First-Order Neighbours  id="first-order-neighbours"
<per direct import that's project-local: same table for ITS imports>

## Violations            id="violations"
<bullet list: file:line, statement verbatim, rule broken, suggested fix>

## Warnings              id="warnings"
<bullet list: file:line, statement, why it's worth a second look>

## Conclusion            id="conclusion"
<one line: "Clean" / "N warnings, no violations" / "N violations — fix before merging">

## Change Log            id="change-log"  (newest first; auto-appended on regeneration)
```

6. **Tone:** evidence-based. Every claim cites file + line. Quote import statements verbatim. Don't invent rules.

### After the trace

Convert markdown → HTML. POST with:

```
type:     "code"
category: "Dependency Graph"
topic:    "Single-file import/dependency trace + boundary-violation check for <relative_path>"
title:    "COD-### - Dependency Graph for <basename>"
summary:  one-sentence verdict (e.g. "Clean — 9 imports, 0 violations" / "3 violations — fix before merging")
```

Classification words in the imports table get pills: `violation` → `<span class="dui-pill">violation</span>`, same for `warn` and `ok`.

---

## `-retro [--auto-loop]` — Retrospective

### Arguments

```
<report> -retro                  # user-invoked retro on the most recent segment
<report> -retro --auto-loop      # invoked by loop-detector hook
<report> -retro --scope full     # entire session instead of last segment
<report> -retro --note "<line>"  # one-line note prepended to the retro
```

### Solo-dev mode triage

**Before** running the 7-gate flow, branch by trigger mode:

- **`--auto-loop`** → run the full retro immediately (safety rail; loop detector fired).
- **Manual `<report> -retro` in solo-dev mode** → warn the user this is heavyweight and offer the lightweight alternative:

  ```
  Solo-dev mode is active. A full retro writes RET### to dev_reports, updates the ledger,
  may auto-promote findings to S1 tech debt, and bumps three docs. For a solo session
  that's a lot of paperwork for one observation.

  Lightweight option: append a one-line entry to lessons.md at repo root
  (date + observation + 1-line takeaway). Pick:
    [1] full retro (the original flow below)
    [2] lessons.md one-liner (recommended for solo)
    [3] cancel
  ```

  Wait for the user's pick. `[2]` writes one line to root `lessons.md` and exits. `[1]` proceeds. `[3]` exits.
  If the user passes `--full` explicitly, skip the warning and proceed straight to the gates.

### Gates (the protocol)

Load [`.claude/commands/c_retro.md`](../../commands/c_retro.md) for the full gate spec — this skill is the runner. Summary of the 7 gates:

1. **Collect signals** — toolUse counts, errors, retries, files touched, files re-read, time on task.
2. **Cluster into findings** — one finding per distinct issue or win.
3. **5 Whys + mandatory reversal** — for each finding: forward chain, then reversal ("therefore X is inevitable because Y"). If reversal fails, downgrade to "incomplete analysis", severity capped at 3.
4. **Score on the 1–5 heatmap** — Table 1 findings (5 = red, "this will keep biting us"; 1 = green, "barely worth noting"). Table 2 wins on the same scale (5 = amazing).
5. **Update the recurring-issue ledger** (`dev/retros/LEDGER.json`):
   - Compute fingerprint `<error_class>:<file_or_endpoint>:<symptom_hash>`.
   - If exists: increment hit_count, append hit row, update last_seen, recompute trend (last 3 severities).
   - If new: create entry hit_count=1.
   - If hit_count ≥ 3 AND status != resolved: auto-promote to S1 in `docs/c_tech_debt.md` (idempotent on RET### reference).
6. **Auto-actions on activation** (no gating per user directive 2026-05-04):
   - S1 / S2 candidates → append to `docs/c_tech_debt.md` with RET### reference.
   - CLAUDE.md proposals → write to `dev/retros/RET###.proposed-claudemd.md` (NEVER auto-edit CLAUDE.md). User merges manually.
7. **Persist + bump index** — POST the retro to `dev_reports` with `id: "RET###"`. Update [`docs/c_retro_index.md`](../../../docs/c_retro_index.md).

### Step-8 self-check (mandatory)

Re-read every file the retro touched. Verify: retro JSON parses; every ledger entry referenced contains a RET### back-reference; every tech-debt append references this retro; index counter matches. **FAIL LOUD** on any gap. Roll back partial writes. Only on green: clear `/tmp/.claude-retro-loop-trigger` (if present), report success.

### Heatmap rendering

Heatmap cells render via `.dui-pill--h1` … `.dui-pill--h5` (Table 1) and `.dui-pill--w1` … `.dui-pill--w5` (Table 2) — class translation lives in the panel. The stored content uses `<span class="dui-pill dui-pill--h3">3</span>` style; the panel's stylesheet maps colour from `--h{1..5}` / `--w{1..5}` tokens.

### Output format (HTML body)

Sections in this exact order, matching the retro template (see § Section templates):

```
## Synopsis                id="synopsis"   (2–4 sentences: trigger mode + honest assessment lead-in + top finding)
## Signals                 id="signals"    (toolUse counts, errors, retries, files touched / re-read, time on task, loop_signals if --auto-loop)
## Root Cause Table        id="root-cause-table"   (Table 1 — findings with 5 Whys + reversal + heatmap pills)
## What Went Well          id="what-went-well"     (Table 2 — wins with green pills)
## Ledger Update           id="ledger-update"   (which fingerprints were touched, hit_count deltas, trend recompute)
## Tech-Debt Promotions    id="tech-debt-promotions"   (which findings auto-promoted to S1/S2 with TD entry refs)
## CLAUDE.md Proposals     id="claudemd-proposals"   (link to dev/retros/RET###.proposed-claudemd.md if any)
## Change Log              id="change-log"   (newest first; auto-appended on regeneration)
```

### POST payload

```
type:     "retro"
category: "Retrospective"
topic:    "Last-segment retro"  (or "Full-session retro" if --scope full, or "Loop-detector auto-retro")
title:    "RET-### — <one-line honest assessment>"
summary:  honest_assessment lead-in
payload:  the canonical retro JSON schema (signals, findings_table1, findings_table2, ledger_deltas, tech_debt_appends, proposed_claudemd_path)
content:  HTML body matching the section template above (two tables + 5 Whys chains + ledger summary)
```

### Trigger modes

- **User-invoked** — `<report> -retro` from chat. Honest assessment lead-in = "User invoked".
- **Auto-loop** — Loop detector hook writes `/tmp/.claude-retro-loop-trigger` and injects a `<system-reminder>` via UserPromptSubmit. The system-reminder instructs the agent to invoke `<report> -retro --auto-loop`. The skill detects the sentinel, tags the retro `triggered_by: "loop-detector"`, includes `loop_signals` (the counts from `.claude/hooks/loop-detector.sh`).

See [`.claude/hooks/loop-detector.sh`](../../hooks/loop-detector.sh) for signal logic. Trigger fires when **all** of these hold within a 10-minute sliding window: ≥4 same-tool repeats, no new files read, no user message, same error class on last 3 tool results, no Edit/Write success.

---

## `-p` — Plan (offline implementation plan)

### Arguments

```
<report> -p [<focus phrase>]
```

- `<focus phrase>` — optional free-text framing ("priority customisation chip refactor", "visualiser V3 lasso", etc.). If omitted, the plan synthesises from the current conversation. Used as the report title seed.

### Behaviour — **offline only, no web access**

The `-p` flag is the only `<report>` flag that does NOT use the internet. It draws exclusively from:

- The current conversation (decisions, files touched, problem statement).
- The local repository (`Read`, `Grep`, `Glob` over the working tree).
- `Vector_Scope.md`, `docs/c_*.md`, and other on-disk context.

**Do not call `WebFetch` or `WebSearch` from this flag.** If the user wants external research folded into a plan, route them to `<report> -r` first, then `<report> -p` with the research RES### in mind.

### Pipeline

1. **Parse focus.** Pull the focus phrase (or, if omitted, ask one clarifying question to confirm the planning target — never guess from a long conversation that touched many topics).

2. **Gather context.**
   - `git status` + `git log -10 --oneline` for recent activity.
   - `Read` the files that have been touched / referenced this session.
   - `Grep` for related concepts in `Vector_Scope.md`, `docs/`, and the relevant `app/` or `backend/` area.
   - `Read` related existing plans on the Plan tab (GET `/_site/admin/dev/reporting/?type=plan`) to avoid duplication and inherit terminology.

3. **Draft the plan** to match the **plan template** (Synopsis · Problem · Approach · Areas Impacted · Implementation Steps · Proposed Stories · Risks · Verification · Change Log). Each section:

   - **Synopsis** — 2–4 sentences. What this plan ships, the headline approach, the one most important thing to know.
   - **Problem** — the user-facing or technical problem this exists to solve. Cite the conversation framing if it came from chat ("Per the 2026-05-DD framing: *'<quote>'*"). Cite the prior plan or scope entry if it came from there.
   - **Approach** — the chosen approach in 1–2 paragraphs. Trade-offs considered. Why this approach, not the obvious alternatives.
   - **Areas Impacted** — `<ul>` of "DB:", "Backend:", "Frontend:", "Docs:", etc. — one bullet per surface that needs change. Same shape as the existing plans (see PLA-0055).
   - **Implementation Steps** — `<ol>` ordered list, each step a discrete unit of work. Phase headers ("Phase 0 — Schema", "Phase 1 — Backend", etc.) where the work splits naturally. Each step should be small enough to become one story.
   - **Proposed Stories** — `<ol>` of story drafts derived from the implementation steps. Each story has a title PLUS a multi-bullet acceptance-criteria list — not a single AC line. Structure each `<li>`:
     - **Title** in `<strong>` — imperative, specific noun + verb.
     - One short sentence of intent (the "what" — one line max).
     - **AC** as a nested `<ul>` of **3–6 observable assertions**. Each AC bullet is one independently verifiable claim — a thing a reviewer or test can mark green or red on its own. Cover the axes that apply to that story: schema/migration outcome, route/handler contract, wire payload shape, frontend state change, test name added, doc updated, lint/build status. AC is observable, not aspirational ("returns 403", "row exists", "grep finds 0 occurrences", "test `TestX_Foo` passes") — never "works correctly" or "is secure".
     - **Theme** — suggested theme ref in `Vector_Scope.md` if obvious (e.g. `B16.9`); leave blank if not.

     HTML shape (one story):
     ```html
     <li>
       <strong>Add <code>api_keys.manage</code> permission to DB catalogue.</strong>
       One short sentence of intent.
       <ul>
         <li><strong>AC:</strong> migration <code>NNN_*.sql</code> applies clean against <code>mmff_vector</code>.</li>
         <li><strong>AC:</strong> row exists in <code>permissions</code> with the new code.</li>
         <li><strong>AC:</strong> <code>roles_permissions</code> rows grant the code to <code>grp_global</code> + <code>grp_portfolio</code>.</li>
         <li><strong>AC:</strong> <code>VerifyParity</code> returns nil at server boot.</li>
         <li><strong>Theme:</strong> B16 Security &amp; Auth</li>
       </ul>
     </li>
     ```

     The list must remain parseable for the `<scope> -a` hand-off: the title is the story line, the nested AC bullets are preserved verbatim and passed through (see step 7 below).
   - **Risks** — known risks, dependencies, and "things we're choosing to not fix in this plan" — explicit out-of-scope statements. Defence/finance buyer narrative: name the compensating control where a risk exists.
   - **Verification** — how to know this plan's work is done. Test surface to run, manual click-paths, what `/dev/*` page changes, what migrations apply.
   - **Change Log** — standard pattern: first write = "Initial plan." On regeneration, prepend new entry.

4. **Compute the next PLA ID** by querying `dev_reports` directly (not the file series — Plan tab reads from DB):

   ```bash
   KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
   curl -s -H "Authorization: Bearer $KEY" \
     "http://localhost:5100/_site/admin/dev/reporting/?type=plan" \
     | python3 -c 'import sys,json
   rs=json.load(sys.stdin)["reports"]
   nums=[int(r["id"][3:]) for r in rs if r["id"].startswith("PLA") and r["id"][3:].isdigit()]
   print(f"PLA{max(nums+[0])+1:03d}")'
   ```

   Note the prefix is `PLA###` (3-digit, no hyphen) in `dev_reports` — matches the schema comment's `PLA###` convention and the existing 47 rows (top is `PLA055`). This is **different** from the legacy `dev/plans/PLA-NNNN.json` archaeology (4-digit hyphenated), which is frozen and not extended.

5. **POST the plan** to `/_site/admin/dev/reporting/` with:
   ```json
   {
     "id": "PLA###",
     "type": "plan",
     "title": "<focus phrase, sentence-cased>",
     "category": "<area, e.g. 'Frontend · Visualiser', 'Backend · Auth'>",
     "topic": "<one-line framing>",
     "summary": "<Synopsis text>",
     "content": "<HTML body matching the section template>",
     "report_date": "YYYY-MM-DD"
   }
   ```

6. **Tell the user**:
   - "Plan filed as PLA###. View on /dev/reporting → Plan tab."
   - Show the Proposed Stories list inline in chat (extracted from the report body), each numbered, with **every AC bullet rendered as a nested list under the story title** — do not collapse them to a single line. The user is approving the AC set, not just the titles.
   - **Ask: "OK to add these N stories (with their AC) to `Vector_Scope.md`?"** Wait for explicit yes / no / edit instruction.

7. **On `yes` → hand off to `<scope> -a`**:
   - Pass the proposed stories as the `[message]` argument to `<scope> -a`, formatted as a numbered list where **each story is followed by its AC bullets indented underneath** (markdown convention: `   - AC: …` under a `1. **Title.**` parent). The AC bullets MUST survive the hand-off — they are what makes the scope entry verifiable, not decorative chrome.
   - `<scope> -a` will then run its own protocol (find theme, check duplicates, set priority, write, update `.claude/scope-refs.map`). When the scope skill writes the entry into `Vector_Scope.md`, the AC bullets nest under the story line as a sub-list so each AC is independently checkable.
   - Report which refs were created and which were flagged as duplicates.

8. **On `no` or edits requested**:
   - Don't touch `Vector_Scope.md`.
   - The plan still exists on /dev/reporting (it's already POSTed by step 5) — user can revisit it or edit it later.
   - If user edits the stories list, do NOT re-POST the plan; the plan is the planning artefact, the stories are the next step. Just call `<scope> -a` with the edited list.

### Hard rules

- **Never auto-call `<stories>`** — that skill writes to `Vector_Scope.md` directly without confirmation in solo-dev mode. `<report> -p` always routes through `<scope> -a` for the explicit confirmation gate.
- **Never call `<scope> -a` without explicit user OK** — the confirmation step (7) is the gate. Auto mode does NOT bypass it; user must say yes.
- **No new `dev/plans/PLA-NNNN.json` files.** That series is frozen at `PLA-0055` per `docs/c_plan_index.md`. All new plans land in `dev_reports` with `type='plan'` and the `PLA###` (3-digit) prefix.
- **Offline only.** No `WebFetch`, no `WebSearch` inside this flag. If the plan needs external context, ask the user to feed it in or run `<report> -r` first.

### Idempotency

Re-running `<report> -p` on the same focus phrase **creates a new PLA###** — plans are point-in-time artefacts. To revise an existing plan, the user GETs the existing PLA### from /dev/reporting, hands the ID to the agent ("update PLA047 with X"), and the agent POSTs the same ID with prepended Change Log entry.

### Example exchange

```
User: <report> -p priority customisation chip refactor

Agent: [drafts plan, computes next id = PLA056, POSTs]
       Plan filed as PLA056. View on /dev/reporting → Plan tab (47 → 48 rows).

       Proposed stories (3 shown for brevity — full list has 8):

       1. **Add artefact_priorities table per workspace.** New per-workspace catalogue
          replaces the hardcoded PRIORITY_CHIP_OPTIONS literal.
          - AC: migration NNN_artefact_priorities.sql applies clean against vector_artefacts.
          - AC: table exists with columns (id uuid PK, workspace_id uuid FK, code text, label text, sort int).
          - AC: seed inserts 4 rows per existing workspace (low/medium/high/critical).
          - AC: unique constraint on (workspace_id, code).
          - AC: schema_migrations row exists for NNN after apply.
          - Theme: F1 Artefact Type Customisation

       2. **Migrate artefacts.priority text → priority_id UUID FK.**
          - AC: migration adds priority_id column with FK to artefact_priorities(id).
          - AC: backfill maps existing text values by name match per workspace.
          - AC: post-backfill check returns 0 rows where priority IS NOT NULL AND priority_id IS NULL.
          - AC: old priority text column dropped in same migration.
          - AC: artefactitems service compiles against new column.
          - Theme: F1 Artefact Type Customisation

       3. **Priorities CRUD endpoints GET/POST/PATCH/DELETE.**
          - AC: routes mounted under /_site/workspaces/{wsId}/priorities.
          - AC: padmin can list (200 + array), create (201 + row), update (200), archive (204).
          - AC: non-padmin role returns 403 on POST/PATCH/DELETE.
          - AC: handler_test.go covers allow + deny matrix.
          - AC: openapi siteAPI.yaml entry exists for each verb.
          - Theme: F1 Artefact Type Customisation

       OK to add these 8 stories (with their AC) to Vector_Scope.md?

User: yes

Agent: [calls <scope> -a with the formatted multi-AC list]
       Added 8 stories under theme F1 Artefact Type Customisation:
       - F1.X.1 through F1.X.8 created, all P2, all 🔵 IN FLIGHT.
       - Each entry has its full AC sub-list intact in Vector_Scope.md.
       - 0 duplicates found.
       - scope-refs.map updated.
```

---

## Notes

- **Old skill dirs are retired** — `<research>`, `<codebase>`, `<sec>`, `<code>`, `<retro>`, `<plan>` are gone. Any chat that types those will get "skill not found"; users should use `<report> -r/-b/-s/-c/-retro/-p` instead.
- **Dev → Reporting is the only viewer.** `dev/research/`, `dev/security-audits/`, `dev/code/`, `dev/retros/` on disk are historical — already imported into `dev_reports` and no longer read by any panel. Leave them alone (don't delete; they're the historical source).
- **Heading discipline.** The Dev → Reporting panel rebuilds the TOC from the `<h1>` / `<h2>` / `<h3>` elements in the stored content. Emit them with sensible `id` attributes (lowercase-hyphenated heading text). The panel auto-injects ids when missing, but explicit ids survive copy-paste better.
- **No file writes to `dev/<type>/` directories.** That filesystem path is decommissioned. All five flags POST to the backend.

$ARGUMENTS
