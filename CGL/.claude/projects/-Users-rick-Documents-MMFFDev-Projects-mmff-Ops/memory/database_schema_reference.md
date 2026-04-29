---
name: mmff-Ops database schema reference
description: Key table schemas for ops.db — sprints, backlog_items, research_meta. Save queries time and prevent schema assumption errors.
type: reference
originSessionId: b4d83f67-968e-4e16-9bbe-ba9b25ff8d50
---
## Quick Schema Reference

**Always query from this first before running SQL.** This saves round-trips and prevents assumption errors.

### sprints table

```sql
CREATE TABLE sprints (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    date             TEXT,
    scope            TEXT DEFAULT '',
    features_added   TEXT DEFAULT '[]',
    features_removed TEXT DEFAULT '[]',
    sprint_ref       INTEGER,
    start_date       TEXT,
    end_date         TEXT,
    count_stories    INTEGER DEFAULT 0,
    count_defects    INTEGER DEFAULT 0,
    estimation       INTEGER,
    project_id       TEXT DEFAULT 'stub-project',
    creator_id       TEXT,
    owner_id         TEXT,
    assignee_id      TEXT
);
```

**Note:** No `status` column. Use `start_date`/`end_date` or `sprint_ref` ordering to find current sprint.

### backlog_items table

```sql
CREATE TABLE backlog_items (
    id               TEXT PRIMARY KEY,
    user_story       TEXT NOT NULL,
    role             TEXT DEFAULT '',
    status           TEXT DEFAULT 'to-do'
                     CHECK(status IN ('to-do','doing','done','removed')),
    estimate         INTEGER,
    category         TEXT DEFAULT '',
    origin           TEXT,
    assigned_sprint  TEXT,
    delivered_sprint TEXT,
    position         INTEGER NOT NULL DEFAULT 0,
    is_trash         INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now')),
    target           TEXT DEFAULT 'dev' CHECK(target IN ('user','dev')),
    github_url       TEXT DEFAULT '',
    resolution       TEXT DEFAULT '',
    project_id       TEXT DEFAULT 'stub-project',
    creator_id       TEXT,
    owner_id         TEXT,
    assignee_id      TEXT
);
```

**Common queries:**
- Next sequential ID for a prefix: `SELECT id FROM backlog_items WHERE id LIKE 'PREFIX-%' ORDER BY id DESC LIMIT 1;`
- Current sprint stories: `SELECT * FROM backlog_items WHERE assigned_sprint = 'sprint019';`

### research_meta table

```sql
CREATE TABLE research_meta (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    date        TEXT NOT NULL,
    creator_id  TEXT,
    owner_id    TEXT,
    assignee_id TEXT
);
```

---

## Usage Rules

**Before writing any SQL:**
1. Check this file first
2. If the table isn't listed, query `.schema <table>` once and add it
3. Never assume column names (sprints has no `status`, backlog_items has no `feature_label`)
4. Use sequential bash calls when uncertain; parallel calls only after schema is confirmed
