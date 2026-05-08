# Handover — Roles Table Rename Family (Migrations 131–135)

**Date:** 2026-05-08
**Outgoing agent:** Claude Opus 4.7
**Branch:** `main`
**Backend env:** `dev` (pinned — do not change)

---

## TL;DR

Renamed four role-grant tables to cluster under a `roles_*` prefix. `\dt roles*` on dev DB now returns the full catalogue:

```
roles
roles_org_nodes
roles_pages
roles_permissions
roles_workspaces
```

Plus an earlier sibling rename (131): `workspaces` → `master_record_workspaces`.

All five migrations are **applied to dev DB**, **Go SQL strings are swept**, **backend builds clean**, and **hot-path login + permissions resolution is smoke-tested green** (gadmin login → 29 permissions resolved through renamed `roles_permissions`).

**Tech-debt entry [TD-DB-004](docs/c_tech_debt.md) is RESOLVED.**

---

## What was done (in order)

### Migration 131 — `workspaces` → `master_record_workspaces` (already shipped before this session)
Followup catch: [backend/internal/portfoliomodels/adopt.go:479](backend/internal/portfoliomodels/adopt.go#L479) had a missed `FROM workspaces` from the original sweep. Fixed during the audit phase.

### Migration 132 — `workspace_roles` → `roles_workspaces`
Already applied prior to this session continuation. No action needed.

### Migration 133 — `org_node_roles` → `roles_org_nodes`
- Files: [db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql](db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql) + [DOWN](db/schema/down/133_rename_org_node_roles_to_roles_org_nodes_DOWN.sql)
- Renamed: table + 5 indexes (pkey, active_unique, single_admin_mvp, idx_user, idx_node) + 2 check constraints (revoked_pair, role_check) + 1 trigger (trg_..._updated_at)
- Go sweep: 7 replacements
  - [backend/internal/orgdesign/service.go](backend/internal/orgdesign/service.go) — 5
  - [backend/internal/orgdesign/boundary_test.go](backend/internal/orgdesign/boundary_test.go) — 2

### Migration 134 — `page_roles` → `roles_pages`
- Files: [db/schema/134_rename_page_roles_to_roles_pages.sql](db/schema/134_rename_page_roles_to_roles_pages.sql) + [DOWN](db/schema/down/134_rename_page_roles_to_roles_pages_DOWN.sql)
- Renamed: table + pkey + 2 indexes (idx_..._role, idx_..._role_id). No triggers, no checks.
- 51 rows preserved
- Note: dual-column transitional state (`role` enum + `role_id` UUID FK from PLA-0007 G2) unchanged. PK is still `(page_id, role)`.
- Go sweep: 3 replacements
  - [backend/internal/nav/bookmarks.go](backend/internal/nav/bookmarks.go) — 1 (INSERT)
  - [backend/internal/nav/registry.go](backend/internal/nav/registry.go) — 1 (LEFT JOIN)
  - [backend/internal/nav/service.go](backend/internal/nav/service.go) — 1 (JOIN)

### Migration 135 — `role_permissions` → `roles_permissions` (this session's main work)
- Files: [db/schema/135_rename_role_permissions_to_roles_permissions.sql](db/schema/135_rename_role_permissions_to_roles_permissions.sql) + [DOWN](db/schema/down/135_rename_role_permissions_to_roles_permissions_DOWN.sql)
- Renamed: table + pkey + 1 index (idx_..._perm). No triggers, no checks. 3 FKs to users/permissions/roles auto-retargeted by Postgres (FK constraint names stay literal — Postgres only retargets the referenced table).
- 65 rows preserved
- Go sweep: 6 replacements
  - [backend/internal/permissions/resolver.go](backend/internal/permissions/resolver.go) — 1 (HOT PATH — every authenticated request)
  - [backend/internal/roles/service.go](backend/internal/roles/service.go) — 3 (INSERT, DELETE, SELECT)
  - [backend/internal/roles/handler_test.go](backend/internal/roles/handler_test.go) — 1
  - [backend/internal/workspaces/handler_test.go](backend/internal/workspaces/handler_test.go) — 1
- Hot-path smoke: `POST /v1/api/auth/login` (gadmin@mmffdev.com / password) → JWT issued; `GET /v1/api/auth/me` with bearer → 29 permissions populated. Resolver query against renamed table works.

---

## Current state of the working tree

The 4 new migration UP files are **untracked**. Their DOWN counterparts live under `db/schema/down/` and were also created in this session (pattern matches 132's existing DOWN file).

41 modified files in the working tree — most are from prior session work (PLA-0026 portfolio-model cutover, PLA-0027 sprints, etc.). The renamer-specific changes are:

**Modified by migration sweeps (133/134/135):**
- `backend/internal/nav/bookmarks.go` (134)
- `backend/internal/nav/registry.go` (134)
- `backend/internal/nav/service.go` (134)
- `backend/internal/orgdesign/boundary_test.go` (133)
- `backend/internal/orgdesign/service.go` (133)
- `backend/internal/permissions/resolver.go` (135)
- `backend/internal/roles/handler_test.go` (135)
- `backend/internal/roles/service.go` (135)
- `backend/internal/workspaces/handler_test.go` (135)

**Modified by audit catch (131 followup):**
- `backend/internal/portfoliomodels/adopt.go` line 479 — `FROM workspaces` → `FROM master_record_workspaces`

**Updated docs:**
- `docs/c_tech_debt.md` — TD-DB-003 narrowed; TD-DB-004 added then closed as RESOLVED

**Untracked (new files):**
- `db/schema/132_rename_workspace_roles_to_roles_workspaces.sql` (and DOWN)
- `db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql` (and DOWN)
- `db/schema/134_rename_page_roles_to_roles_pages.sql` (and DOWN)
- `db/schema/135_rename_role_permissions_to_roles_permissions.sql` (and DOWN)

---

## What the next agent needs to do

### 1. Decide commit strategy

The working tree mixes renamer changes with unrelated PLA-0026/PLA-0027 work. **Recommended:** isolate the renamer commit to keep history clean. Suggested commit:

```
feat(db): cluster role-grant tables under roles_* prefix (migrations 132–135)

- 132: workspace_roles -> roles_workspaces
- 133: org_node_roles  -> roles_org_nodes
- 134: page_roles      -> roles_pages
- 135: role_permissions-> roles_permissions

Plus audit fix: missed `FROM workspaces` in portfoliomodels/adopt.go (M131 followup).

`\dt roles*` now returns the complete catalogue: roles, roles_org_nodes,
roles_pages, roles_permissions, roles_workspaces. Smoke-tested via gadmin
login -> 29 permissions resolved through renamed roles_permissions.

Closes TD-DB-004.
```

Files to stage for this commit:
```bash
git add db/schema/132_rename_workspace_roles_to_roles_workspaces.sql \
        db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql \
        db/schema/134_rename_page_roles_to_roles_pages.sql \
        db/schema/135_rename_role_permissions_to_roles_permissions.sql \
        db/schema/down/132_*.sql db/schema/down/133_*.sql \
        db/schema/down/134_*.sql db/schema/down/135_*.sql \
        backend/internal/nav/bookmarks.go \
        backend/internal/nav/registry.go \
        backend/internal/nav/service.go \
        backend/internal/orgdesign/boundary_test.go \
        backend/internal/orgdesign/service.go \
        backend/internal/permissions/resolver.go \
        backend/internal/roles/handler_test.go \
        backend/internal/roles/service.go \
        backend/internal/workspaces/handler_test.go \
        backend/internal/portfoliomodels/adopt.go \
        docs/c_tech_debt.md
```

(Verify the 132 DOWN file actually exists — if 132 was applied before this session, its DOWN may already be tracked or already committed. Run `git ls-files db/schema/down/132_*` to check.)

### 2. Push to remote

```bash
git push origin main
```

### 3. Verify on a fresh DB

For any teammate pulling `main`, the migrations should apply cleanly to a freshly seeded mmff_vector DB. The migration runner picks them up by filename order (131 → 132 → 133 → 134 → 135).

### 4. Things NOT to do

- **Do not switch backend env.** It is pinned to `dev`. The HARD RULE in [.claude/CLAUDE.md](.claude/CLAUDE.md) is explicit.
- **Do not modify human accounts.** `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `user@mmffdev.com` all use `password` — that is their fixed state. Create new test accounts if needed.
- **Do not run destructive git commands** without confirming. No `reset --hard`, no `push --force`, no `branch -D`, etc.

---

## Verification commands (for the next agent)

```bash
# 1. Confirm dev DB has all 5 roles_* tables
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi PGGSSENCMODE=disable \
  /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "\dt roles*"

# Expected:
#   public | roles              | table | mmff_dev
#   public | roles_org_nodes    | table | mmff_dev
#   public | roles_pages        | table | mmff_dev
#   public | roles_permissions  | table | mmff_dev
#   public | roles_workspaces   | table | mmff_dev

# 2. Confirm no Go SQL strings still reference old names
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
grep -rn '"[^"]*\b\(role_permissions\|page_roles\|org_node_roles\|workspace_roles\)\b' \
  backend/ --include="*.go" || echo "clean"
# Note: grep may match `//` comment refs — those are acceptable churn.
# What matters is no SQL literal (inside backticks or quotes) hits these names.

# 3. Build backend
cd backend && go build -o /tmp/vector-backend ./cmd/server

# 4. Restart on :5100
lsof -ti:5100 | xargs -r kill; sleep 1
BACKEND_ENV=dev /tmp/vector-backend > /tmp/vector-backend.log 2>&1 &

# 5. Hot-path smoke
TOK=$(curl -sS -X POST http://localhost:5100/v1/api/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5100' \
  -d '{"email":"gadmin@mmffdev.com","password":"password"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
curl -sS -H "Authorization: Bearer $TOK" -H 'Origin: http://localhost:5100' \
  http://localhost:5100/v1/api/auth/me \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'permissions: {len(d.get(\"permissions\",[]))}')"
# Expected: permissions: 29
```

---

## Reference files

- Tech-debt register entry (RESOLVED): [docs/c_tech_debt.md](docs/c_tech_debt.md) — search for `TD-DB-004`
- Project CLAUDE.md (hard rules): [.claude/CLAUDE.md](.claude/CLAUDE.md)
- Schema overview: [docs/c_schema.md](docs/c_schema.md)
- Roles & permissions doc: [docs/c_c_roles_permissions.md](docs/c_c_roles_permissions.md)

---

## Notes on the rename pattern (for any future sibling renames)

The mechanical recipe used 4× in this family:

1. Inventory: `\d <oldname>` to list pkey, indexes, FKs (incoming + outgoing), triggers, check constraints, row count.
2. Write UP migration: `BEGIN; ALTER TABLE … RENAME TO …; ALTER INDEX … RENAME TO …;` (one per index — table rename does NOT auto-rename pkey index), then any constraints + triggers, then `COMMENT ON TABLE`, then `COMMIT;`.
3. Write DOWN migration: reverse all renames in inverse order.
4. Apply UP via psql.
5. Python sweep over Go SQL string literals only (skip comments/identifiers):
   ```python
   LIT   = re.compile(r'`[^`]*`|"(?:\\.|[^"\\\n])*"', re.S)
   TOKEN = re.compile(r'\b<old_table>\b')
   # apply TOKEN.sub inside each LIT match
   ```
6. `go build` — must be clean.
7. Restart on :5100, smoke-test the hottest path that touches the renamed table.
8. Update tech-debt register.

FK constraint names stay literal — Postgres only retargets the referenced table, not the constraint name. That's why the migrations don't rename FK constraints.
