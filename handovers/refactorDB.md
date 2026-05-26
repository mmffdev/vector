# Handover — Database Refactor (Column-Prefix Cutover)

**Created:** 2026-05-26
**Status:** Approach pivot. Ready to execute via the IN-PLACE ALTER strategy (NOT wipe-and-reseed).
**Live HEAD:** `3ec7885e` (post-rewind, build green, live DBs untouched)
**Pre-rewind backup:** `20260526_025726_3ec7885e_dev_*.sql` on remote `vector-dev-pg` (auto-snapshotted by pre-push hook)

---

## TL;DR for a fresh-context session

You are picking up an in-flight database refactor. Every column on every table in `mmff_vector` + `vector_artefacts` must be prefixed with its full table name (`users.id` → `users.users_id`; `users.subscription_id` → `users.users_id_subscription` per the FK pattern in §2.4). The rule is locked in `.claude/CLAUDE.md`. ~50% of the work was shipped on 2026-05-14 via 9 ALTER TABLE migrations. **27 tables remain unswept** — they're listed below.

**Do not wipe + reseed.** A previous attempt in this session built a wipe-and-reseed pipeline and it cost 8 hours of detours. The right approach is to **finish the in-place ALTER TABLE sweep** following the existing pattern in `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql`.

**Read these files in this order before doing anything:**
1. This handover, top to bottom.
2. `.claude/CLAUDE.md` — full HARD RULES surface, especially the EVERY COLUMN IS `<table_name>_<column>` rule and the NEVER DESTRUCTIVE GIT rule.
3. `docs/c_c_naming_conventions.md` §2.3 (column prefix), §2.4 (PK/FK shape), §2.8 (rename history + done list).
4. `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql` — the canonical template for one of these migrations.
5. `docs/c_c_db_routing.md` — pool → DB → service map. Required reading before any psql query (per HARD RULE NEVER ASSUME A DATABASE).

---

## What is DONE

### Policy
- **Column-prefix HARD RULE** locked in `.claude/CLAUDE.md`: every column on every table in `mmff_vector` + `vector_artefacts` is `<table_name>_<col>`. PK is `<table>_id`. FK is `<table>_id_<target>[_<role>]` per `docs/c_c_naming_conventions.md` §2.3 + §2.4. `mmff_library` is EXEMPT (shared library spine).
- **Vector_Scope.md B18.9** updated to the full-table-name rule (doc v2.63).
- **`docs/c_c_column_prefix_registry.md` DELETED** — mechanical rule needs no registry.
- **3-letter-abbreviation detour** (commits `b4d879df` … `01b103eb` … `69f23efe`) **REWOUND** via `git reset --hard 3ec7885e` + `git push --force-with-lease origin main` (2026-05-26 02:57 UTC). Clean baseline.
- **Bookmarks cleanup** done in commits `c4698ffe` + `1c9bc5d7`. Entity-bookmark surface fully removed (frontend + backend); `PageBookmarks` survives.

### Snapshots + safety nets
- 4 DBs snapshotted on remote Postgres as `*_snapshot_20260525` (mmff_vector, vector_artefacts, mmff_library, mmff_dev) — parity-verified, queryable any time.
- Pre-push backup hook took an additional snapshot at rewind point (`3ec7885e`).
- Documented in `docs/c_c_db_routing.md` (commit `3a3f3801`).

### Discovery work (still valid)
- Wave 1A — drop-order inventory for both DBs (38 + 39 tables, FK direction known)
- Wave 1B — migration file census at `/tmp/migration_rewrite_map.json` (stale on the prefix-registry side now; structural inventory still useful)
- Wave 1C — Go SQL constants census at `/tmp/go_sql_rewrite_map.json` (same caveat)
- All 4 surviving DBs + their snapshot copies are intact and queryable

---

## CRITICAL pivot — what the NEXT session must adopt

**Don't do wipe-and-reseed. Do the in-place ALTER TABLE RENAME COLUMN approach instead.**

Discovery this session: `docs/c_c_naming_conventions.md` §2.8 documents that the column-prefix sweep was already *partially shipped* on 2026-05-14 across 9 migrations (`186_users_password_resets_column_prefix_RF1_4_4.sql` … `190_users_nav_column_prefix_RF1_4_4.sql` + `063_*` … `066_*` on the vector_artefacts side). The pattern works, the migrations are in tree, and `lint:column-prefix-convention` already enforces it.

**The job is to finish the partial sweep**, not rebuild the world.

### Live-DB current state (verified 2026-05-26)

27 tables across both DBs still have bare columns. Run this to refresh:

