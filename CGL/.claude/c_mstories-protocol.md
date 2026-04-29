# mstories — Make User Stories & ustories — Update User Stories

**Loaded on demand — read this file when the user writes `<mstories>` or `<ustories>`.**

> **Port**: Read `backend_port` from `GET /api/dev/config/backend_port` if needed. Default: `5175`.

## mstories — Make User Stories

When the user writes **`<mstories>`**, create user stories for the work done in the current session and write them to the database.

**Prerequisites — refuse if not met:**
1. An **action plan** or **approved design** must exist in the current session. This includes: plan mode was used, a clear scope of work was discussed and agreed, OR a design/plan was presented and the user confirmed it. If none of these exist, respond: *"No scope defined. Use plan mode or describe the feature first, then run `<mstories>`."*
2. Work must have been **implemented OR planned and approved**. If the plan has been approved but code hasn't been written yet, create stories with `status = 'to-do'` (not `done`). If code has been written and verified, create stories with `status = 'done'`.

**Process:**
1. Review all work done in the current session — files created, modified, endpoints added, features built
2. Identify area prefixes needed (e.g. `FT`, `RES`, `SW`). For each prefix, query the DB to find the last used ID.
   **This project uses PostgreSQL via the backend API — never SQLite.** Get the backend port first:
   ```bash
   BACKEND_PORT=$(curl -sf http://localhost:3334/api/status | python3 -c "import sys,json; print(json.load(sys.stdin)['backend']['port'])")
   TOKEN=$(curl -sf "http://localhost:$BACKEND_PORT/api/dev/backlog" -H "X-Session-Token: $(cat ~/.mmff-token 2>/dev/null || echo '')" -H "X-Project-Id: stub-project" 2>/dev/null | python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); ids=[i['id'] for i in items if i['id'].startswith('FT-')]; print(sorted(ids)[-1] if ids else 'FT-00')" 2>/dev/null || echo "FT-00")
   ```
   Or query Postgres directly via the SSH tunnel (port from `.env.local`):
   ```bash
   PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops -t -c "SELECT id FROM backlog_items WHERE id LIKE 'FT-%' ORDER BY id DESC LIMIT 1;"
   ```
   Use the next sequential number. Never guess — always query first.
3. Break the work into user stories following the ATS format:
   ```
   As a [role], I want [capability], so that [benefit], as proven by [acceptance criteria].
   ```
4. **Estimate each story** on the Fibonacci scale (1, 2, 3, 5, 8, 13). Base the estimate on scope and acceptance-criteria complexity.
   - If any story estimates above 13, **refuse** — split it into smaller stories before proceeding. >13pts signals ambiguity or unclear AC (see feedback_story_sizing.md).
   - Present the estimate as a proposal; the user can override in review.
5. Present the stories in a table for user review with columns: ID, Story (truncated), Role, Estimate, Category.
6. On confirmation, insert into the `backlog_items` table **including `estimate`** via Postgres (NOT SQLite):
   ```bash
   PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops << 'ENDSQL'
   INSERT INTO backlog_items (id, user_story, role, status, estimate, category, origin, assigned_sprint, delivered_sprint, target, position, project_id)
   VALUES ('ID', 'full story text', 'role', 'status', 3, 'category', 'sprintXXX', 'sprintXXX', NULL, 'user|dev', 0, 'stub-project')
   ON CONFLICT (id) DO NOTHING;
   ENDSQL
   ```
   ```
6. After insertion, for each story that represents a user-visible feature change, POST a changelog entry:
   ```bash
   curl -s -X POST http://localhost:5175/api/dev/changelog \
     -H "Content-Type: application/json" \
     -d '{"type":"added","feature":"Feature Name","description":"Plain English sentence.","sprint":"sprintXXX","story_ref":"ID","timestamp":"YYYY-MM-DD"}'
   ```
   - `type`: `added` / `removed` / `updated` — infer from story context
   - `feature`: short name (e.g. `feature_swatch_maker`, `Backend Status Indicator`)
   - `description`: one plain-English sentence — what it does or what changed
   - Report all generated `ref_id` values (e.g. `CHG-013-001`)

**Field mapping:**

| Field | Rule |
|---|---|
| `id` | `{AREA}-{SEQ}` — area prefix + sequential number (e.g. `FT-01`, `RES-03`) |
| `user_story` | Full "As a... I want... so that... as proven by..." text |
| `role` | `maintainer` for dev artefacts, `user` for user artefacts |
| `status` | `done` if work complete, `doing` if in progress, `to-do` if planned |
| `estimate` | **Required.** Fibonacci scale (1, 2, 3, 5, 8, 13). Propose based on scope; user may override in review. Refuse any story >13pts — split first. |
| `category` | Short grouping label matching the area (e.g. `FeatureTable`, `Research`, `Logs`) — reuse existing categories before creating new ones |
| `origin` | Sprint where the story was **created** — always the current sprint, **never blank** |
| `assigned_sprint` | Sprint where the work is planned/done — usually same as origin |
| `delivered_sprint` | Sprint where the work was **completed** — set when status is `done`, null if `to-do` or `doing` |
| `target` | `dev` for maintainer stories, `user` for user stories — mirrors `role` |
| `position` | `0` default — user reorders via drag-and-drop in the UI |
| `github_url` | Leave empty unless a PR/issue exists |
| `resolution` | Leave empty unless closing a defect |

**Roles** — same as ATS:
- `<user>` artefacts → "As a Product Owner..."
- `<dev>` artefacts → "As a Maintainer of the System..."

**Rules:**
- Every story must have an observable, testable "as proven by" clause
- Keep stories small — one capability per story
- Group related stories under a shared prefix
- Never create stories for work that hasn't been done
- `origin` is never blank
- `target` always mirrors `role`: maintainer → `dev`, user → `user`
- `estimate` is never null — every story gets a Fibonacci value, split anything >13pts

---

## ustories — Update User Stories

When the user writes **`<ustories>`**, update the status and sprint delivery of user stories created in the current session.

**Prerequisite — refuse if not met:**
If no stories were created via `<mstories>` in this session, respond: *"No stories in scope. Run `<mstories>` first to create stories for the current work."*

**Process:**
1. Review all story IDs created via `<mstories>` in this session
2. Query the DB to get the **current actual state** of each story — never assume. Use Postgres (NOT SQLite):
   ```bash
   PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops -c "SELECT id, status, delivered_sprint FROM backlog_items WHERE id IN ('ID-01','ID-02',...);"
   ```
3. For each story, determine the correct new state based on current context:
   - **`doing`** — work started but not yet verified (build not run, feature incomplete)
   - **`done`** — work complete and verified (build passes, feature confirmed working)
4. Update the database via Postgres:
   ```bash
   PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops -c "UPDATE backlog_items SET status = 'done', delivered_sprint = 'sprintXXX' WHERE id = 'STORY-ID';"
   ```
5. Also scan for **defects** found during the session:
   - If defects were identified, check if they already exist in `backlog_items` with `category = 'defect'`
   - Update existing defect statuses based on whether they were fixed
   - For new defects found but not fixed, insert with `status = 'to-do'`
6. Present a summary table showing DB state before and after:

| ID | Story (truncated) | Was | Now | Sprint |
|----|-------------------|-----|-----|--------|

**Rules:**
- Only update stories that exist in the current session's scope — never touch stories from other sessions
- If a story's work was partially done, set `doing` not `done`
- Always set `delivered_sprint` when marking `done`
- Defect updates follow the same status flow: `to-do` → `doing` → `done`
