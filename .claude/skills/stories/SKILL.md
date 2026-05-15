---
name: stories
description: 7-gate story acceptance system; Fibonacci estimation (F0–F13); auto-split F21+; AIGEN + phase + feature + EST + RISK tags.
allowed-tools: Bash, Read, Write, Edit
---

# /stories

Turn a plan or work description into shippable user stories with a 7-gate acceptance system. Stories are persisted as entries in a `PLA-NNNN.json` plan file under `dev/plans/`. The Plans tab renders the file. Backlog management lives in plan JSON only — no external kanban.

## Workflow

1. **You invoke `/stories`** with a plan or work description.
2. **Skill drafts a plan**, reaches 95% confidence on it (asks for web access if it needs more research), searches existing research papers, and scans existing `PLA-NNNN` plans for overlap (Step −1).
3. **Skill decomposes into stories** and runs them through the 7-gate system (Steps 0–7).
4. **Skill writes the plan** to `dev/plans/PLA-NNNN.json` (Step 6.5) including every story as a `work_item_backlog` entry tagged with phase / feature area / EST / RISK / AIGEN / PLA.
5. **User reviews in the Plans tab** and decides which to work on.
6. **User says "go"** — implementation begins; status fields on the work-item entries (`todo` → `doing` → `completed`) track lifecycle.

The `/stories` skill ends after Step 7 (plan saved, ready for review). It does **not** start work — that happens after user approval.

## Hard Rules (No Exceptions)

Every work-item entry created by `/stories` MUST end the run carrying ALL of:

1. **Story ID + Title** — `NNNNN — Title` (5-digit zero-padded ID, em dash, title)
2. **AIGEN tag** — creation source marker
3. **Phase tag** — `PH-NNNN` (e.g., `PH-0005`)
4. **Feature area tag** — `FE-AAA-0001` or `FE-AAA-BBB-0001` (domain + optional sub-domain + 4-digit counter; e.g., `FE-DEV-0001`, `FE-POR-API-0001`, `FE-PAY-0001`)
5. **Estimation tag** — `EST-F#` (Fibonacci F0–F13 only; F21+ triggers automatic split)
6. **Risk tag** — `RISK-LOW` / `RISK-MED` / `RISK-HIGH`
7. **Plan tag** — `PLA-NNNN` (4-digit zero-padded; the plan this story belongs to — see Step −1 and Step 6.5)
8. **Description** — User story format with 3+ "As Proven by" acceptance criteria

A work-item missing any of (1)–(8) at end of run is a **defect**. The run **fails** regardless of which steps "succeeded". You MUST:

- **Run Step −1 BEFORE Step 0.** Step −1 produces the `PLA-NNNN` plan ID and decides whether this work merges into an existing plan or creates a new one.
- **Run Step 0 BEFORE writing any work item.** Step 0 produces the story IDs and tags every entry depends on.
- **If confidence < 85% on ANY gate, STOP.** Do not write the work-item; ask the user to revise.
- **If a story scores F21+, split automatically.** Show proposed breakdown; do NOT report intermediate steps.
- **Run Step 6.5 BEFORE Step 7.** Persist the plan JSON to `dev/plans/PLA-NNNN.json` and update `docs/c_plan_index.md`. The plan must contain every story written in this run.

---

## Step −1 — Draft Plan + 95% Confidence + Overlap Scan (BLOCKING)

This step gates everything that follows. The plan is the document the Plans tab will render. Its `PLA-NNNN` becomes a mandatory tag on every work item.

### −1.a — Draft the plan in memory

Without writing anything to disk yet, draft an outline for ALL ten plan sections (title, scope, value, implementation_plan, areas_impacted, feature_list incl. extended/removed, work_item_backlog, acceptance_criteria, risks, references). Keep it short — bullet-level is fine.

### −1.b — Self-assess confidence to 95%

For each of the ten sections, score your own confidence 0–100%. Aggregate is the **lowest** section score (the plan is only as confident as its weakest piece).

- **If any section < 95%:** identify what is missing. Two recovery paths:
  - **Search internal first.** List `dev/research/` (filenames are `RNNN.json`); if any title or summary plausibly matches your topic, read those files via the Read tool and pull the relevant facts into the plan. Re-score.
  - **Ask for web access.** If internal research did not raise confidence to 95%, output exactly:
    ```
    ⚠ Plan confidence < 95% on: <section names>
    I need to search the web to fill these gaps. Should I run /research on <topic>, or proceed with what I have?
    ```
    Then STOP and wait for the user.
- **If aggregate ≥ 95%:** proceed to −1.c.

### −1.c — Scan existing plans for overlap

Run:
```bash
ls dev/plans/ 2>/dev/null
```