```sql
-- in mmff_vector + vector_artefacts:
SELECT table_name, count(*) AS bare_col_count
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND NOT (column_name LIKE table_name || '\_%' ESCAPE '\')
   AND table_name NOT LIKE 'pg\_%' ESCAPE '\'
   AND table_name NOT LIKE 'fdw\_%' ESCAPE '\'
   AND table_name != 'schema_migrations'
 GROUP BY table_name
 ORDER BY table_name;
```

As of 2026-05-26 the gap list was:

**mmff_vector (13 tables, ~145 bare columns):**
- `cost_centres` (9)
- `csp_reports` (17)
- `dpop_jti_cache` (2)
- `library_help_defaults` (10)
- `master_record_workspaces` (10)
- `page_entity_refs` (3)
- `pages` (14)
- `subscriptions` (7)
- `users` (43) — see §2.9 carve-out below
- `users_custom_page_views` (8)
- `users_custom_pages` (7)
- `users_tab_order` (8)
- `vector_icons` (7)

**vector_artefacts (14 tables, ~133 bare columns):**
- `artefact_priorities` (9)
- `artefacts` (26) — see §2.9 carve-out below
- `artefacts_adoption_states` (10)
- `artefacts_fields_library` (12)
- `artefacts_number_sequences` (3)
- `artefacts_search_outbox` (6)
- `artefacts_types_fields` (8)
- `csp_reports` (17)
- `dpop_jti_cache` (2)
- `etl_backfill_audit` (5)
- `strategy_layers_adopted` (8)
- `topology_commits` (5)
- `topology_nodes` (20)
- `workspaces_fields` (4)

**§2.9 carve-out (re-read before touching):** the doc claims `users` (mmff_vector) and `artefacts` (vector_artefacts) intentionally stay bare due to JSON wire-tag dependencies. User has NOT explicitly re-confirmed this in the 2026-05-26 conversation — verify intent before sweeping those two. If the user wants them prefixed too (likely, given the "every column" mandate), the frontend JSON tags need a coordinated rewrite.

---

## How to do it (the new approach)

**Pattern template — read this file first:** `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql`

For each unswept table:

1. Write a new migration `db/<dbname>/schema/NNN_<table>_column_prefix.sql` (next available NNN).
2. `ALTER TABLE <name> RENAME COLUMN <old> TO <new>` for every column. PK becomes `<table>_id`. FK becomes `<table>_id_<target>[_<role>]` per §2.4.
3. Rename indexes + constraints to match (the 186 template shows this).
4. DOWN counterpart: reverse renames.
5. Apply against `mmff_vector_snapshot_20260525` / `vector_artefacts_snapshot_20260525` first as a dry-run (the snapshots exist precisely for this — copy snapshot to a `_dryrun` DB, apply, verify).

Then sweep the Go side:

6. `backend/internal/**/sql.go` — every SELECT / INSERT / UPDATE / JOIN / WHERE referencing the renamed columns gets rewritten.
7. `db:"..."` struct tags + `pgx.RowToStructByName` consumers updated.
8. `go build ./... && go test ./...` green.

Then ship:

9. Apply migrations against the LIVE DBs in order.
10. Restart backend.
11. Smoke test: padmin login works, dashboard renders, key CRUD paths function.
12. Regenerate SY003 (HARD RULE — substrate changed).

**Total effort estimate:** ~3-4 hours if briefed correctly into one or two subagents that follow the 186 template. NO wipe. NO bootstrap. NO destructive operations against live data.

---

## Where to pick up next

1. **Read this whole doc.**
2. **Re-read `docs/c_c_naming_conventions.md` §2.3 + §2.4 + §2.8** — that's the rule + pattern + status truth.
3. **Decide the §2.9 carve-out:** sweep `users` + `artefacts` too, or keep them bare? Ask the user.
4. **Dispatch ONE subagent** with this brief shape:
   - Goal: write 27 ALTER TABLE column-prefix migrations following the 186 template
   - Source of truth: live snapshot DB schema (`*_snapshot_20260525`) for column inventory
   - Per-table: derive PK + FK column names per §2.4 (e.g. `users.subscription_id` → `users_id_subscription`, NOT `users_subscription_id`)
   - Sweep Go SQL in the same task — every renamed column gets corresponding Go rewrites
   - Dry-run against `*_dryrun` throwaway DBs before declaring done
   - Output: `db/{mmff_vector,vector_artefacts}/schema/NNN_*_column_prefix.sql` + DOWN counterparts + Go diffs
