# S01 — Schema migrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all eleven migrations (twelve tables) for the Notifications v2 schema in `db/vector_artefacts/schema/` — DDL, indexes, CHECK constraints, FK declarations, seed for `notifications_platform_channels`. After this story passes, the v2 schema exists on the dev DB and is ready for downstream code stories.

**Story estimate:** 5 (Fibonacci)

**Wave:** 1 (parallel-safe with S04; depends on nothing)

---

## Read first (REQUIRED)

1. **Spec — section "Data model"** at [../specs/2026-05-26-notifications-v2-design.md](../specs/2026-05-26-notifications-v2-design.md) — **this is the canonical DDL source**. Every column name, type, default, NULL/NOT NULL, CHECK constraint, and index in your migrations comes from this section. Do not improvise; do not abbreviate. If the spec disagrees with what you remember about the project, the spec wins (unless it conflicts with a HARD RULE — see step 4).

2. **Index doc** for orchestration context: [2026-05-26-notifications-v2-index.md](./2026-05-26-notifications-v2-index.md) — process discipline + branch model.

3. **Migration format reference** — read `db/vector_artefacts/schema/119_p3_drop_fdw_mmff_vector.sql` (or any of `110_` through `118_`) for the migration header comment format + `BEGIN; ... COMMIT;` pattern this project uses.

4. **HARD RULES — re-confirm:**
   - **Column-prefix:** every column on every new table is `<full_table_name>_<col>`. PK is `<full_table_name>_id`. The spec already specifies this; verify each migration matches.
   - **Diagnose with DB, not user:** if a check fails, query the DB / read the code; don't ask back upstream.
   - **Inspect index before commit:** `git diff --cached --stat` before every `git commit`.

---

## File structure

You will create **eleven SQL files** in `db/vector_artefacts/schema/`:

