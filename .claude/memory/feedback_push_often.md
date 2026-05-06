---
name: Push migrations + commits often, don't stack
description: Don't let migrations or commits stack across sessions; push as soon as a logical unit lands so drift doesn't accumulate
type: feedback
originSessionId: 67d23c1d-67ab-4f68-9e41-b57f3d3c96a9
---
Push migrations and commits **as they land**, not in batches. Do not let multiple migrations sit untracked or uncommitted across sessions — that creates `schema_migrations` drift, gaps in numbering, and surprise reveals when someone finally tries to push.

**Why:** Drift compounds silently. By the time the user said "push my migrations" today (2026-05-05), 14 migrations (104–118) had been applied to the dev DB without ever being recorded in `schema_migrations` — because prior sessions ran them via raw psql instead of through the migrator and never committed the files. Result: a clean push required pre-push schema-table backfill, identifying a missing migration 116 gap, and applying a stranded migration 115. None of that would have existed if each migration had been pushed at the moment it was written and applied.

**How to apply:**
- When a migration is written and applied to dev → commit it (UP + DOWN) and offer to push **the same turn**, not "later".
- Same for backend code changes that depend on a migration — push the pair together.
- If a migration is applied via raw psql instead of the migrator, immediately also `INSERT INTO schema_migrations` so the marker stays truthful.
- If a migration is drafted but skipped (e.g. number 116 today), don't leave a gap — either renumber subsequent files or write a no-op stub before pushing.
- At the end of any task that touched `db/schema/` or `backend/`, the default action is "stage + commit + push", not "leave for next session".
