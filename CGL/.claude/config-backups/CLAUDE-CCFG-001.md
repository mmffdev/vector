# Global Claude Instructions

## Custom Commands

### NCY — No Code Yet
When the user writes **NCY**, it means **do not write any code**.
Respond with only an answer, confirmation, or clarifying question. No code output of any kind.

### AGENTS — Auto-Delegation Mode
When the user writes **`<AGENTS>`** or includes **AGENTS** anywhere in their message, operate as the global agent and automatically delegate the task:
1. Read `.claude/scope-registry.json` to determine file ownership
2. Break the task into frontend/backend work (G4)
3. Spawn sub-agents via the Agent tool (G5), briefing each with its skill file:
   - Frontend work: brief agent with `.claude/commands/ufrontend.md` protocol
   - Backend work: brief agent with `.claude/commands/ubackend.md` protocol
4. Follow execution rules: zero file overlap → parallel; co-owned files → sequential (global first, then backend, then frontend)
5. After each agent completes, check for handoff files (G6) and spawn follow-up agents if needed
6. Verify builds pass (G7) and report the combined result
7. Update `globalActions` timestamps in `AgentManagementPage.tsx` for actions performed (G1–G10)

### showbranches
When the user writes **showbranches**, run:
```
git for-each-ref --format='%(refname:short)|%(creatordate:format:%Y-%m-%d %H:%M)' refs/heads/ refs/remotes/origin/
```
Pair local branches with their `origin/` counterparts and present as a table:
**Local** | **Remote** | **Date**
Only show `main` and `sprint*` branches. Sort by branch name.

### mycopyright
When the user writes **mycopyright**, substitute it with:
**Copyright © 2026 MMFFDev. All rights reserved.**

### debugtable — Grid/Table Debug Borders
When the user writes **debugtable** or **debugtable on**, add `border: 1px solid red; /* DEBUG */` to every cell and the outer container of the grid/table currently being worked on:
1. Identify the CSS file for the grid/table currently being discussed or last edited.
2. Add the debug border to the outer container rule and all cell selectors (`> span`, `> td`, `> th`, or equivalent direct-child cell rules).
3. Tag each added line with `/* DEBUG */` so they are easy to find.

When the user writes **debugtable off**, remove all lines containing `/* DEBUG */` from the target CSS file.

**Rules:**
- Never commit debug borders — always strip before any commit.
- If the target grid/table is ambiguous, ask which one.

### ATS — Add To Scope
When the user writes **`<ATS>`** followed by a feature description (or when scope items need to be created for any reason), automatically break the feature into **user stories** in this format:

**Format:**
```
As a [role], I want [capability], so that [benefit], as proven by [acceptance criteria].
```

**Process:**
1. Read the feature description or discussion context
2. Identify distinct pieces of value from the user's perspective
3. Write each as a user story with all four clauses
4. Assign sequential IDs using the convention `{AREA}-{SEQ}` (e.g. `SU-NET-01`, `DG-04`, `DB-12`)
5. Present the stories in a table for review
6. On confirmation, write them into `web/src/data/sprints.json` under the current sprint's `backlog` array

**Personas** (pick based on artefact area):
- **`<dev>` artefacts** → "As a maintainer of the system..." (building, debugging, extending the platform)
- **`<user>` artefacts** → "As a member of the DevOps Team..." (using the platform to manage Docker)
- **Specialised**: "junior DevOps engineer" (needs guardrails), "senior DevOps engineer" (advanced control), "backend process" (automated, use sparingly)

**Rules:**
- Every scope item in `sprints.json` (backlog, planned, featuresAdded, featuresRemoved) MUST use this format going forward
- The "as proven by" clause must be **observable and testable** — not vague ("it works") but specific ("the YAML output contains a `networks:` top-level key with the user's network definitions")
- Keep stories small — if a story has more than one "and" in the capability clause, split it
- Group related stories under a shared prefix (e.g. `SU-NET-` for Spin Up Networking)
- When retrofitting old items, preserve the original technical detail but wrap it in the user story structure

### mstories — Make User Stories
When the user writes **`<mstories>`**, create user stories for the work done in the current session and write them to the database.

