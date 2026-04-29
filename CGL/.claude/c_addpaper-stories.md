# c_addpaper-stories — Propose Stories from Research

**Loaded on demand — read this file when user says **"yes"** to story generation after `<addpaper>` or `<research> --page` completes.**

This protocol is **research-specific**. It synthesises story candidates, presents them for review, and integrates accepted stories into the TSX file + DB. The actual DB insertion delegates to `c_mstories-protocol.md` (reuses existing story machinery).

---

## What You're Given

At this point:
- Research paper TSX file exists: `web/src/components-dev/research/ResearchRXXX.tsx`
- `actionPlanData` array is empty
- The h1 has no badge spans yet
- User has said "yes" to stories

---

## Step 1: Synthesise Story Candidates

Read the compiled research content (from the Executive Summary and Detailed Findings sections). Identify 1–5 actionable stories that would result from **acting on the research**.

**Examples:**

| Research Topic | Story Candidates |
|---|---|
| Docker Swarm networking | `DOCKER-NN: Upgrade orchestration to Swarm`, `INF-NN: Add Swarm network monitoring` |
| Deeplink routing upgrade | `DL-NN: Implement deep-link handler`, `NAV-NN: Update routing for deep links`, `LCH-NN: Add link preview metadata` |
| Vite 6 features | `BUILD-NN: Upgrade Vite to v6`, `PERF-NN: Adopt Vite 6 performance improvements` |

**Criteria:**
- Only if the research describes **actionable technical work** (not pure intelligence gathering)
- 1–5 stories max per paper
- Each story must be independently valuable (don't make one story that's really 3)

**If no stories fit:** Print **"This research is pure intelligence gathering — no action items."** and stop. User's answer was "yes" but the content doesn't warrant stories — that's OK.

---

## Step 2: Determine Area Prefixes

For each story candidate, decide the **area prefix** (the part before the `-` in the ID, e.g., `DL`, `DOCKER`, `BUILD`).

The prefix should:
- Match existing prefixes in the backlog if possible (check backlog_items table)
- Be 2–6 characters, all caps, meaningful (e.g., `DL` for deeplinks, `INF` for infrastructure)
- Map to a category in `CATEGORY_MAP` (see `/Users/rick/Documents/MMFFDev-Projects/mmff-Ops/web/src/utils/category-colors.ts`)

**Query the DB for each prefix:**

```bash
sqlite3 /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/backend/data/ops.db \
  "SELECT id FROM backlog_items WHERE id LIKE 'PREFIX-%' ORDER BY id DESC LIMIT 1;"
```

If no results, start at `PREFIX-01`. Otherwise, extract the number, increment by 1.

---

## Step 3: Draft Proposals

For each candidate, write a **full ATS user story** in this format:

```
As a [role], I want [capability], so that [benefit], as proven by [acceptance criteria].
```

**Roles** (same as `c_mstories-protocol.md`):
- `maintainer of the system` — for dev work (backend, infrastructure, tooling)
- `Product Owner` — for user-facing features

**Estimate** (Fibonacci scale):
- Assess complexity: 1 = trivial, 2 = small, 3 = medium, 5 = moderate, 8 = large, 13 = very large
- **Refuse any story >13pts** — split it into smaller stories
- Estimate is a proposal; user can override

**Example proposals:**

| ID | Story | Role | Est | Category |
|---|---|---|---|---|
| `DL-01` | As a maintainer of the system, I want to implement a deep-link handler for the user dashboard, so that external URLs can navigate to specific app sections, as proven by: the router resolves valid deep-links and loads the target page without a full reload. | maintainer | 5 | deeplinks |
| `NAV-02` | As a Product Owner, I want routing to preserve deep-link state across page reloads, so that users can share dashboard URLs with others, as proven by: a shared deep-link URL restores the exact dashboard section/filters in a fresh browser session. | user | 3 | navigation |

---

## Step 4: Present Proposal Table

Print a **read-only table** of the draft stories (do **NOT** insert yet):

| ID | Story (truncated) | Role | Est | Category |
|---|---|---|---|---|
| DL-01 | As a maintainer... implement deep-link handler... | maintainer | 5 | deeplinks |
| DL-02 | As a Product Owner... preserve deep-link state... | user | 3 | navigation |

Print instructions:

> **Review & Accept**  
> Do you want to add these stories to the backlog?  
> Options:  
> - **yes** — accept all  
> - **some** — I'll list which ones  
> - **edit** — I'll provide edits  
> - **no** — skip stories for this paper

---

## Step 5: Handle User Response

### If "yes" → Accept All
Continue to Step 6 (insert to DB).

### If "no" → Skip Stories
Print **"Stories declined — paper is complete with no action items."** Stop.

### If "some" → Selective Accept
Ask: **"Which story IDs do you want? (comma-separated, e.g., DL-01,DL-03)"**  
Filter the proposal table to only accepted IDs, then continue to Step 6.

