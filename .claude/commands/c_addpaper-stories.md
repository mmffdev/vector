# c_addpaper-stories — Propose Stories from Research (PM, hands off to /stories)

**Loaded on demand — read this file when the user says **"yes"** to story generation after `<addpaper>` (or `<research> --page`) completes.**

This protocol is **research-specific**. It synthesises 1–5 candidate stories from the compiled research, presents them for review, then **hands off to the project's `/stories` skill** for the actual card creation. PM uses Planka (not Postgres `backlog_items`), so all card writes go through `/stories` — never directly.

See [`.claude/skills/stories/SKILL.md`](../skills/stories/SKILL.md) for the 7-gate story acceptance system, Fibonacci estimation (F0–F13), AIGEN+phase+feature+EST+RISK label rules, and Planka card creation.

---

## What You're Given

At this point:
- A research paper exists at `dev/research/RXXX.json` (just written)
- The user has said "yes" to stories
- You have full context of the compiled findings

---

## Step 1: Synthesise Story Candidates

Read the just-written paper (or use the compiled content from the calling protocol). Identify **1–5 actionable stories** that would result from acting on the research.

**Examples:**

| Research Topic | Story Candidates |
|---|---|
| Docker Swarm networking | "Upgrade orchestration to Swarm", "Add Swarm network monitoring" |
| Deeplink routing upgrade | "Implement deep-link handler", "Update routing for deep links", "Add link preview metadata" |
| Vite 6 features | "Upgrade Vite to v6", "Adopt Vite 6 performance improvements" |

**Criteria:**
- Only if the research describes **actionable technical work** (not pure intelligence gathering)
- 1–5 stories max per paper
- Each story must be independently shippable — one card = one observable outcome
- **Decompose across all layers** before counting (PM's stories rule): backend, frontend, migration, tests. A "feature" with only the frontend card is incomplete.

**If no actionable stories fit:** Print **"This research is pure intelligence gathering — no action items to storify."** and stop. The user said "yes" but the content doesn't warrant stories — that's OK.

---

## Step 2: Draft Story Prose

For each candidate, write a **plain-English description** suitable for handing to `/stories`. Do **not** pre-fill IDs, labels, estimates, or risk — `/stories` owns all of that through the 7-gate system.

Format per story:

```
[Short title]

As a [role], I want [capability], so that [benefit].

Acceptance criteria:
- As proven by: [observable outcome 1]
- As proven by: [observable outcome 2]
- As proven by: [observable outcome 3]
```

**Roles:** see PM's section tags (`<user>`, `<gadmin>`, `<padmin>`, `<dev>`) — choose the role that matches the work's audience.

**Acceptance criteria:** PM's `/stories` skill requires **3+ "As proven by"** lines per card. Draft them up-front so `/stories` doesn't have to invent them.

---

## Step 3: Present Proposal Table

Print a **read-only table** for user review (do **NOT** invoke `/stories` yet):

| # | Title | Role | Layers touched |
|---|---|---|---|
| 1 | Implement deep-link handler | `<dev>` | backend (router), frontend (deep-link parser) |
| 2 | Preserve deep-link state across reloads | `<user>` | frontend (URL state), tests |
| 3 | Add link preview metadata | `<padmin>` | backend (OG tags endpoint), frontend (head tags) |

Print instructions:

> **Review & Accept**
> Do you want to send these to `/stories` for card creation?
> Options:
> - **yes** — accept all
> - **some** — I'll list which numbers
> - **edit** — I'll provide edits
> - **no** — skip stories for this paper

---

## Step 4: Handle User Response

### If "yes" → Accept All
Continue to Step 5.

### If "no" → Skip
Print **"Stories declined — paper is complete with no action items."** Stop.

### If "some" → Selective
Ask: **"Which numbers? (comma-separated, e.g., 1,3)"**
Filter the proposal table to only accepted entries, then continue to Step 5.

### If "edit" → User Edits
Ask: **"Paste your edits (one story per block, separated by blank lines):"**
Reparse, show updated table, confirm again before proceeding to Step 5.

---

## Step 5: Hand Off to `/stories`

Invoke the `/stories` skill (see [`.claude/skills/stories/SKILL.md`](../skills/stories/SKILL.md)) with the accepted story drafts as input. The skill takes over from here:

- **Step 0:** Allocates story IDs from `docs/c_story_index.md`, resolves phase + feature labels.
- **Steps 1–7:** Decomposes / parses, runs each candidate through the 7 gates (estimation, risk, AIGEN, label assignment, description format, decomposition check, label verification).
- **Outcome:** Cards land in **Planka Backlog** with all 7 mandatory attributes (Story ID + Title, AIGEN, phase, feature area, EST-F#, RISK-LOW/MED/HIGH, description with 3+ "As proven by"). The user reviews in Planka and decides which to start.

**Hard rules `/stories` enforces (do not try to bypass):**
- Confidence < 85% on any gate → STOP, ask user to revise
- Story scoring F21+ → automatic split, don't report intermediate steps
- Step 3c (label verification) must run for every batch

After `/stories` reports success, print:

> **✓ Cards created in Planka Backlog**
> N stories from `dev/research/RXXX.json` are awaiting review.
> Card lifecycle reminder: on "go"/"start" → cards move Backlog → To Do → Doing → Completed.

---

## Notes

### Why hand off instead of writing cards directly?
PM's `/stories` skill enforces 7 mandatory gates that protect the backlog from incomplete cards. Bypassing it would create cards missing labels, IDs, or acceptance criteria — which is a defect per the project's hard rules. Always go through `/stories`.

### Decomposition across layers
PM's **storify-all-layers rule** (`feedback_storify_all_layers.md`): before invoking `/stories`, decompose the feature across backend, frontend, migration, and tests. A research-derived story for "add deeplinks" probably needs at least three cards — one per layer. Catch this in Step 1, not after Planka is full of half-cards.

### When in doubt, decline
The user can always say `<addpaper>` again and ask for stories later. Better to write the paper without stories than to create weak cards that need rework.

---

## Integration

```
c_addpaper-stories.md
  ├─ Input: accepted story drafts from user review
  ├─ Output: invocation of /stories skill with the drafts
  └─ /stories owns: ID allocation, label rules, 7 gates, Planka card creation
```