**Prerequisites — refuse if not met:**
1. An **action plan** or **approved design** must exist in the current session. This includes: plan mode was used, a clear scope of work was discussed and agreed, OR a design/plan was presented and the user confirmed it. If none of these exist, respond: *"No scope defined. Use plan mode or describe the feature first, then run `<mstories>`."*
2. Work must have been **implemented OR planned and approved**. If the plan has been approved but code hasn't been written yet, create stories with `status = 'to-do'` (not `done`). If code has been written and verified, create stories with `status = 'done'`.

**Process:**
1. Review all work done in the current session — files created, modified, endpoints added, features built
2. Identify area prefixes needed (e.g. `FT`, `RES`, `SW`). For each prefix, query the DB to find the last used ID:
   ```bash
   sqlite3 backend/data/wppc.db "SELECT id FROM backlog_items WHERE id LIKE 'FT-%' ORDER BY id DESC LIMIT 1;"
   ```
   Use the next sequential number. Never guess — always query first.
3. Break the work into user stories following the ATS format:
   ```
   As a [role], I want [capability], so that [benefit], as proven by [acceptance criteria].
   ```
4. Present the stories in a table for user review (IDs are guaranteed correct from step 2)
5. On confirmation, insert into the `backlog_items` table:
   ```sql
   INSERT INTO backlog_items (id, user_story, role, status, category, origin, assigned_sprint, delivered_sprint, target, position)
   VALUES ('ID', 'full story text', 'role', 'status', 'category', 'sprintXXX', 'sprintXXX', 'sprintXXX', 'user|dev', 0);
   ```

**Field mapping:**

| Field | Rule |
|---|---|
| `id` | `{AREA}-{SEQ}` — area prefix + sequential number (e.g. `FT-01`, `RES-03`) |
| `user_story` | Full "As a... I want... so that... as proven by..." text |
| `role` | `maintainer` for dev artefacts, `user` for user artefacts |
| `status` | `done` if work complete, `doing` if in progress, `to-do` if planned |
| `estimate` | Leave null unless the user provides one |
| `category` | Short grouping label matching the area (e.g. `FeatureTable`, `Research`, `Logs`) — reuse existing categories before creating new ones |
| `origin` | Sprint where the story was **created** — always the current sprint, **never blank** |
| `assigned_sprint` | Sprint where the work is planned/done — usually same as origin |
| `delivered_sprint` | Sprint where the work was **completed** — set when status is `done`, null if `to-do` or `doing` |
| `target` | `dev` for maintainer stories, `user` for user stories — mirrors `role` |
| `position` | `0` default — user reorders via drag-and-drop in the UI |
| `github_url` | Leave empty unless a PR/issue exists |
| `resolution` | Leave empty unless closing a defect |

**Roles** — same as ATS:
- `<user>` artefacts → "As a member of the DevOps Team..."
- `<dev>` artefacts → "As a Maintainer of the System..."

**Rules:**
- Every story must have an observable, testable "as proven by" clause
- Keep stories small — one capability per story
- Group related stories under a shared prefix
- Never create stories for work that hasn't been done
- `origin` is never blank
- `target` always mirrors `role`: maintainer → `dev`, user → `user`

### ustories — Update User Stories
When the user writes **`<ustories>`**, update the status and sprint delivery of user stories created in the current session.

**Prerequisite — refuse if not met:**
If no stories were created via `<mstories>` in this session, respond: *"No stories in scope. Run `<mstories>` first to create stories for the current work."*

**Process:**
1. Review all story IDs created via `<mstories>` in this session
2. Query the DB to get the **current actual state** of each story — never assume:
   ```bash
   sqlite3 backend/data/wppc.db "SELECT id, status, delivered_sprint FROM backlog_items WHERE id IN ('ID-01','ID-02',...);"
   ```
3. For each story, determine the correct new state based on current context:
   - **`doing`** — work started but not yet verified (build not run, feature incomplete)
   - **`done`** — work complete and verified (build passes, feature confirmed working)
