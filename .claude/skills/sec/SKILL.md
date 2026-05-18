---
name: sec
description: Run a full codebase security audit and save it to dev/security-audits/ as a numbered SA entry viewable in Dev → Security Audits.
argument-hint: (no arguments required)
allowed-tools: Read Grep Glob Bash Write Agent
---

# Security Audit Skill (`<sec>`)

Performs a complete codebase security audit, compiles a structured markdown report, converts it to the HTML+TOC format used by the Dev → Security Audits panel, and saves it as `dev/security-audits/SANNN.json`.

## Behaviour

### Step 1 — Compute next SA ID

Scan `dev/security-audits/` for existing `SA*.json` files and compute the next sequential ID:

```bash
ls dev/security-audits/SA*.json 2>/dev/null | grep -oE 'SA[0-9]+' | sort | tail -1
```

Zero-pad to 3 digits: `SA001`, `SA002`, etc.

### Step 2 — Run the audit

Spawn a sub-agent (or perform inline) with the following exact audit prompt against the entire codebase. Scan recursively. Skip binary/minified files (note them as skipped). Assume production deployment context.

---

## AUDIT PROMPT

You are an expert security & code quality auditor. Perform a complete audit of this entire codebase based on the following directives. For each finding, state: FILE, LINE (if applicable), SEVERITY (Critical/High/Medium/Low), and a RECOMMENDATION.

### 1. DATA & USER SECURITY
- Identify any hardcoded secrets, API keys, tokens, passwords, or credentials.
- Detect exposure of PII (email, phone, SSN, address, IP, device IDs) in logs, URLs, or error messages.
- Find SQL/NoSQL/GraphQL injection vulnerabilities (unsanitized user input in queries).
- Find cross-site scripting (XSS) risks (unsanitized output to DOM or HTML templates).
- Find CSRF vulnerabilities (missing anti-CSRF tokens in state-changing requests).
- Identify insecure deserialization (e.g., `eval()`, `pickle.loads`, `JSON.parse` on untrusted data without validation).
- Find missing or weak HTTPS enforcement, HSTS headers, or secure cookie flags.
- Detect insecure direct object references (IDOR) where user can access another user's resource by changing an ID.
- Find missing rate limiting on authentication, password reset, or API endpoints.
- Identify overly permissive CORS settings (`Access-Control-Allow-Origin: *` with credentials).

### 2. PERMISSION GRANTING & ACCESS CONTROL
- Map all role-based or attribute-based access control (RBAC/ABAC) logic. Identify any endpoint or function that lacks permission checks.
- Find privilege escalation paths (e.g., normal user can call admin-only GraphQL mutations or REST endpoints).
- Detect broken function-level authorization (missing middleware on routes requiring roles).
- Check JWT/OAuth/Session validation: no signature verification, no expiry check, no audience/issuer validation.
- Identify default or fallback permissions that grant broader access than intended.
- Find any client-side permission checks that can be bypassed (UI hiding but API unprotected).
- Locate public access to internal admin panels, debug endpoints, or backup routes.

### 3. DATA STORAGE
- Identify plaintext storage of passwords, credit cards, or government IDs — must use strong hashing + salt (bcrypt, Argon2, PBKDF2).
- Find unencrypted sensitive data at rest (PII, tokens, secrets) in databases, local storage, or files.
- Check for missing or weak encryption of backup files, logs, or caches containing sensitive data.
- Verify that database connection strings use least-privilege credentials (no root/admin for app).
- Detect logging of sensitive data (passwords, tokens, session IDs, payment info).
- Find insecure file uploads (no validation of type/size, stored in web-accessible folder without authentication).
- Identify missing or improper TTL/expiration of temporary files, sessions, or cached sensitive data.

### 4. CODE QUALITY
- Find error handling that leaks stack traces, database errors, or system details to the client.
- Detect dead code, commented secrets, debug endpoints (`/debug`, `/_dev`, `/status`) left in production.
- Identify unsafe functions (e.g., `eval()`, `exec()`, `system()`, `child_process` with user input, `Function()` constructor).
- Locate race conditions (e.g., check-then-act without locks, concurrent file writes).
- Find missing input validation (type, length, range, format) on all public APIs.
- Detect improper cryptography usage (homebrew crypto, ECB mode, static IV, non-constant-time comparison).
- Identify outdated dependencies with known vulnerabilities (if a package.json, go.mod, requirements.txt, or similar exists, list CVEs).
- Check for inconsistent indentation, overly long functions (>50 lines), deep nesting (>4 levels), and lack of tests for security-critical paths.

### 5. ADDITIONAL COMMON GUIDELINES
- OWASP Top 10 (2021/2022) compliance gaps.
- GDPR/CCPA concerns: user data deletion, consent logging, data portability endpoints missing.
- Missing audit logs for authentication, permission changes, and data exports.
- Insecure defaults (e.g., default admin credentials, debug mode on, verbose error responses).
- Missing security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).

### OUTPUT FORMAT

Produce a markdown report with:
1. **Executive Summary** – top 5 highest-risk findings.
2. **Findings Table** – columns: File, Line, Severity, Category, Finding, Recommendation.
3. **Remediation Priorities** – ordered by risk + effort.
4. **Passed Checks** – list of categories that are correctly implemented.

---

### Step 3 — Convert to HTML with TOC

Convert the markdown report to an HTML string using the same `r-toc-layout` structure as research entries:

```html
<div class="r-toc-layout">
  <aside class="r-toc">
    <div class="r-toc__label">Contents</div>
    <ol class="r-toc__list">
      <li><a href="#executive-summary">Executive Summary</a></li>
      <li><a href="#findings-table">Findings Table</a></li>
      <li><a href="#remediation-priorities">Remediation Priorities</a></li>
      <li><a href="#passed-checks">Passed Checks</a></li>
    </ol>
  </aside>
  <div class="r-toc-body">
    <!-- converted markdown content here, h2 tags get id= slugs -->
  </div>
</div>
```

Rules:
- `##` headings → `<h2 id="slug">` where slug is lowercase-hyphenated
- `###` → `<h3>`
- Markdown tables → `<table><thead>…</thead><tbody>…</tbody></table>`
- `**bold**` → `<strong>`
- `` `code` `` → `<code>`
- Lists → `<ul>/<li>` or `<ol>/<li>`
- Paragraphs → `<p>`
- Severity words get a class: wrap `Critical` in `<span class="dui-sev dui-sev--critical">`, `High` in `<span class="dui-sev dui-sev--high">`, `Medium` in `<span class="dui-sev dui-sev--medium">`, `Low` in `<span class="dui-sev dui-sev--low">`

### Step 4 — Write the JSON file

Write `dev/security-audits/SANNN.json`:

```json
{
  "id": "SANNN",
  "title": "Security Audit — <date>",
  "category": "Security",
  "date": "<YYYY-MM-DD>",
  "summary": "<one-sentence summary of the top finding or overall posture>",
  "content": "<html string from step 3>"
}
```

### Step 5 — Confirm

Report to the user:
- The SA ID written
- The file path
- Count of Critical / High / Medium / Low findings
- One-line overall posture verdict

## Notes

- `dev/security-audits/` is parallel to `dev/research/` — same JSON shape, different ID prefix (`SA` not `R`).
- The panel at `/dev/security-audits` reads from `GET /api/dev/security-audits` which serves this directory.
- If `dev/security-audits/` does not exist, create it before writing.
- Never scan `node_modules/`, `.next/`, `.claude/worktrees/`, `cgl-volatile-do-not-commit/` — mark these as skipped.

$ARGUMENTS
