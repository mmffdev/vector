# defect — Log Defect + GitHub Issue

**Loaded on demand — read this file when the user writes `<defect>` followed by a description.**

> **Port**: Read `backend_port` from `GET /api/dev/config/backend_port` if needed. Default: `5175`.

When the user writes **`<defect>`** followed by a description, create a backlog defect AND a GitHub issue in one step:

1. **Find next ID**: Query the DB for the last DEF-XX ID:
   ```bash
   sqlite3 backend/data/wppc.db "SELECT id FROM backlog_items WHERE id LIKE 'DEF-%' ORDER BY id DESC LIMIT 1;"
   ```
   Increment the number (e.g. `DEF-27` → `DEF-28`).

2. **Build user story**: Wrap the description in standard format:
   ```
   As a [role], I want [fix], so that [impact], as proven by [acceptance criteria].
   ```
   - `maintainer` for dev artefacts, `Product Owner` for user artefacts
   - If the description is already a full story, use it as-is
   - Derive a short title (under 80 chars) from the description for the GitHub issue title

3. **Insert into DB** (unassigned, no sprint):
   ```sql
   INSERT INTO backlog_items (id, user_story, role, status, estimate, category, origin, assigned_sprint, delivered_sprint, target, position)
   VALUES ('DEF-XX', 'story text', 'role', 'to-do', NULL, 'defect', 'sprintXXX', NULL, NULL, 'dev|user', 0);
   ```
   `origin` = current sprint (from CLAUDE.md Current State). `assigned_sprint` = NULL (unassigned).

4. **Create GitHub issue**:
   ```bash
   gh issue create --repo mmffdev/MMFFDev-WPPC \
     --title "DEF-XX: short title" \
     --body "$(cat <<'EOF'
   **Defect ID:** DEF-XX
   **Origin Sprint:** sprintXXX
   **Status:** to-do

   **Description:**
   Full user story text here.
   EOF
   )" --label "bug"
   ```
   Capture the returned issue URL from the output.

5. **Update DB with issue URL**:
   ```sql
   UPDATE backlog_items SET github_url = 'ISSUE_URL' WHERE id = 'DEF-XX';
   ```

6. **Report**: Show the defect ID, GitHub issue URL, and confirmation.

**Example:** `<defect> horizontal scrollbar on research page, viewport overflow on extended content`

**Rules:**
- Always create the GitHub issue — never skip it
- `origin` is always the current sprint, never blank
- `assigned_sprint` is always NULL (unassigned) — user assigns to a sprint later
- If `gh issue create` fails (network, auth), still insert the DB record, warn about the missing issue, and print the manual `gh` command