4. Update the database:
   ```sql
   UPDATE backlog_items SET status = 'done', delivered_sprint = 'sprintXXX' WHERE id = 'STORY-ID';
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

### addpaper — Add Research Paper (Zero-Registration)
When the user writes **`<addpaper>`** followed by a topic/prompt, create a new research paper. **No registration needed** — ResearchPage auto-discovers articles via `import.meta.glob`.

**Steps:**
1. **Find next ID**: `ls web/src/components-dev/research/ResearchR*.tsx | sort | tail -1` → extract number, increment
2. **Create ONE file**: `web/src/components-dev/research/ResearchR0XX.tsx`
3. **That's it** — no edits to ResearchPage.tsx, no imports, no arrays. The glob picks it up automatically.

**File template** (every article MUST export `meta` + default component):
```tsx
import React from 'react';
import { FeatureTable, type Column } from '../../features/tables/feature_table_index';

export const meta = { id: 'R0XX', title: 'TITLE', category: 'CATEGORY', date: 'YYYY-MM-DD' };

const h2Style: React.CSSProperties = { color: 'var(--color-primary)' };

// ... table data arrays and column definitions ...

const ResearchR0XX: React.FC = () => (
  <>
    <h1 className="ui-page-heading prefix-dev">R0XX — TITLE</h1>
    {/* sections with <h2 style={h2Style}>, FeatureTable instances, <pre> code blocks */}
    <p className="doc-subtitle">Research compiled YYYY-MM-DD — one-line summary</p>
  </>
);