5. **Verify the agent's output by opening files** — DO NOT trust the summary. The last attempt's agent said "verified by spot-check" and shipped 4 structural defects (`set_updated_at` hardcoded to one table's column, missing sequence definitions, orphaned dispatch trigger, bare-col refs in `fn_users_roles_pages_cascade_nav_prefs`).
6. **Apply against snapshot DBs first**, then live.
7. **Restart backend, smoke test, regenerate SY003.**

---

## Known caveats

### What WAS partly broken in the wipe-and-reseed attempt (now reverted)
For the historical record, in case the wipe-and-reseed approach gets resurrected:

- `set_updated_at()` trigger function — shared by 11 tables across both DBs, but pg_dump emitted a per-table hardcoded body. Generic rewrite via `TG_TABLE_NAME` works:
  ```sql
  CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE v_col text := TG_TABLE_NAME || '_updated_at';
  BEGIN
      NEW := json_populate_record(NEW, json_build_object(v_col, now())::jsonb::json);
      RETURN NEW;
  END;
  $$;
  ```
- `dispatch_polymorphic_parent()` function was referenced by `trg_subscriptions_stakeholders_dispatch` but its original parent tables (`company_roadmap`, `workspace`, `portfolio`, `product`) are all DEAD. Resolution: drop the trigger entirely, tighten CHECK constraint to single surviving parent (`'master_record_workspaces'`).
- `artefacts_search_outbox.id` + `webhooks_deliveries.id` are `bigserial`, not `bigint NOT NULL` + `ALTER ... SET DEFAULT nextval(...)`. pg_dump separates the sequence creation; agent missed the CREATE SEQUENCE.

### Dead-code FDW callers (untouched this session)
3 Go files reference foreign tables that should be dropped:
- `backend/internal/workspacemasterrecord/sql.go` — `fdw_workspaces`, `fdw_subscriptions`
- `backend/internal/mentions/sql.go` — `users_teams_members` (table doesn't exist)
- `backend/internal/nav/sql.go` — `loadEntity` stub for a deleted route

Not blocking; compile is green because Go doesn't validate SQL strings at compile time. These will runtime-fail when called. Fix during the cutover or open a separate TD.

### Files in /tmp from this session (probably gone after macOS cleanup)
- `/tmp/migration_rewrite_map.json` — Wave 1B output
- `/tmp/go_sql_rewrite_map.json` — Wave 1C output
- `/tmp/collapse_migrations.py` — Wave 2D's pg_dump→synth script

Don't rely on these. Regenerate if needed.

### Process lessons
- **DO NOT trust subagent summaries.** Open files and verify before chaining the next agent. Last attempt's Wave 2D agent claimed "verified by spot-check" and shipped 4 structural defects.
- **Lock the rule shape FIRST** by reading `docs/c_c_naming_conventions.md` §2.3 + §2.4 before any agent dispatch. The previous run picked the wrong shape (`users_subscription_id` vs the canonical `users_id_subscription`) because it didn't reference §2.4.
- **The §2.8 status line ("COLUMN-PREFIX SWEEP COMPLETE") is overstated** — only ~50% of tables were swept on 2026-05-14. Read live-DB column shapes via `information_schema.columns`, not the doc.

---

## Operational facts a cold-start session needs

### Postgres access
The dev Postgres lives in a Docker Swarm container `vector-dev_postgres.*` on remote host `vector-dev-pg` (77.68.33.216). The Mac connects via SSH tunnel on `localhost:5435`. **Docker does NOT run on the Mac.** All DB introspection from the agent side must use this pattern:

```bash
ssh -o ExitOnForwardFailure=no vector-dev-pg \
  "docker exec \$(docker ps --format '{{.Names}}' | grep '^vector-dev_postgres') \
   psql -U mmff_dev -d <dbname> -c '<sql>'"
```

The `-o ExitOnForwardFailure=no` is needed because the SSH alias has auto-forwards (ports 5435/7575/8085/3002/3100/5672/15673) that fail if the dev backend is running and holding them.

Live DBs: `mmff_vector`, `vector_artefacts`, `mmff_library`, `mmff_dev`.
Snapshot DBs: `*_snapshot_20260525` (same names + suffix).
Throwaway DBs for dry-runs: create as `*_dryrun` then drop.

DB password (dev): `68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi` (also in `backend/.env.dev` as `DB_PASSWORD`).

### Backend stack
- **Go backend** on `http://localhost:5100`. Run via `cd backend && BACKEND_ENV=dev go run ./cmd/server`. Logs to stdout.
- **Next.js frontend** on `http://localhost:5101`. Run via `npm run dev`. Logs to stdout.
- **Env pinning:** backend is HARD-PINNED to `dev`. Don't switch. `backend/.env.staging.locked` and `.env.production.locked` are refusing stubs.
- **Dev API key for curl tests:** `grep DEV_API_KEY backend/.env.dev | cut -d= -f2` — gets you a Bearer token that bypasses the session/DPoP flow for any `/_site/admin/dev/*` route.

### Tests
- Backend: `cd backend && go test ./...` (some `featuretests` are pre-existing broken — `vectorArtefactsPoolForF1` undefined — not blocking unrelated work).
- Frontend: `npm run typecheck` for TS check; `npm run test` for vitest if needed.
- Lint suite: `npm run lint:column-prefix-convention` checks column-prefix gaps and was the lint that enforced the partial sweep on 2026-05-14.

### Human accounts — HARD RULE, do not modify
- `gadmin@mmffdev.com` / `padmin@mmffdev.com` / `user@mmffdev.com` — passwords `password` (reset 2026-05-02). Never modify their `users.password_hash`, `users.email`, `users.is_active`, `users.role`, or `users.password_changed_at`. If login fails: ASK, don't overwrite.
- For testing: create NEW accounts (e.g. `claude_gadmin@mmffdev.com`).

### Commit style
Recent commit message style — look at `git log --oneline -10` for the pattern. Use `[B18.9]` (or whatever scope ref applies) in subject. Co-author trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
Pre-commit hook auto-regenerates the API spec when backend route surface changes; let it. Pre-push hook auto-snapshots all 3 DBs (mmff_vector / vector_artefacts / mmff_library) and tags by HEAD sha.

### Subagent dispatch discipline (mandate added this session)
- Default to subagents for any task >3 tool calls.
- Brief them like a colleague with zero context — explicit file paths, explicit success criteria, explicit STOP-on-unmapped policy.
- **NEVER trust an agent's "verified by spot-check" claim.** Open files and verify between waves.
- Memory leaf: `context/memory/feedback_subagent_driven_default.md` (was committed once as `85ea4ad5` and lost in the rewind — re-add if needed).

---

## Reference

### Migration template
`db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql` — read first

### Naming spec
`docs/c_c_naming_conventions.md` §2.3 (column-prefix), §2.4 (PK/FK shape), §2.8 (rename history), §2.9 (known carve-outs)

### Live-DB query for current bare-column gaps
See SQL block above under "Live-DB current state"

### Snapshot DBs (queryable safety net)
- `mmff_vector_snapshot_20260525`
- `vector_artefacts_snapshot_20260525`
- `mmff_library_snapshot_20260525`
- `mmff_dev_snapshot_20260525`

Access via:
```bash
ssh -o ExitOnForwardFailure=no vector-dev-pg \
  "docker exec \$(docker ps --format '{{.Names}}' | grep '^vector-dev_postgres') \
   psql -U mmff_dev -d <snapshot_name> -c '<sql>'"
```

### Pre-rewind backup (from pre-push hook)
- `20260526_025726_3ec7885e_dev_mmff_vector.sql` (1.6 MB)
- `20260526_025726_3ec7885e_dev_vector_artefacts.sql` (3.9 MB)
- `20260526_025726_3ec7885e_dev_mmff_library.sql` (34 KB)

Path on remote: standard backup-on-push location.

### Pool-swap site enumeration (for future PLA064 phases 4-6)
`handovers/wipe_reseed_pool_swap_sites.md` — every `NewService(pool, ...)` site in `backend/cmd/server/main.go` that would need swapping if mmff_vector → vector_artefacts merge happens. NOT in scope for this column-prefix cutover.

---

## Why this session took 8 hours

For the next session to learn from:

1. **3-letter prefix detour cost ~2 hours.** I (Claude this session) didn't read `c_c_naming_conventions.md` §2.3 before proposing a rule, so I invented a 3-letter-abbreviation variant when the established full-table-name convention already existed. Discovered the existing rule mid-flight, had to revert.
2. **Wave 2D pg_dump synthesis cost ~3 hours.** The agent built 164 new migration files from `pg_dump --schema-only` of the snapshots — a different shape than the ALTER TABLE in-place pattern that §2.8 had already established. Worked structurally but missed the 4 defects above; would have needed continued patching.
3. **Trusting agent summaries cost ~1 hour of debugging on top.** Agent said "verified by spot-check" — they hadn't. Dry-run replay caught the issues but only because I (eventually) ran it.
4. **Approach pivot cost ~1 hour at the end** when reading §2.8 revealed the in-place ALTER pattern was already documented and partly shipped.

**The right approach was always:** read the existing convention doc, find the partial work, finish it the same way. 3-4 hours start to finish.
