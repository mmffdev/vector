# Backlog

> Lightweight outstanding/done tracking. Operated via the `<backlog>` shortcut — see [`docs/c_backlog.md`](../../docs/c_backlog.md). Each item is one line.

## Outstanding

- 2026-04-25 — Run cleanup transaction to drop the 16 leaked `users-test-*` subscriptions and their full portfolio-stack footprint (~1568 rows). Backup via `<backupsql>` first.
- 2026-04-25 — Delete `phase8b@mmffdev.com` (`bf2abdfb-5eb3-4dc8-b623-2b6566118ed6`) — confirmed not a real account; CASCADE-safe.
- 2026-04-25 — Refactor `mkTenant` (in `backend/internal/users/service_test.go`) to use `BeginTx` + `defer Rollback` (step 3 of cleanup-leak fix). Requires a `DBTX` interface across `users.Service`, `audit.Logger`, `auth.Service`. ~3 prod files + 1 test file.
- 2026-04-25 — Update seed `db/schema/001_init.sql` and `db/schema/002_auth_permissions.sql`: rename `admin@` → `gadmin@`, set password to `myApples100@`, add `padmin@mmffdev.com` (`myApples100@@`) and `user@mmffdev.com` (`myApples100@@@`) inserts. Decide live-DB apply path (new migration vs idempotent UPDATE).
- 2026-04-25 — Relocate shortcut-style `docs/c_*.md` files into `.claude/commands/` per audit table in handoff. Update CLAUDE.md pointers accordingly. Reference docs (schema, security, postgresql, ssh, bash, deployment, page-structure, polymorphic_writes, tech_debt, url-routing, backup-on-push) stay under `docs/`.
- 2026-04-25 — Build migration tool: ordered runner for `db/schema/*.sql` (mmff_vector) and `db/library_schema/*.sql` (mmff_library), tracks applied migrations in a `schema_migrations` table, dry-run mode, rollback hooks. Needed before prod deploy of migrations 020–025 + Phase 3 library schemas.
- 2026-04-25 — PRE-LAUNCH (do last): encrypt-at-rest for ALL sensitive data points before going live. Pattern: AES-GCM ciphertext in `.env.local`, master key file outside repo (`~/.mmff/master.key` dev, `/etc/mmff/master.key` mode 400 in prod, bind-mounted). First sweep: SMTP_PASS, DB_PASSWORD, JWT_*_SECRET, library DB pool passwords, any future API keys. New `internal/secrets` package wraps decryption; callers fetch via `secrets.Get("SMTP_PASS")` instead of `os.Getenv`. Audit `os.Getenv` call sites for sensitivity at the same time.

## Done

(none yet)

---

## Feature Backlog — Owned by Rick (read-only for Claude)

> **STOP.** Everything below this header is owned by Rick. Claude does not surface, prioritise, scope, or act on any item below unless Rick explicitly points at one by name. Treat as roadmap context only. New ideas spawned mid-conversation go to `## Breakout Ideas` below (also read-only).

### VECTOR
- 2026-04-25 — API Framework & Docs, user scripted apps that run in Vector
- 2026-04-25 — Vector Test Cases
- 2026-04-25 — Tooling Integration - User Integrations and Reporting patchways and hooks, Jenkins etc.
- 2026-04-25 — Custom Pages - Microsoft Style Intranet type
- 2026-04-25 — Custom Page Builder, Wordpress Style page designer, Blocks, drag and drop + templates
- 2026-04-25 — Github Integration to User Stories (Work Items)
- 2026-04-25 — Sharing Pages 
- 2026-04-25 — Custom Charts and Graphs
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### ORIGO — Confluence-style Wiki
- 2026-04-25 — Confluence version for vector
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### SIGMA — OKRs
- 2026-04-25 — OKRs system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### FLUX — Design Thinking
- 2026-04-25 — Design Thinking system
- 2026-04-25 — VECTOR tie in 
- 2026-04-25 — ORIGO tie in 
- 2026-04-25 — SIGMA tie in
- 2026-04-25 — FLUX tie in 
- 2026-04-25 — SPINE tie in 

### SPINE — Governance
- 2026-04-25 — Design Thinking
- 2026-04-25 — Vector tie in 
- 2026-04-25 — Sigma tie in 
- 2026-04-25 — Flux tie in 
- 2026-04-25 — Origo tie in 

### All systems
- 2026-04-25 — Paywall - subscription system 
- 2026-04-25 — Accounts segment and biiling for gadmin and new account type [backoffice] boffice@mmffdev.com 
- 2026-04-25 — Governance 
- 2026-04-25 — Language Packs  
- 2026-04-25 — Branding Strategic
- 2026-04-25 — Branding Product Sub Level Ident 

### Breakout Ideas

- 2026-04-25 — Support-ticket reply flow ("Respond above this line") — separate sub-system. Outbound: unique From per thread `support+ticket-12345@vector.xxx` (routing token, lands in shared support@ mailbox). Inbound: mailbox poller parses ticket ID from recipient, strips quoted history at marker, posts body as a comment on ticket #12345. Auth: verify sender email matches a ticket participant, or unauthenticated path with token-in-address — decide before building.