export default ResearchR0XX;
```

**Categories** (reuse existing): Architecture, DevOps, Competitive, Strategy, Database, Infrastructure, Feature Profiles, Design, System

**Output format depends on research type:**
- **Products/tools/platforms** → Feature Profiles: catalogue what each feature does, how it works, what problem it solves, and how the source categorises it. Pure intelligence gathering — no user stories, no gap analysis, no backlog items.
- **Topics/concepts/questions** → General Analysis: summary, key findings, detailed analysis, data tables, sources.

**Rules:**
- Every data table uses `FeatureTable` with typed columns — never raw HTML tables
- Code blocks use `<pre style={codeBlock}>` with mono font and overflow-x
- Research the topic thoroughly (web search, codebase analysis) before writing
- `meta.id` in the export MUST match the filename number
- Build verify: `cd web && npx vite build`

### Page Shortcuts
When the user types a shortcut alone (e.g. `<AR>`), it means **reference that page** — read it, or update it if context demands.
When the user adds a **u** prefix (e.g. `<uAR>`), it means **explicitly update that page** with relevant changes from the current context.

**User Pages** — public-facing, functionality only. MUST NEVER contain sensitive data (internal file paths, API keys, database schemas, dev tooling details, sprint internals).

| Shortcut | Page | File |
|----------|------|------|
| `<AR>` | Architecture | `web/src/components-user/ArchitecturePage.tsx` |
| `<RM>` | Readme | `web/src/components-user/ReadmePage.tsx` |
| `<GS>` | Getting Started | `web/src/components-user/GettingStartedPage.tsx` |
| `<CP>` | Copyright | `web/src/components-user/CopyrightPage.tsx` |
| `<TC>` | Terms and Conditions | `web/src/components-user/TermsPage.tsx` |
| `<PR>` | Privacy | `web/src/components-user/PrivacyPage.tsx` |
| `<CO>` | Contact | `web/src/components-user/ContactPage.tsx` |

**Dev Pages** — internal, CAN and SHOULD contain sensitive implementation detail (file paths, schemas, sprint scope, defect lists, internal architecture).

| Shortcut | Page | File |
|----------|------|------|
| `<SC>` | Scope / Sprints | `web/src/data/sprints.json` |
| `<AS>` | Asset Register | `web/documents/asset-register.json` |
| `<PA>` | Platform Architecture | `web/src/components-dev/PlatformArchitecturePage.tsx` |
| `<SP>` | Sprints | `web/src/components-dev/SprintsPage.tsx` + `web/src/data/sprints.json` |
| `<DE>` | Defects | `web/src/components-dev/DefectsPage.tsx` + `web/src/data/defects.json` |
| `<DV>` | Development | `web/src/components-dev/DevelopmentPage.tsx` |
| `<TE>` | Testing | `web/src/components-dev/TestingPage.tsx` |
| `<RE>` | Research | `web/src/components-dev/ResearchPage.tsx` |
| `<SL>` | System Logs | `web/src/components-dev/DevLogsPage.tsx` |
| `<PJ>` | Project | `web/src/components-dev/ProjectPage.tsx` |
| `<PP>` | Project Plan | `web/src/components-dev/ProjectPlanPage.tsx` |
| `<PS>` | Project Scope | `web/src/components-dev/ScopePage.tsx` |

**Group Shortcuts:**

| Shortcut | Scope |
|----------|-------|
| `<USR>` | All User Pages (non-dev mode) |
| `<DEV>` | All Dev Mode Pages |
| `<ALL>` | All pages |

**Asset Register rule:** Whenever a UI element is added, removed, or amended (button, input, select, toggle, accordion, modal), update `asset-register.json` in the same change. Add or update the `data-asset-id` attribute on the DOM element to match.

### File Sync Rules

- **Documents are static JSX**: All document pages are static `.tsx` components in `web/src/components-user/` (user docs) and `web/src/components-dev/` (dev docs). No markdown parsing at runtime. When the user says "update Sprints", edit the sprints.json data file directly.
- **README.md**: The GitHub `README.md` at project root is separate from the in-app `ReadmePage.tsx`. They can diverge — the in-app version is the platform reference, the GitHub version is the repo introduction.
- **backend/data/documents/**: Contains the original `.md` source files for historical reference only. The live rendered content is in the `.tsx` components.

## Git Workflow

### Branching Model
- **`main`** is the last-known-good state. It should always be deployable.
- **`sprint0XX`** branches are created from `main` for each sprint.
- All development happens on the sprint branch, never directly on `main`.

### Agent Invocation Policy
Agents are **on-demand only** — never preloaded at sprint start. Claude decides when to spawn sub-agents based on task complexity:
- **Spawn agents** when a task has genuinely parallel frontend + backend work, or when specialist delegation protects the main context window
- **Don't spawn agents** for single-domain tasks, quick fixes, or when the overhead of delegation exceeds the benefit
- The user can still explicitly request agents via `<AGENTS>` or by invoking `/uglobal`, `/ufrontend`, `/ubackend`, `/udocs` directly

### Sprint Lifecycle
1. **Start sprint**: `git checkout main && git checkout -b sprint0XX`
2. **Work on sprint**: Commit frequently with descriptive prefixes (`sprint0XX: description`)
3. **Close sprint**: When sprint is complete, fast-forward main and tag:
   ```
   git checkout main
   git merge --ff-only sprint0XX
   git tag -m "sprint0XX: summary" vX.Y.0
   git checkout sprint0XX+1
   ```
4. **Keep the branch**: Do NOT delete sprint branches after merging. They serve as historical markers.

### When Claude Should Update Main
- **After a sprint is declared complete** by the user (e.g., "close sprint", "sprint done", "merge to main")
- Fast-forward merge only — never force merge or rebase main
- Always tag with the version number and sprint summary
- Do NOT delete the merged sprint branch — keep it locally
- Ask before pushing to remote

### Config Sync on Push
Every time code is pushed to remote (sprint close, manual push, any `git push`), sync the Claude config files and seed data to the repo:
```
# 1. Export DB seed data (automated via PreToolUse hook on git push)
curl -sf http://localhost:5175/api/dev/seed/export > /dev/null 2>&1
git add backend/data/seed/sprints.json