### If "edit" → User Edits
Ask: **"Paste your edits in ATS format (one per line):"**  
Accept multiline input. Reparse into the story structure, re-estimate if needed, show updated table, confirm again.

---

## Step 6: Insert to DB

For each **accepted story**, delegate to `c_mstories-protocol.md` conventions:

**Call `<mstories>`-like insertion:**

```bash
sqlite3 /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/backend/data/ops.db \
  "INSERT INTO backlog_items (id, user_story, role, status, estimate, category, origin, assigned_sprint, delivered_sprint, target, position, project_id) \
   VALUES ('ID', 'STORY_TEXT', 'ROLE', 'to-do', EST, 'CATEGORY', 'CURRENT_SPRINT', 'CURRENT_SPRINT', NULL, 'TARGET', 0, 'stub-project');"
```

Where:
- `id` = `PREFIX-NN` (e.g., `DL-01`)
- `user_story` = full ATS text
- `role` = `maintainer` or `user` (from proposal)
- `status` = `to-do` (proposed, not yet started)
- `estimate` = Fibonacci value (1–13)
- `category` = category string (e.g., `deeplinks`, `navigation`)
- `origin` = current sprint ID (query: `SELECT id FROM sprints WHERE status = 'active' LIMIT 1;` or use a placeholder if no active sprint)
- `assigned_sprint` = same as origin
- `delivered_sprint` = NULL (not yet delivered)
- `target` = `dev` if role is `maintainer`, `user` if role is `Product Owner`
- `position` = `0` (user reorders in UI)
- `project_id` = `stub-project`

If all inserts succeed, print:

> **✓ Stories Added**  
> Inserted N stories:  
> - DL-01 (5 pts)  
> - DL-02 (3 pts)  
> ...

---

## Step 7: Update TSX Action Plan

Replace the `actionPlanData` array in `web/src/components-dev/research/ResearchRXXX.tsx`:

```tsx
const actionPlanData: ActionPlanRow[] = [
  { id: 'DL-01', story: 'As a maintainer... implement deep-link handler...', estimate: 5, category: 'deeplinks', status: 'to-do' },
  { id: 'DL-02', story: 'As a Product Owner... preserve deep-link state...', estimate: 3, category: 'navigation', status: 'to-do' },
];
```

Each row mirrors the accepted story (ID, truncated story text, estimate, category, status = `to-do`).

---

## Step 8: Inject h1 Badges

Update the h1 in `web/src/components-dev/research/ResearchRXXX.tsx` to add badge spans for each unique area prefix.

First, add the import at the top of the file (if not already present):

```tsx
import { categoryBadgeStyle } from '../../utils/category-colors';
```

Then update the h1:

```tsx
<h1 className="ui-page-heading prefix-dev">
  RXXX — TITLE
  {' '}<span className="ui-badge ui-badge--category" style={categoryBadgeStyle('dl')}>DL</span>
  {' '}<span className="ui-badge ui-badge--category" style={categoryBadgeStyle('nav')}>NAV</span>
</h1>
```

**Badge order:** Sort area prefixes alphabetically (e.g., `DL` before `NAV`).  
**Badge color:** Pass the prefix (lowercase) to `categoryBadgeStyle()`. If the prefix maps to a known category in `CATEGORY_MAP`, use that colour. Otherwise, the function uses a deterministic hash.

---

## Step 9: Build & Verify

```bash
cd web && npx tsc --noEmit && npx vite build
```

If build fails, abort and report the error.

---

## Notes

### Reuse of c_mstories-protocol.md
- **Do not re-read** `c_mstories-protocol.md` — the rules are copied here
- Story format, estimate rules, DB schema, and field mappings are defined inline
- If you need the full context (e.g., changelog posting), refer to that protocol

### Story Synthesis Quality
Use **Claude Sonnet 4.6** for story synthesis. Research findings often need interpretation and context-aware estimation — Sonnet's reasoning is stronger than Haiku 4.5.

### When to Decline Stories
Even if the user says "yes," you can still decline if:
- The research is pure product research (no tech work) — e.g., "Competitor feature survey"
- No clear actionable outcomes
- The research is exploratory with no implementation plan

### Optional: Changelog Posting
After inserting stories, you can optionally POST changelog entries for user-visible stories (target = `user`). See `c_mstories-protocol.md` for the endpoint and format. For this protocol, it's optional — the stories are the primary output.

---

## Integration Points

```
c_addpaper-stories.md
  ├─ Input: accepted stories from user review
  ├─ Output: updated TSX file + updated h1 with badges
  └─ Delegates to (via copy, not re-read): c_mstories-protocol.md conventions
      ├─ ATS story format
      ├─ ID sequence lookup
      ├─ backlog_items INSERT field mapping
      └─ Fibonacci estimate rules
```
