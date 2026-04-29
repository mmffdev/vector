---
name: SEC-15 split plan (sprint019)
description: Pending work — split SEC-15 (13pts) into SEC-15/SEC-22/SEC-23 (5/5/5 pts). All stay in sprint019. Execute overnight in bypass-permissions mode.
type: project
originSessionId: f9e1df41-a67e-453d-9a5b-b23b674c9d40
---
# SEC-15 Split — Sprint019 Execution Plan

**Status:** Approved 2026-04-20, pending execution.

**Also in live PG as of 2026-04-20, uncommitted:** DEP-01 (backlog insert — dependency mapping, 8pts, assigned_sprint=NULL, origin=user). Any PG dump taken now captures this too. User has NOT yet accepted it into a commit — if executing the SEC-15 split, flag that the commit will also include DEP-01 silently. Ask user before proceeding if unsure.

**Why:** SEC-15 at 13 pts violated the >13-point split rule and bundled three distinct concerns (rate limiter key, Redis store, Socket.IO migration). User approved the split and explicitly wants all three stories kept in sprint019.

**How to apply:** Execute this plan verbatim. Do NOT alter story text, point values, or target sprint without re-checking with the user.

## Net effect
- SEC-15 drops 13 → 5 pts (scope narrowed to rate-limiter keying only)
- SEC-22 new (5 pts, Redis-backed store)
- SEC-23 new (5 pts, Socket.IO migration)
- Sprint019 total: 72 → 74 pts, 11 → 13 stories, all `to-do`, all `origin=sprint019`

## DB connection (live PG, SSH tunnel on 5434)
```bash
PGPASSWORD='9&cr39&19&11Ctcr' /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops
```

## SEC-15 — UPDATE (keep row, narrow scope, drop points to 5)

```sql
UPDATE backlog_items
SET estimate = 5,
    user_story = 'As a Maintainer of the System, I want the API rate limiter keyed by session token (with a sensible anonymous fallback), so that many concurrent users behind a shared NAT (office/VPN) are not collectively throttled, as proven by: 100 users on the same IP each getting their own 100 req/min budget; anonymous traffic still throttled by IP; limiter middleware reads X-Session-Token before falling back.'
WHERE id = 'SEC-15';
```

## SEC-22 — INSERT (Redis-backed rate limit store, 5 pts)

```sql
INSERT INTO backlog_items (
  id, role, estimate, category, origin, assigned_sprint,
  position, is_trash, target, user_story, status, project_id
) VALUES (
  'SEC-22',
  'Maintainer of the System',
  5,
  'security',
  'sprint019',
  'sprint019',
  7,
  0,
  'dev',
  'As a Maintainer of the System, I want the rate-limit counters moved into a Redis store instead of in-process memory, so that limits survive backend restarts and scale horizontally across instances, as proven by: a backend restart does not reset counters; two backend instances share a single budget per key; Redis TTLs expire stale buckets automatically.',
  'to-do',
  'stub-project'
);
```

## SEC-23 — INSERT (Dashboard pollers → Socket.IO, 5 pts)

```sql
INSERT INTO backlog_items (
  id, role, estimate, category, origin, assigned_sprint,
  position, is_trash, target, user_story, status, project_id
) VALUES (
  'SEC-23',
  'Maintainer of the System',
  5,
  'security',
  'sprint019',
  'sprint019',
  8,
  0,
  'dev',
  'As a Maintainer of the System, I want Local Setup and ServicePulse migrated from periodic HTTP polling to a single Socket.IO subscription channel, so that dashboard traffic does not consume rate-limit budget and updates feel instant, as proven by: no polling intervals remain in Local Setup or ServicePulse; both pages update via socket events; network tab shows one ws connection instead of N/sec requests.',
  'to-do',
  'stub-project'
);
```

## Verification (must pass before commit)

```sql
-- Expect 13 rows, all to-do, total estimate = 74
SELECT COUNT(*) AS story_count, SUM(estimate) AS total_points
FROM backlog_items
WHERE assigned_sprint = 'sprint019' AND (is_trash = 0 OR is_trash IS NULL);

-- Expect SEC-15 estimate=5; SEC-22 and SEC-23 present
SELECT id, estimate, status, origin FROM backlog_items
WHERE id IN ('SEC-15','SEC-22','SEC-23') ORDER BY id;
```

If counts are wrong, abort — do NOT commit or push.

## Git cycle (only after verification passes)

**IMPORTANT:** `backend/data/ops.db` is a stale SQLite legacy file — the live app is Postgres-only (tunnel 5434). Do NOT `git add ops.db`; it does not reflect current state.

Steps:
1. Take a fresh PG dump by invoking `<backupdb>` (writes timestamped `.sql` into `backend/data/.pg-backup/`).
2. Stage the new dump file only:
   ```bash
   NEW_DUMP=$(ls -t backend/data/.pg-backup/mmff_ops-*.sql | head -1)
   git add "$NEW_DUMP"
   git commit -m "Split SEC-15 into SEC-15/SEC-22/SEC-23 — narrow rate-limiter scope, add Redis and Socket.IO stories

   Sprint019 total: 72 → 74 pts, 11 → 13 stories. All stay in sprint019 per user instruction.
   PG dump captures the post-split DB state.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   git push origin deeplink002
   ```

**Do NOT merge to main.** This split stays on deeplink002 until the user decides.
**Do NOT stage `backend/data/ops.db`** — legacy, does not reflect PG state.
**Do NOT stage other dirty dumps** that may exist in `.pg-backup/` from prior session work — only the new one from step 1.

## Reference context (as of 2026-04-20)
- Current branch: deeplink002
- Current sprint (DB): sprint019
- SEC-15 pre-split state: 13 pts, role='Maintainer of the System', category='security', target='dev', position=6, project_id='stub-project', origin='sprint019', status='to-do'
- Max existing SEC id before split: SEC-21