# 2. Sync Claude config
cp ~/.claude/CLAUDE.md .claude/CLAUDE.md
PROJECT_KEY=$(pwd | sed 's|/|-|g; s|^-||')
cp ~/.claude/projects/${PROJECT_KEY}/memory/*.md .claude/memory/
```
Then stage, commit ("sync Claude config"), and include in the push. Step 1 is handled automatically by the PreToolUse hook in `.claude/settings.json` — it detects `git push` commands and exports the database to the seed file before the push executes.

### Tagging Convention
- Format: `vMAJOR.MINOR.0` (e.g., `v1.4.0`)
- Bash-era sprints: `v0.X.0`
- Web-era sprints: `v1.X.0` (increment MINOR per sprint)
- Message: `sprint0XX: one-line summary`

### Current State
- **`main`**: `v1.12.0` — sprint012 (last completed sprint)
- Active sprint: `sprint013`
- Commit prefix: `sprint013: description`
- Runtime data files (`backend/data/projects.json`, `projects/docker-index.json`, `backend/data/volume-cache/`) are gitignored and never committed

### Remote Branch Cleanup
All sprint branches (sprint001 through sprint007) are preserved locally and on remote as historical markers. Do not delete remote branches without user confirmation.

### File Move Protocol
When moving a `.tsx` or `.ts` file to a different directory:
1. Move the file
2. Update the import in `App.tsx` (use Edit tool, not sed — sed silently fails on special characters)
3. Search for ALL other imports of that file across the codebase with `grep -rn` and update each one
4. Run `npx vite build` to verify — TypeScript may pass but Vite catches unresolved imports
5. Update PlatformArchitecturePage directory table if the file is listed there

## Documentation Sync Rules

### Architecture Page Auto-Update
When any of the following are changed, **update ARC** (`web/src/components/NewArchitecturePage.tsx`) in the same sprint session:
- New backend modules created (e.g. `docker-api.ts`)
- API endpoints added, removed, or changed
- New features added to `src/features/`
- Communication patterns changed (e.g. CLI exec → Docker API socket)
- New services, middleware, or transport layers introduced
- Directory structure changes at the backend or feature level

Do not wait to be asked. If the architecture has changed, the architecture page must reflect it.

### Mermaid Diagrams
- All diagram node/box text must be short enough to fit with 10px padding
- Keep participant names short (e.g., "WordPress" not "WordPress Container (Apache + PHP)")
- Use `<br/>` for multi-line labels instead of long single lines
- If text overflows a box, shorten it — never let text clip or overlap borders
- The `MermaidDiagram` component (`web/src/components/MermaidDiagram.tsx`) has `nodePadding: 10` and `boxTextMargin: 10` configured globally

## Code Rules

### CSS Naming Convention

**Pattern**: `ui-{function}__{element}--{modifier}`

**Prefixes by scope**:
- `ui-` — shared interactive UI elements (ui-filterbar, ui-statbox, ui-page-title)
- `prefix-` — text colour prefixes (prefix-pink, prefix-dev, prefix-blue)
- `doc-` / `dmp-` — document page styling
- Feature block names have NO prefix — they ARE the block (accordion, heartbeat, portgrid, wizard, log-viewer, volume-browser, asset-register)

**Rules**:
- Block names describe FUNCTION not LOCATION (ui-filterbar not page-toolbar, ui-statbox not summary-bar)
- Elements use double-underscore: `ui-filterbar__search`
- Modifiers use double-dash: `ui-statbox__value--success`
- State classes use `is-` / `has-` prefix: `is-active`, `has-error`
- Global classes live in `design-system.css` — never duplicate in feature/page CSS
- Feature CSS only contains classes scoped to that feature block
- Page CSS only contains overrides (e.g. max-width tweaks)

**Before naming a new class, check**:
1. Does a global class already exist for this? → Use it
2. Is this feature-specific? → Use the feature block name
3. Is this reusable across pages? → Use `ui-{function}__` prefix in design-system.css

### Feature Model
All frontend features follow this file structure:

```
web/src/features/<feature-name>/
  feature_<area>-<name>_index.ts      # barrel export
  feature_<area>-<name>.tsx            # main component
  feature_<area>-<name>_logic.ts       # business logic (optional)
  feature_<area>-<name>.css            # scoped styles
```

When the user writes **`<FE>`** followed by a description, scaffold a new feature:
1. Prompt for **area** (e.g. `network`, `docker`, `build`) and **name** (e.g. `ping`, `grid`, `wizard`) if not clear from context
2. Create the directory and files following the pattern above
3. Feature CSS uses bare block naming (no `ui-` prefix) — the feature name IS the block

Example: `<FE> network ping tool` → `web/src/features/network-ping/feature_network-ping_index.ts` etc.

### Table Standard
When building any table, use `FeatureTable` from `features/tables/feature_table_index` and its `feature_table.css`. Define columns via the `Column<T>[]` interface. For filter bars and toggle buttons adjacent to tables, use global `ui-filterbar` classes (`ui-filterbar__options`, `btn btn-ghost btn-sm ui-filterbar__pagesize`). Never create bespoke table or filter button styles in feature CSS.

### Grid / Accordion Standard
When building expandable row grids or accordion layouts, use `DockerGrid` from `features/docker-grid/` as the reference pattern. Parent rows with expand/collapse, child detail panels, stat boxes, search/filter controls, inline actions. Follow the same CSS block naming and `ui-filterbar` / `ui-statbox` integration.

### Sprint Badge Standard
Whenever a sprint identifier is displayed in the UI (headings, table cells, badges, labels, dropdowns — anywhere), always render it using the global badge system:
```tsx
import { sprintBadgeStyle } from '../utils/sprint-colors';

<span className="ui-badge ui-badge--sprint" style={sprintBadgeStyle(sprintId)}>{sprintId}</span>
```
- `sprintBadgeStyle()` returns a `--badge-rgb` CSS variable for the deterministic sprint colour palette.
- `ui-badge` provides base box styling (padding, no border-radius, no border, inherits default font).
- `ui-badge--sprint` applies the solid colour fill with white text.
- Never render sprint IDs as plain text, coloured text without a badge, or with bespoke inline styles.
- The `sprintLabel()` helper (`"sprint009"` → `"S009"`) is available but optional — prefer showing the full ID unless space is constrained.

### CSS/ID Change Reporting

Every time a CSS class, ID, or data-asset-id is added, renamed, or removed, output a change report table at the end of the response:

| # | Old Name | New Name | What It Is | Scope | Stylesheet |
|---|----------|----------|------------|-------|------------|

- **Scope**: `Global` = used across multiple pages/features. `Local` = single page/feature only.
- **Stylesheet**: The CSS file where the class is defined (not where it's consumed).
- End with **Total changes: X**
- This table is mandatory after any commit that touches class names, IDs, or data-asset-id attributes.
- NOT required for commits that only change content, logic, or non-CSS code.

### UI Alignment — Columns, Rows, and Headers
When adding or modifying UI elements that sit within a structured layout (tables, grids, accordion rows, list headers), **always verify alignment with adjacent elements**:
- New columns must have a matching header **and** a matching data cell in every row — never one without the other.
- Column widths in the CSS grid template must be updated in **all breakpoints** (desktop + responsive).
- Text alignment (left/right/center) in data cells must match the corresponding header.
- Border, padding, and font-size must be consistent with sibling columns.
- If a header row exists above data rows, read both the header and at least one data row before editing to confirm the column order and count match.
- **If alignment intent is unclear, ask before implementing.**

## Backlog Status Tracking

When working on backlog items (user stories from the database):
- **Starting work**: Set the item's status to `doing` in the database before beginning implementation
- **Finished and tested**: Set the item's status to `done` after the work is complete and verified (build passes, functionality confirmed)
- Use: `sqlite3 backend/data/wppc.db "UPDATE backlog_items SET status = 'doing' WHERE id = 'STORY-ID';"`
- Use: `sqlite3 backend/data/wppc.db "UPDATE backlog_items SET status = 'done' WHERE id = 'STORY-ID';"`
- This applies whenever you are explicitly actioning backlog items, not for general coding tasks

## Server Rules

### Never Stop the Server
**NEVER** stop, kill, restart, or send signals to the backend server process unless the user includes the **`<server>`** flag in their message.

- **`<server>` present**: Safe to restart via `curl -s -X POST http://localhost:3333/api/restart`
- **`<server>` absent**: Do NOT restart. If a restart is needed (e.g. after backend rebuild), inform the user and wait for authorisation.
- Never use `kill`, `kill -HUP`, or any signal against the backend PID directly — always use the launcher API.

## Response Rules

### Always End with DONE
Every response must end with the word **DONE** on its own line.

### No Diff Output
Do not show diff/change previews, file modification summaries, or system-reminder contents in chat. The user reads diffs in their IDE/git tooling.

**Exception**: If the user includes **-SD** (Show Diff) anywhere in their message, show the diff/change details for that response only.