Read each `PLA-NNNN.json` file's `id`, `title`, and `scope` (only those three fields — do not load full plans yet). Compare against the new plan's title and scope:

- **Title overlap:** keyword match on ≥ 2 substantive words (ignore stopwords like "the", "and", "system").
- **Scope overlap:** at least one feature/concept in the new plan's scope appears in the existing plan's scope.

If a candidate match is found, read that plan's `feature_list` and `acceptance_criteria` for a deeper check.

### −1.d — Confirm match with user OR allocate fresh PLA

**If a match is found**, output:
```
Possible overlap with existing plan:
  • <PLA-NNNN> — <title> (created <date>, <ac_done>/<ac_total> AC complete)
  • Overlap: <one-sentence summary of where they overlap>
  • Impact of new work on this plan: <what sections will be extended; which acceptance criteria become superseded>

Merge new stories into <PLA-NNNN>, or allocate a fresh PLA-NNNN for a new plan? [merge/new]
```
Wait for the user. If `merge`: reuse the existing `PLA-NNNN`, and at Step 6.5 you will update the existing plan JSON (append new work_item_backlog rows, append new acceptance_criteria rows, update `date_last_updated`). If `new`: allocate a fresh ID per −1.e.

**If no match is found**, allocate fresh per −1.e without asking.

### −1.e — Allocate `PLA-NNNN`

1. Read `docs/c_plan_index.md` for **Last issued**.
2. Scan `dev/plans/` for the highest existing `PLA-NNNN.json`.
3. `PLAN_ID = "PLA-" + str(max(file, scan) + 1).zfill(4)`.

**Self-check:** Can you state the exact value for `PLAN_ID` before proceeding to Step 0? If "I'll figure it out later", stop and complete it now.

---

## Step 0 — Allocate Story IDs and Tags (BLOCKING)

This step gates everything. Do not skip any sub-step.

1. **Read `docs/c_story_index.md`.** Note the **Last issued** ID.
2. **Scan `dev/plans/`** for the highest existing `NNNNN —` story_id across all plan JSONs. If higher than the file, use the scan value.
3. **Compute starting ID** = `max(file, scan) + 1`. Allocate one ID per story. Write them explicitly (e.g., `STORY_IDS = [00050, 00051, 00052]`).
4. **Determine phase tag** (e.g., `PH-0005`). Read `docs/c_story_index.md` for active phase. Record `PH_TAG`.
5. **Determine feature area tag.** Read `docs/c_feature_areas.md`. Tag format is `FE-AAA-0001` (single domain) or `FE-AAA-BBB-0001` (domain + sub-domain). If a matching tag exists in a prior plan, reuse it. If not, propose the new tag name to the user; on approval, record `FE_TAG`.
6. **Confirm `PLAN_ID`** is set from Step −1.e. If not, return to Step −1 — the plan tag is mandatory and must be present on every work item.

**Self-check:** Can you state exact values for `STORY_IDS`, `PH_TAG`, `FE_TAG`, and `PLAN_ID` before proceeding? If any is "I'll figure it out later", stop and complete it now.

---

## Step 1 — Parse Stories

From the user's input, extract discrete, shippable user-facing units. One work item = one thing a user can observe as done.

**Split stories if any apply:**
- The AC needs "and" / "then" to describe done — usually two observable units.
- It mixes layers that can ship independently (e.g., API endpoint + UI on top).
- It bundles a self-contained component inside a flow.
- The title is vague ("refactor", "improve", "fix", "support", "enable", "handle") — force concrete sub-units.
- You can't write a single one-line AC without hand-waving.

**Don't over-split:** If two adjacent items can't be observed as done independently, merge them.

Present a numbered list for user approval:

```
1. <Story title>
   AC: <one-line acceptance criterion>

2. <Story title>
   AC: <one-line acceptance criterion>
```

Ask: "Approve all, or specify which numbers to create (e.g., 1,3,5)?"

---

## Step 2 — Dedup Check

For each approved story title, scan every existing `dev/plans/PLA-NNNN.json` `work_item_backlog[].title`:

- `DUPLICATE` (exact title match) → skip with notice: `Skipped "<title>" — already exists as <story_id> in <PLA_ID>`
- `SIMILAR` (≥2 substantive keyword overlap) → warn and ask the user to confirm before proceeding
- `OK` → proceed to Step 3

---

## Step 3 — Confidence Gate (85%+ rule)

Before writing ANY work item, assess 85%+ confidence on these criteria. If ANY criterion < 85%, **STOP and ask the user to revise**.

### Confidence Checklist

