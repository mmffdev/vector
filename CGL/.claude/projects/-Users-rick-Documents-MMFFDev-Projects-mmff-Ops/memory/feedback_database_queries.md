---
name: Database query best practices
description: Never assume schema. Verify before parallel bash calls. Check memory first.
type: feedback
originSessionId: b4d83f67-968e-4e16-9bbe-ba9b25ff8d50
---
**Rule:** Always verify schema before writing SQL. Never assume column names based on "common sense."

**Why:** 
- Sprints table has no `status` column (assumed wrong during stats story creation)
- Backlog_items has no `feature_label` or `badge` columns
- These aren't edge cases — they're the *design choice* of the app

**How to apply:**
1. **Before any SQL:** Check `/memory/database_schema_reference.md` first
2. **If table not in memory:** Query `.schema <table>` once, add to memory, then write SQL
3. **Never use parallel bash calls for SQL** if schema isn't pre-confirmed (one failure cascades to cancel all parallel calls)
4. **Use sequential bash** when testing uncertain queries — one psql call at a time

**Example of the mistake:**
```bash
# ❌ WRONG: Assumes sprints.status exists, runs in parallel
PGPASSWORD=... psql ... -c "SELECT id, status FROM sprints WHERE status = 'active';"
# Error: column "status" does not exist
# Also cancels the second parallel bash call
```

**Correct approach:**
```bash
# ✓ RIGHT: Check memory first
# (memory says: sprints has no status, use id ordering)
# Then query sequentially if uncertain
PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) \
  /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops \
  -c "SELECT id FROM sprints ORDER BY id DESC LIMIT 1;"
```