| # | Filename | Purpose |
|---|---|---|
| 1 | `120_notif_v2_events.sql` | `notifications_events_v2` |
| 2 | `121_notif_v2_event_recipients.sql` | `notifications_event_recipients` |
| 3 | `122_notif_v2_outbox.sql` | `notifications_outbox_v2` |
| 4 | `123_notif_v2_delivery_attempts.sql` | `notifications_delivery_attempts` |
| 5 | `124_notif_v2_users_settings.sql` | `users_notifications_settings` |
| 6 | `125_notif_v2_users_prefs.sql` | `users_notifications_prefs_v2` |
| 7 | `126_notif_v2_prefs_defaults.sql` | both `notifications_prefs_tier_defaults` + `notifications_prefs_system_defaults` (one file, two tables — they're tightly related) |
| 8 | `127_notif_v2_templates.sql` | `notifications_templates` |
| 9 | `128_notif_v2_rules.sql` | `notifications_rules_v2` |
| 10 | `129_notif_v2_users_inbox.sql` | `notifications_users_inbox_v2` |
| 11 | `130_notif_v2_platform_channels.sql` | `notifications_platform_channels` + seed rows |

Numbering picks up from existing 119. Confirm with `ls db/vector_artefacts/schema/ | sort -n | tail -3` before writing — if a parallel branch has landed 120+ since this plan was written, shift your numbers forward.

---

## Task ordering rationale

Migrations have FK dependencies. Order matters. The order above respects: events → recipients → outbox → attempts (each FKs the previous). Settings, prefs, defaults, templates, rules, inbox are mutually independent — written in spec order. Platform channels last because its seed is the only initial data.

Each migration is its own commit (cleanest rollback). All eleven commits land on `feature/notifications-v2/s01-schema` sub-branch (created from `feature/notifications-v2` HEAD).

---

## Task 1: Cut the story sub-branch

**Files:** none (git op)

- [ ] **Step 1.1**: Confirm you are on `feature/notifications-v2`:

```bash
git branch --show-current
```

Expected: `feature/notifications-v2`. If not, STOP and ask the Master.

- [ ] **Step 1.2**: Cut the story sub-branch from current HEAD:

```bash
git checkout -b feature/notifications-v2/s01-schema
git branch --show-current
```

Expected: `feature/notifications-v2/s01-schema`.

---

## Task 2: Write migration 120 — `notifications_events_v2`

**Files:**
- Create: `db/vector_artefacts/schema/120_notif_v2_events.sql`

- [ ] **Step 2.1**: Open the spec section "N — `notifications_events_v2`" and **copy the column list and constraints verbatim into a SQL DDL**. The file must include:
  - Migration header comment block matching the project format (see reference file 119)
  - `BEGIN;` ... `COMMIT;` wrap
  - `CREATE TABLE notifications_events_v2 (...)` with every column from the spec
  - All CHECK constraints listed in the spec
  - All indexes listed in the spec
  - Symmetric DOWN script (drop table, drop indexes — keep the file's UP and DOWN sections clearly labelled per project convention)

Constraints recap from spec — **verify each is present**:
  - `priority IN ('low','medium','high','critical')`
  - `fanout_mode IN ('direct','workspace','topology_node','topology_subtree','tenant','platform')`
  - `fanout_mode = 'direct' ⇒ id_recipient_user IS NOT NULL`
  - `fanout_mode = 'platform' ⇒ id_subscription IS NULL`
  - `fanout_mode IN ('topology_node','topology_subtree') ⇒ id_topology_node IS NOT NULL`
  - `sent_by_system = true ⇒ id_sent_by_user IS NULL`

Indexes recap — **verify each is present**:
  - UNIQUE `(notifications_events_v2_id_subscription, notifications_events_v2_event_key)`
  - `(notifications_events_v2_id_subscription, notifications_events_v2_created_at DESC)`
  - Partial WHERE `resolved_at IS NULL`
  - `(notifications_events_v2_created_at)` for prune

- [ ] **Step 2.2**: Dry-run the migration locally against the dev DB:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -1 -v ON_ERROR_STOP=1 -f db/vector_artefacts/schema/120_notif_v2_events.sql
```

The `-1` flag wraps it in a single transaction with `ROLLBACK` semantics on error. **It does NOT roll back on success** — the migration will actually apply if it succeeds. That's OK; we want it applied to dev.

Expected: no errors. Output should show `BEGIN`, `CREATE TABLE`, `CREATE INDEX`, `COMMIT`.

If it fails: read the error, fix the SQL, re-run. Do not move on with a failing migration.

- [ ] **Step 2.3**: Verify the table exists and constraints fired:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "\d+ notifications_events_v2"
```

Expected: column list matches spec, indexes listed, CHECK constraints visible.

- [ ] **Step 2.4**: Commit:

```bash
git add db/vector_artefacts/schema/120_notif_v2_events.sql
git diff --cached --stat
```

Expected: ONLY `db/vector_artefacts/schema/120_notif_v2_events.sql` staged. If anything else appears, `git reset HEAD <path>` it.

```bash
git commit -m "$(cat <<'EOF'
feat(notif-v2): mig 120 — notifications_events_v2

Canonical event table — one row per fired event regardless of
fan-out class. Six fanout modes with CHECK invariants. Idempotency
on (id_subscription, event_key). Partial index for unresolved
events. See spec section "N — notifications_events_v2".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write migration 121 — `notifications_event_recipients`

**Files:**
- Create: `db/vector_artefacts/schema/121_notif_v2_event_recipients.sql`

- [ ] **Step 3.1**: Same pattern as Task 2: spec section "N+1", verbatim DDL, header comment, `BEGIN; ... COMMIT;`, symmetric DOWN.

Indexes recap:
- UNIQUE `(notifications_event_recipients_id_event, notifications_event_recipients_id_user)`
- `(notifications_event_recipients_id_user, notifications_event_recipients_resolved_at DESC)`

FK declarations:
- `notifications_event_recipients_id_event` → `notifications_events_v2(notifications_events_v2_id)`
- `notifications_event_recipients_id_user` → `users(users_id)` — verify the users PK column is `users_id` in vector_artefacts (it should be per column-prefix rule). Confirm with `\d users` if uncertain.

- [ ] **Step 3.2**: Dry-run (same `psql -1` command as Task 2, swap filename).

- [ ] **Step 3.3**: Verify with `\d+ notifications_event_recipients`.

- [ ] **Step 3.4**: Commit (same pattern as Task 2; subject `feat(notif-v2): mig 121 — notifications_event_recipients`, body describes snapshot doorway from event to pipeline).

---

## Task 4: Write migration 122 — `notifications_outbox_v2`

**Files:**
- Create: `db/vector_artefacts/schema/122_notif_v2_outbox.sql`

- [ ] **Step 4.1**: Spec section "N+2". One row per `(recipient × channel)`. FK to events_v2 and users.

Indexes recap:
- Partial `(scheduled_for, created_at)` WHERE `claimed_at IS NULL AND delivered_at IS NULL AND attempts < 100`
- `(id_recipient_user, channel, created_at DESC)`

- [ ] **Step 4.2**: Dry-run.

- [ ] **Step 4.3**: Verify.

- [ ] **Step 4.4**: Commit (`feat(notif-v2): mig 122 — notifications_outbox_v2`, body describes per-recipient-per-channel outbox with future-dated scheduling).

---

## Task 5: Write migration 123 — `notifications_delivery_attempts`

**Files:**
- Create: `db/vector_artefacts/schema/123_notif_v2_delivery_attempts.sql`

- [ ] **Step 5.1**: Spec section "N+3". Append-only audit log. FK to events_v2, outbox_v2, users. `bypass_reason` column is critical — this is the column that holds `critical_priority` etc. per the locked decision.

Indexes recap:
- `(id_event, occurred_at)`
- `(id_recipient_user, occurred_at DESC)`
- `(channel, status, occurred_at)`

- [ ] **Step 5.2**: Dry-run.

- [ ] **Step 5.3**: Verify.

- [ ] **Step 5.4**: Commit (`feat(notif-v2): mig 123 — notifications_delivery_attempts`, body describes append-only audit including suppressions + bypass_reason).

---

## Task 6: Write migration 124 — `users_notifications_settings`

**Files:**
- Create: `db/vector_artefacts/schema/124_notif_v2_users_settings.sql`

- [ ] **Step 6.1**: Spec section "N+4". Per-user singleton (quiet hours + digest cadence). UNIQUE on `id_user`.

- [ ] **Step 6.2**: Dry-run.

- [ ] **Step 6.3**: Verify.

- [ ] **Step 6.4**: Commit (`feat(notif-v2): mig 124 — users_notifications_settings`).

---

## Task 7: Write migration 125 — `users_notifications_prefs_v2`

**Files:**
- Create: `db/vector_artefacts/schema/125_notif_v2_users_prefs.sql`

- [ ] **Step 7.1**: Spec section "N+5". Per-(user, event_type, channel). UNIQUE on `(id_user, event_type, channel)`.

- [ ] **Step 7.2**: Dry-run.

- [ ] **Step 7.3**: Verify.

- [ ] **Step 7.4**: Commit (`feat(notif-v2): mig 125 — users_notifications_prefs_v2`).

---

## Task 8: Write migration 126 — both `_defaults` tables

**Files:**
- Create: `db/vector_artefacts/schema/126_notif_v2_prefs_defaults.sql`

- [ ] **Step 8.1**: Spec section "N+6". TWO tables in one file: `notifications_prefs_tier_defaults` and `notifications_prefs_system_defaults`. Both are part of the 3-tier resolution chain (user → tier → system).

- [ ] **Step 8.2**: Dry-run.

- [ ] **Step 8.3**: Verify both tables exist.

- [ ] **Step 8.4**: Commit (`feat(notif-v2): mig 126 — prefs tier + system defaults`, body explains the 3-tier resolution chain).

---

## Task 9: Write migration 127 — `notifications_templates`

**Files:**
- Create: `db/vector_artefacts/schema/127_notif_v2_templates.sql`

- [ ] **Step 9.1**: Spec section "N+7". Per (event_type, channel, locale, version). UNIQUE on those four.

- [ ] **Step 9.2**: Dry-run.

- [ ] **Step 9.3**: Verify.

- [ ] **Step 9.4**: Commit (`feat(notif-v2): mig 127 — notifications_templates`).

---

## Task 10: Write migration 128 — `notifications_rules_v2`

**Files:**
- Create: `db/vector_artefacts/schema/128_notif_v2_rules.sql`

- [ ] **Step 10.1**: Spec section "N+8". Includes `template_override_id` FK to `notifications_templates` — make sure that table exists first (mig 127 ran before this — which it does, by file ordering).

- [ ] **Step 10.2**: Dry-run.

- [ ] **Step 10.3**: Verify.

- [ ] **Step 10.4**: Commit (`feat(notif-v2): mig 128 — notifications_rules_v2`).

---

## Task 11: Write migration 129 — `notifications_users_inbox_v2`

**Files:**
- Create: `db/vector_artefacts/schema/129_notif_v2_users_inbox.sql`

- [ ] **Step 11.1**: Spec section "N+9". In-app bell read-model. UNIQUE `(id_user, id_event)`.

- [ ] **Step 11.2**: Dry-run.

- [ ] **Step 11.3**: Verify.

- [ ] **Step 11.4**: Commit (`feat(notif-v2): mig 129 — notifications_users_inbox_v2`).

---

## Task 12: Write migration 130 — `notifications_platform_channels` + seed

**Files:**
- Create: `db/vector_artefacts/schema/130_notif_v2_platform_channels.sql`

- [ ] **Step 12.1**: Spec section "N+10". Singleton row per channel. **Seed six rows** in the SAME migration (inside the same BEGIN/COMMIT):

```sql
INSERT INTO notifications_platform_channels (
    notifications_platform_channels_channel,
    notifications_platform_channels_enabled,
    notifications_platform_channels_status,
    notifications_platform_channels_disabled_reason
) VALUES
    ('in_app', TRUE, 'live', NULL),
    ('sse',    TRUE, 'live', NULL),
    ('email',  TRUE, 'live', 'pending DEP1 (sending domain + API key)'),
    ('push',   FALSE, 'unimplemented', 'dispatcher not built'),
    ('slack',  FALSE, 'unimplemented', 'dispatcher not built'),
    ('sms',    FALSE, 'unimplemented', 'dispatcher not built');
```

Note: `email` is seeded `enabled=TRUE` per spec — the platform channel is live; the dev environment just can't deliver until DEP1 lands. This separation matters: an `enabled=FALSE` would suppress every email at the pipeline filter even after DEP1 is in.

Note the spec's operational warning: `in_app=FALSE` is a danger zone — it disables the irreducible floor. Migration seeds it `TRUE` as required.

- [ ] **Step 12.2**: Dry-run.

- [ ] **Step 12.3**: Verify both table exists and seed rows present:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "SELECT notifications_platform_channels_channel, notifications_platform_channels_enabled, notifications_platform_channels_status FROM notifications_platform_channels ORDER BY notifications_platform_channels_channel;"
```

Expected: six rows, matching the seed values above.

- [ ] **Step 12.4**: Commit (`feat(notif-v2): mig 130 — notifications_platform_channels + seed`, body describes kill switch + 6-row seed).

---

## Task 13: Linter discipline check

Per the validator's linter discipline amendment, every story must define + wire any new lint rule its work introduces.

S01 introduces eleven new tables, all in `vector_artefacts`, all expected to be column-prefix compliant. The existing `lint:column-prefix` rule (per `docs/c_c_lint_rules.md`) already enforces this — IF its scanner picks up new tables automatically.

- [ ] **Step 13.1**: Read `docs/c_c_lint_rules.md` to find the `lint:column-prefix` entry and locate the scanner script.

- [ ] **Step 13.2**: Run the scanner against the eleven new tables:

```bash
# Whichever invocation the doc specifies for lint:column-prefix — example:
bash dev/scripts/lint_column_prefix.sh 2>&1 | grep -E "notifications_events_v2|notifications_event_recipients|notifications_outbox_v2|notifications_delivery_attempts|users_notifications_settings|users_notifications_prefs_v2|notifications_prefs_tier_defaults|notifications_prefs_system_defaults|notifications_templates|notifications_rules_v2|notifications_users_inbox_v2|notifications_platform_channels"
```

Expected: zero violations for the new tables.

If violations: STOP, fix the migration, re-apply via psql, re-commit (NEW commit, not amend — per HARD RULE).

- [ ] **Step 13.3**: If `lint:column-prefix` doesn't pick up new tables automatically (e.g. it has a hardcoded table list), add the eleven new tables to its scope. This is part of "linter kept current" per the amendment.

- [ ] **Step 13.4**: If you added tables to the scope, commit the lint update as a separate commit (subject `chore(lint): add notif-v2 tables to lint:column-prefix scope`).

---

## Task 14: Vector_Scope.md scope-discipline entry

Per the scope discipline amendment, every story must append a scope entry in the same commit. For S01, we'll do it as a final consolidated commit since the eleven migration commits each represent the story's progress.

- [ ] **Step 14.1**: Open `Vector_Scope.md` and locate the `NV1. Notifications v2 — PLA build (orchestrated)` section (created by the validator earlier).

- [ ] **Step 14.2**: Append eleven lines under it — one per migration commit. Use this format (replace `<sha>` with the actual SHA from each commit):

```markdown
> Commit <sha> (2026-05-26): feat(notif-v2): mig 120 — notifications_events_v2
> Commit <sha> (2026-05-26): feat(notif-v2): mig 121 — notifications_event_recipients
... (etc)
```

Find SHAs with `git log --oneline -12 feature/notifications-v2/s01-schema | head -12` (or however many commits the story made).

- [ ] **Step 14.3**: Stage ONLY `Vector_Scope.md` and inspect:

```bash
git add Vector_Scope.md
git diff --cached --stat
```

Expected: ONLY `Vector_Scope.md` staged. Pre-existing dirty hunks of Vector_Scope.md are NOT yours to commit — keep your stage to only the new NV1 lines you added.

If the pre-existing dirty state interferes (your additive lines cannot be cleanly isolated from existing modifications), STOP and report to the Master — do NOT bundle other people's work into your commit.

- [ ] **Step 14.4**: Commit:

```bash
git commit -m "$(cat <<'EOF'
chore(notif-v2): scope entries for S01 migrations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Final verification

- [ ] **Step 15.1**: Confirm twelve tables exist in `vector_artefacts`:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'notifications_events_v2',
    'notifications_event_recipients',
    'notifications_outbox_v2',
    'notifications_delivery_attempts',
    'users_notifications_settings',
    'users_notifications_prefs_v2',
    'notifications_prefs_tier_defaults',
    'notifications_prefs_system_defaults',
    'notifications_templates',
    'notifications_rules_v2',
    'notifications_users_inbox_v2',
    'notifications_platform_channels'
  )
ORDER BY table_name;
"
```

Expected: twelve rows.

- [ ] **Step 15.2**: Confirm platform_channels seed is in place:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "SELECT COUNT(*) FROM notifications_platform_channels;"
```

Expected: `6`.

- [ ] **Step 15.3**: Confirm `schema_migrations` (or the project's equivalent migration tracker) is consistent:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 15;"
```

Expected: shows 120-130 (plus prior 110-119).

If the project doesn't auto-record into `schema_migrations` (some projects do this via a runner, not the SQL itself), check `backend/migrate` or `dev/scripts/` for the actual recording mechanism and run that.

- [ ] **Step 15.4**: Confirm no FK violations exist on the new tables:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  AND tc.table_name LIKE 'notifications_%v2'
     OR tc.table_name LIKE 'users_notifications_%'
ORDER BY tc.table_name, tc.constraint_type;
"
```

Expected: FK constraints present per spec, no orphaned references.

---

## Task 16: Report back to Master

When all tasks above are GREEN:

- [ ] **Step 16.1**: Produce the worker report. Format:

```
S01 WORKER — STATUS: READY FOR VALIDATION

Branch: feature/notifications-v2/s01-schema
Commits (oldest first):
  <sha-1> feat(notif-v2): mig 120 — notifications_events_v2
  <sha-2> feat(notif-v2): mig 121 — notifications_event_recipients
  ... (etc, 11 migration commits)
  <sha-12> chore(notif-v2): scope entries for S01 migrations
  (optional: <sha-13> chore(lint): add notif-v2 tables to lint:column-prefix scope)

Schema applied to dev DB: yes
Tables verified present: 12/12
platform_channels seed: 6/6
schema_migrations tracker: up-to-date through 130
lint:column-prefix: passes for all 11 new tables
No pre-existing dirty files touched: yes (Vector_Scope.md additive only)

Spec sections covered:
- "Data model" — all 11 sub-sections (N through N+10)

Open questions for validator: <list or "none">
Tech debt logged: <list, or "none">
```

Hand this report up to the Master.

---

## Definition of Done

S01 is DONE when:

1. Eleven migrations exist as files in `db/vector_artefacts/schema/`, numbered 120-130.
2. All eleven applied successfully to the dev DB.
3. All twelve tables (mig 126 has two) exist in `vector_artefacts` with column lists matching the spec.
4. `notifications_platform_channels` has six seed rows with the values specified.
5. `lint:column-prefix` passes on all new tables.
6. `feature/notifications-v2/s01-schema` has 11-13 commits (11 migration + 1 scope + optional 1 lint update).
7. `Vector_Scope.md` has eleven new lines under NV1 (one per migration commit).
8. Validator PASS verdict received.
9. Branch merged into `feature/notifications-v2` by the Validator (NOT the worker).

---

## Risks for the worker to watch

| Risk | Mitigation |
|---|---|
| Migration numbering collision with parallel work | Re-check `ls db/vector_artefacts/schema/ | sort -n | tail -3` before writing first migration; bump numbers forward if 120+ taken |
| Vector_Scope.md merge conflict with pre-existing dirty state | If pre-existing changes interfere, STOP and report — do not bundle other people's edits |
| FK to users in vector_artefacts — column name | Verify `users_id` is the PK column (per column-prefix rule); if it's still `id` for legacy reasons, use that and flag a TD entry |
| `schema_migrations` tracker — manual vs automatic | Read `backend/migrate` to confirm how the project records applied migrations; some projects record via SQL `INSERT INTO schema_migrations`, others via a Go runner |
| psql `-1` flag misunderstanding | The `-1` flag commits on success; only rolls back on error. This IS what we want for dev. Don't confuse with `--dry-run` (no such flag). |
| Wrong dev DB credentials | Project HARD RULE: check `backend/.env.dev` for the live connection string; do not assume defaults. Tunnel is on `localhost:5435` per CLAUDE.md |