- [ ] **Title clarity** (85%+): Title is specific, not vague. No red-flag words ("refactor", "improve", "fix", "support", "enable", "handle").
- [ ] **Persona role** (85%+): "As a <role>" names a real persona (e.g., "dev gadmin", "portfolio owner", "backend engineer"). NOT "system", "backend", "user".
- [ ] **Concrete action** (85%+): "I wish <action>" is a concrete task (e.g., "reset a portfolio model", "see a dashboard graph"). NOT "support", "enable", "handle".
- [ ] **Observable benefit** (85%+): "so that <benefit>" names an observable outcome (e.g., "so that I can start over"). NOT "so that the code is better", "so that it's cleaner".
- [ ] **Context paragraph** (85%+): Description includes a 1-paragraph context explaining why this story matters (not just what). Min 50 chars.
- [ ] **Acceptance criteria count** (85%+): Minimum 3 "As Proven by" criteria present.
- [ ] **AC verifiability** (85%+): Each criterion starts with an observable verb: "API returns", "database shows", "page renders", "user sees", "endpoint accepts". NO "and" in any single criterion.
- [ ] **Feature area assigned** (85%+): One of: POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV.
- [ ] **Estimation assigned** (85%+): F0–F13 (Fibonacci). If calculated as F21+, proceed to Step 4 (automatic split).
- [ ] **Risk assigned** (85%+): RISK-LOW, RISK-MED, or RISK-HIGH. Brief justification required if RISK-HIGH.

**If ANY criterion < 85%:**
- Output: `⚠ Story N: [REPLAN REQUIRED] — <specific reason>`
- Do NOT write the work item.
- Ask the user to clarify, revise, or split the story.
- Revised story (or split stories) are re-submitted to Step 3.

**If ALL criteria >= 85%:**
- Proceed to Step 4 (split check).

---

## Step 4 — Split Logic (F21+ Auto-Split)

If any story is estimated F21 or higher:

1. **STOP** — refuse to write the work item.
2. **Analyze** the story to find natural split points.
3. **Propose** a breakdown into smaller stories (each F13 or lower).
4. **Show the proposed list** with EST + RISK + AC for each.
5. **Do NOT report the split process** — just present the final list for approval.

**Example (no intermediate reporting):**

User submits: "Implement entire portfolio model adoption system"
Estimated: F21 (exceeds limit)

Output:
```
Story exceeds F13 complexity limit. Proposed breakdown:

1. Backend: archive old portfolio layers before adopting new model
   EST: F3, RISK: MED, Area: SQL
   AC: <acceptance criteria>

2. Backend: unadopt portfolio model from dev setup
   EST: F5, RISK: MED, Area: API
   AC: <acceptance criteria>

3. Frontend: portfolio adoption wizard (7-step flow)
   EST: F8, RISK: HIGH, Area: UI
   AC: <acceptance criteria>

4. Dev doc: portfolio model adoption action paths
   EST: F2, RISK: LOW, Area: DEV
   AC: <acceptance criteria>

Approve all 4, or revise? [y/n]
```

If user approves: treat the list as a new Step 1 input and re-run Steps 1–4 on each story.

---

## Step 5 — Compose Work Items

For each story passing Steps 0–4, compose a `work_item_backlog` entry that will be persisted by Step 6.5:

```json
{
  "order": <1-based ordinal in this run>,
  "title": "NNNNN — <Title>",
  "story_id": "NNNNN",
  "card_url": null,
  "status": "todo",
  "description": "<see description format below>",
  "tags": ["AIGEN", "PH-NNNN", "FE-AAA-NNNN", "EST-F#", "RISK-LOW|MED|HIGH", "PLA-NNNN"]
}
```

Description format (string field):

```
## As a <role>, I wish <action>, so that <benefit>

<one-paragraph context explaining the why>

## Acceptance Criteria

- **As Proven by X:** <specific, verifiable outcome>
- **As Proven by Y:** <specific, verifiable outcome>
- **As Proven by Z:** <specific, verifiable outcome>

---
_Agent: stories | <DATE> | <BRANCH>_
```

Required tags on every entry (6 mandatory + 1 optional):

1. `AIGEN`
2. `PH-NNNN` (from Step 0: `PH_TAG`)
3. `FE-AAA-NNNN` or `FE-AAA-BBB-NNNN` (from Step 0: `FE_TAG`)
4. `EST-F#` (Fibonacci F0–F13)
5. `RISK-LOW` / `RISK-MED` / `RISK-HIGH`
6. `PLA-NNNN` (from Step −1.e: `PLAN_ID`) — the plan this entry belongs to
7. `MULTI-AGENT` (optional) — only when the story qualifies as parallel-safe: touches only its own files, no migrations on shared tables, no shared service state, not blocked by another card in this batch. When in doubt, leave it off — false positives cause merge conflicts.

---

## Step 6 — Update Story Index

After all work items are composed, update `docs/c_story_index.md`:

1. Set **Last issued** to the highest allocated ID from this batch (e.g., `00052` if you created 3 stories from 00050–00052).
2. Do NOT touch the deletion log.

This MUST happen before reporting; other agents read this file to allocate their next IDs.

---

## Step 6.5 — Write Plan JSON (BLOCKING)

The plan drafted in Step −1 is now committed to disk. The Plans tab renders this file directly.

### 6.5.a — Build the plan document

Construct a `PlanDoc` (schema in [`app/api/dev/plans/route.ts`](../../../app/api/dev/plans/route.ts)) with these fields populated:

- `id` — `PLAN_ID` from Step −1.e (or the merged plan's existing id).
- `title` — drafted in Step −1.a.
- `date_created` — today's date `YYYY-MM-DD` (preserve existing if merging).
- `date_started` — `null` (set when the first work item flips to `doing`).
- `date_last_updated` — today's date for both new and merge cases.
- `date_finished` — `null`.
- `scope`, `value` — HTML strings (paragraphs, lists allowed; no `<script>`/`<style>`).
- `implementation_plan` — array of step strings.
- `areas_impacted` — array of "AAA: short description" strings.
- `feature_list`, `features_extended`, `features_removed` — arrays of strings (HTML allowed in `features_extended`).
- `work_item_backlog` — the entries composed in Step 5, in order.
- `acceptance_criteria` — flatten per-story AC into rows; each row links back to its source story via `story_id`:
  ```json
  {
    "order": 1,
    "criterion": "<the AC verb-led sentence>",
    "proven_by": "<the proof clause>",
    "story_id": "00050",
    "card_url": null,
    "done": false
  }
  ```
- `risks` — `[{ impact: 1-3, risk, mitigation }]`. Impact 3 = high.
- `references` — `[{ kind: "internal" | "external", label, href }]`. Internal hrefs are repo-relative paths.

### 6.5.b — Write or merge the file

```bash
mkdir -p dev/plans
```

**New plan:** Write the full document to `dev/plans/<PLAN_ID>.json` (pretty-printed, 2-space indent).

**Merge into existing plan** (Step −1.d returned `merge`): Read the existing JSON, then:

- Append new entries to `work_item_backlog`, continuing the `order` sequence from the highest existing order.
- Append new acceptance criteria to `acceptance_criteria`, continuing the `order` sequence.
- Optionally extend `features_extended` with new bullets (use `<strong>` to mark extensions).
- Update `date_last_updated` to today.
- Do NOT clear `date_started` / `date_finished` if already set.
- Write the merged document back to the same path.

### 6.5.c — Update `docs/c_plan_index.md`

For a **new plan**:

1. Set `**Last issued:** \`<PLAN_ID>\``.
2. Add a new row to the Plan registry table:
   ```
   | `<PLAN_ID>` | <title> | <YYYY-MM-DD> | active |
   ```

For a **merge** into an existing plan: do nothing here — the row already exists.

### 6.5.d — Self-check

Before continuing to Step 7, verify:

- [ ] `dev/plans/<PLAN_ID>.json` exists and parses as JSON.
- [ ] Every story composed in Step 5 appears in `work_item_backlog`.
- [ ] Every work item carries the full mandatory tag set (AIGEN, PH-, FE-, EST-F#, RISK-, PLA-).
- [ ] `docs/c_plan_index.md` "Last issued" matches the highest plan ID on disk.

If any check fails: fix it now. Do not proceed to Step 7 with a half-written plan.

---

## Step 7 — Report

Print a summary. Each created work item line MUST list its actual tags. Lead with the plan written/merged in Step 6.5:

```
Plan: PLA-0001 — <plan title> (dev/plans/PLA-0001.json)
  • new | merged into existing
  • work items: N | acceptance criteria: M

Wrote N stories to PLA-0001 (phase PH-0005, feature FE-DEV-0001):
  ✓ 00050 — <title>  [AIGEN, PH-0005, FE-DEV-0001, EST-F3, RISK-MED, PLA-0001]
  ✓ 00051 — <title>  [AIGEN, PH-0005, FE-DEV-0001, EST-F5, RISK-MED, PLA-0001, MULTI-AGENT]
  ✓ 00052 — <title>  [AIGEN, PH-0005, FE-DEV-0001, EST-F2, RISK-LOW, PLA-0001]
  ✗ <title> — skipped (duplicate of 00018 in PLA-0007)

View: Dev Setup → Plans tab → PLA-0001
```

If any work item ended Step 6.5.d missing tags, surface with `⚠ 00050 — <title> — MISSING [EST-F3]` so the human can intervene. **Do NOT report success while any work item is under-tagged.**
