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
9. **Feature membership tag** — `FEAT-N` (e.g., `FEAT-1`) — applies to implementation stories; references the feature group proposed in Step 1.b and approved by the user. Feature_test stories carry `feature_id` as a first-class schema field instead.

Plus a top-level plan field: every plan declares **`tracker_group`** (kebab `<scope>-<plan-slug>`, e.g. `backend-workspace-foundation`). Every feature_test work item registers under this group in Tracker's regression library. See Step 6.5.a.

A work-item missing any of (1)–(9), or a plan missing `tracker_group`, is a **defect**. The run **fails** regardless of which steps "succeeded". You MUST:

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
7. **Allocate feature_ids `F1..Fk` from the grouping** proposed in Step 1.b and approved by the user. Record `FEAT_TAGS = {story_id → "FEAT-N"}` for every implementation story. Record `FEATURES = [{id: "F1", name, covers: [story_id, ...]}, ...]`. Feature_test stories carry `feature_id` as a schema field (Step 5) — they do NOT take a `FEAT-N` tag.
8. **Allocate `TRACKER_GROUPS` and provision them.** Tracker groups carry a single `framework` (`go` | `vitest` | `playwright` | `selenium` | `mixed`), so a plan whose feature_tests span multiple frameworks needs **one group per framework**. Decide the set now:

   - **Single-framework plan** (e.g. all-Go backend slice): `TRACKER_GROUPS = [{slug: "<scope>-<plan-slug>", framework: "<framework>", pkg|paths: <selector>}]`.
   - **Multi-framework plan** (Go + vitest, e.g. PLA-0054 where TEST(F3) is Go and TEST(F4–F6) are vitest): `TRACKER_GROUPS = [{slug: "<plan-slug>-go", framework: "go", pkg: "<patterns>"}, {slug: "<plan-slug>-vitest", framework: "vitest", paths: "<globs>"}]`. Each feature_test work item in Step 5.b declares its own `tracker_group` matching its framework.
   - **Naming convention:** single-framework → `<scope>-<plan-slug>`; per-framework split → `<plan-slug>-<framework>`.

   **Then provision each group via `rg-runner -create-if-missing`** so the skill (not the operator) does the plumbing:

   ```
   RG_API_KEY=trk_xxx go run /path/to/MMFFDev\ -\ Tracker/backend/cmd/rg-runner \
     -create-if-missing \
     -group <slug> \
     -framework <go|vitest> \
     -pkg './internal/foo/... ./internal/bar/...'   # go only
     -paths 'app/components/__tests__/**/*.test.{ts,tsx}'  # vitest only
     -dry-run -target <REPO_ROOT>
   ```

   The runner is idempotent — an existing group is reused as-is (config not overwritten). `-dry-run` ensures the provisioning step does not actually execute tests. Run once per group in `TRACKER_GROUPS`.

   **Soft-fail conditions:** if `RG_API_KEY` is unset or Tracker is unreachable, surface a warning ("could not provision tracker_group(s) — `<slugs>`; confirm before the first feature_test commit") and proceed with plan authoring. Plan authoring does not block on Tracker being down.

   See Step 5.d for the runtime contract.

**Self-check:** Can you state exact values for `STORY_IDS`, `PH_TAG`, `FE_TAG`, `PLAN_ID`, `FEATURES`, `FEAT_TAGS`, and `TRACKER_GROUP` before proceeding? If any is "I'll figure it out later", stop and complete it now.

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

### 1.a — Numbered story list

Present a numbered list for user approval. Annotate each line with its proposed feature group `[F<N>]` (assigned in Step 1.b):

```
1. <Story title>  [F1]
   AC: <one-line acceptance criterion>

2. <Story title>  [F1]
   AC: <one-line acceptance criterion>

3. <Story title>  [F2]
   AC: <one-line acceptance criterion>
```

### 1.b — Propose feature grouping (BLOCKING)

A **feature** is the smallest vertical slice that can be regression-tested end-to-end and observed as one thing being done (e.g. "workspace clamp end-to-end" = JWT claim + resolver + schema + two services; a single test suite proves all of it together). Every implementation story belongs to exactly one feature group; each feature group earns exactly one `feature_test` work item in Step 5.

Cluster the stories from 1.a into feature groups. Then render:

```
Proposed feature groups:
  F1 — <feature name>: stories 1, 2
  F2 — <feature name>: stories 3
```

**Single-story features are valid** — when a story is its own observable slice (a docs page, a standalone migration with no service consumer yet, a one-shot infra change), the feature group is 1 story and the feature_test is calibrated to what's observable for that slice (a migration smoke, a build check, etc.). There is **no exemption mechanism**; every story belongs to a feature.

Ask: "Approve all stories and the proposed grouping, or revise? (e.g. 'approve all', 'create 1,3,5', 'move story 3 to F1')."

Record the approved grouping in Step 0 sub-step 7 as `FEATURES = [{id, name, covers}, ...]`.

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
- [ ] **Feature membership** (85%+): implementation story carries a valid `FEAT-N` tag pointing to an approved feature group in `FEATURES` (Step 0 sub-step 7). NOT "no group", NOT "TBD", NOT "we'll figure it out". Feature_test stories are exempt from this check — they carry `feature_id` as a schema field instead.

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

For each story passing Steps 0–4, compose a `work_item_backlog` entry that will be persisted by Step 6.5. Two shapes are supported: **implementation** (default) and **feature_test**.

### 5.a — Implementation work item

```json
{
  "order": <1-based ordinal in this run>,
  "title": "NNNNN — <Title>",
  "story_id": "NNNNN",
  "card_url": null,
  "status": "todo",
  "kind": "implementation",
  "feature_id": "F<N>",
  "description": "<see implementation description format below>",
  "tags": ["AIGEN", "PH-NNNN", "FE-AAA-NNNN", "EST-F#", "RISK-LOW|MED|HIGH", "PLA-NNNN", "FEAT-N"]
}
```

Implementation description format:

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

### 5.b — Feature_test work item (one per feature group)

```json
{
  "order": <1-based ordinal in this run; MUST be the lowest in this feature group>,
  "title": "NNNNN — TEST(F<N>): <suite name>",
  "story_id": "NNNNN",
  "card_url": null,
  "status": "todo",
  "kind": "feature_test",
  "feature_id": "F<N>",
  "feature_name": "<feature name approved in Step 1.b>",
  "covers": ["<story_id>", "<story_id>", "..."],
  "tracker_group": "<TRACKER_GROUP from Step 0 sub-step 8>",
  "description": "<see feature_test canonical description below>",
  "tags": ["AIGEN", "PH-NNNN", "FE-AAA-NNNN", "EST-F#", "RISK-LOW|MED", "PLA-NNNN"]
}
```

**Red-green ordering rule:** the feature_test entry's `order` value MUST be lower than every implementation story it covers. The red commit for the suite ships before any implementation story in the group; each covered implementation story's `status` may not flip to `completed` until the suite is green for that story's assertions.

Feature_test canonical description (use verbatim — only the bracketed `<...>` fields change):

```
## As a backend/frontend engineer, I wish a single feature-level test suite covering feature F<N> (<feature name>), so that the suite becomes a permanent regression check in Tracker's library and meaningful end-to-end coverage replaces per-story plumbing tests.

**Covers stories:** <story_id>, <story_id>, ...

<one-paragraph description of the suite scope>

## Red-Green Protocol (HARD RULE)

1. **RED:** write the failing suite below. Test must fail on `main` because <reason>. Commit: `test(<area>): red — F<N> <name> [<test-story-id>]`. Register in Tracker under group `<tracker_group>`, feature `F<N>`.
2. **GREEN:** stories <covered-ids> land in order; each implementation moves the needle on this suite. The final covered story's green commit must turn this suite green.
3. **REGRESSION LOCK:** suite stays in Tracker library; future plans' Tracker runs re-execute it on every push.

## Test scope (one suite, multiple assertions)

- <observable assertion 1>
- <observable assertion 2>
- ...

## Acceptance Criteria

- **As Proven by RED commit:** suite committed and failing on `main`; Tracker dashboard `<tracker_group>/F<N>` shows status=fail.
- **As Proven by GREEN commit:** after covered stories merge, the suite passes; Tracker run = pass.
- **As Proven by regression entry:** suite registered in Tracker's library so future plans' runs re-execute it.

---
_Agent: stories | <DATE> | <BRANCH>_
```

### 5.c — Mandatory tags

**Implementation stories** carry 7 mandatory + 1 optional:

1. `AIGEN`
2. `PH-NNNN` (from Step 0: `PH_TAG`)
3. `FE-AAA-NNNN` or `FE-AAA-BBB-NNNN` (from Step 0: `FE_TAG`)
4. `EST-F#` (Fibonacci F0–F13)
5. `RISK-LOW` / `RISK-MED` / `RISK-HIGH`
6. `PLA-NNNN` (from Step −1.e: `PLAN_ID`)
7. `FEAT-N` (from Step 0 sub-step 7: `FEAT_TAGS[story_id]`)
8. `MULTI-AGENT` (optional) — only when the story qualifies as parallel-safe: touches only its own files, no migrations on shared tables, no shared service state, not blocked by another card in this batch. When in doubt, leave it off — false positives cause merge conflicts.

**Feature_test stories** carry 6 mandatory (no `FEAT-N` — the `feature_id` schema field is canonical): `AIGEN`, `PH-NNNN`, `FE-AAA-NNNN`, `EST-F#`, `RISK-LOW|MED`, `PLA-NNNN`.

### 5.d — rg-runner contract (verified 2026-05-16)

The runner lives at `backend/cmd/rg-runner` in the sibling `MMFFDev - Tracker` repo. Its model:

- **Groups live in Tracker** (slug + framework + test-selector config). The skill provisions groups itself in Step 0 sub-step 8 via `rg-runner -create-if-missing`, so no manual UI step is needed before authoring or before the first feature_test commit. Existing groups are reused as-is (idempotent).
- **The runner takes a group slug + a target project path**. It spawns the group's framework against `-target` (e.g. `go test -json ./...` or `vitest --reporter=json`), parses results as they stream, and POSTs each test outcome to Tracker. Red/green is derived per-test from the result stream — there is no `--status`/`--story`/`--commit` flag.
- **Auth is via project-clamped PAT.** `RG_API_KEY=trk_xxx` (see `.claude/memory/project_tracker_rg_api_key.md`); `project_id` is inherited from the key, so no `--project` flag.

**Verified flags** (`rg-runner --help` as of 2026-05-16):

| Flag | Env fallback | Purpose |
|---|---|---|
| `-api-key <token>` | `RG_API_KEY` | Tracker PAT |
| `-target <path>` | `RG_TARGET` | absolute path to the project codebase under test |
| `-group <slug>` | — | group slug to run, or `all` for every group visible to the key |
| `-tracker-url <url>` | `RG_TRACKER_URL` | Tracker base URL (default `http://localhost:5102`) |
| `-force` | — | cancel any in-flight run before starting |
| `-dry-run` | — | resolve group + print run command without executing |

**Canonical invocations.**

Single-group run (per feature, e.g. after a green commit on PLA-0053 F1):

```
RG_API_KEY=trk_xxx \
  go run /path/to/MMFFDev\ -\ Tracker/backend/cmd/rg-runner \
  -group backend-workspace-foundation \
  -target /path/to/MMFFDev\ -\ Vector
```

Regression sweep (every Tracker-registered group for this project's PAT):

```
RG_API_KEY=trk_xxx rg-runner -group all -target /path/to/MMFFDev\ -\ Vector
```

**Red-green mapping.** The runner does not POST a "red commit" or "green commit" event — those concepts live at the commit/Tracker-dashboard level. The protocol the skill enforces is:

1. **RED:** commit the failing test suite first (`test(<area>): red — F<N> <name> [<test-story-id>]`); then run `rg-runner -group <slug> -target .` locally. The run row in Tracker shows the suite at `status=fail` because the implementation hasn't landed.
2. **GREEN:** after every covered implementation story lands, run `rg-runner -group <slug>` again. The run row in Tracker shows the suite at `status=pass`. The green commit's message includes the implementation story id (`feat(<area>): <description> [<story-id>]`).
3. **REGRESSION LOCK:** the group stays registered in Tracker; future plans' rerun (`rg-runner -group all`) re-executes the suite on every push.

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
- `tracker_group` — `TRACKER_GROUP` from Step 0 sub-step 8 (kebab `<scope>-<plan-slug>`; e.g. `backend-workspace-foundation`). Mandatory on every new plan. Two active plans MUST NOT declare the same `tracker_group` unless deliberately co-shipping (Step −1.c will warn).
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
- [ ] Every implementation work item carries the full mandatory tag set (AIGEN, PH-, FE-, EST-F#, RISK-, PLA-, **FEAT-N**).
- [ ] Every feature_test work item carries `kind: "feature_test"`, `feature_id`, `feature_name`, non-empty `covers`, and matches the plan's `tracker_group`.
- [ ] Every approved feature group in `FEATURES` has **exactly one** `feature_test` work item.
- [ ] Every `feature_test` description contains the 3 mandatory AC (RED commit, GREEN commit, regression-lock).
- [ ] Plan declares `tracker_group` and it follows the `<scope>-<plan-slug>` convention.
- [ ] `docs/c_plan_index.md` "Last issued" matches the highest plan ID on disk.

If any check fails: fix it now. Do not proceed to Step 6.6 / 7 with a half-written plan.

---

## Step 6.6 — Feature-test parity check (BLOCKING)

Cross-validate the work_item_backlog against the approved `FEATURES` set. The skill **rejects the run** on any of the following:

- A feature group in `FEATURES` has no `feature_test` work item.
- A feature group has more than one `feature_test` work item.
- A `feature_test` `covers` entry refers to a `story_id` that does not appear in this run AND is not already `status: "completed"` in the merged target plan. (Feature tests CANNOT be authored in isolation — every covered story must be present in this `/stories` invocation or already shipped.)
- A `feature_test` work item's `order` is not the lowest in its feature group's segment.
- An implementation story's `FEAT-N` tag does not match any feature in `FEATURES`.

On rejection: surface the specific defect (`⚠ feature group F2 has no feature_test`) and STOP. Do not write the report. Do not flip `status: "todo"` on any story. The plan file remains on disk but is flagged as inconsistent.

---

## Step 7 — Report

Print a summary. Each created work item line MUST list its actual tags. Lead with the plan written/merged in Step 6.5 and the feature-coverage block:

```
Plan: PLA-0001 — <plan title> (dev/plans/PLA-0001.json)
  • new | merged into existing
  • Tracker group: backend-workspace-foundation
  • Feature groups: 2 | feature tests: 2 | impl stories: 6
  • work items: N | acceptance criteria: M

Feature coverage:
  F1 — Workspace clamp end-to-end       (test 00601 covers 00575, 00576, 00577, 00578, 00579)
  F2 — Frontend workspace awareness     (test 00602 covers 00580)

Wrote N stories to PLA-0001 (phase PH-0005, feature FE-DEV-0001):
  ✓ 00575 — <title>  [AIGEN, PH-0005, FE-SEC-0013, EST-F5, RISK-MED, PLA-0001, FEAT-1]
  ✓ 00580 — <title>  [AIGEN, PH-0005, FE-UI-0020, EST-F2, RISK-LOW, PLA-0001, FEAT-2]
  ✓ 00601 — TEST(F1): workspace clamp end-to-end integration suite  [feature_test, F1, covers 5]
  ✓ 00602 — TEST(F2): useActiveWorkspace + per-workspace cache key vitest suite  [feature_test, F2, covers 1]
  ✗ <title> — skipped (duplicate of 00018 in PLA-0007)

View: Dev Setup → Plans tab → PLA-0001
```

Warning conditions (surface before the "View:" line; do NOT report success while any apply):

- `⚠ 00050 — <title> — MISSING [EST-F3]` — work item under-tagged.
- `⚠ feature group F<N> has no feature_test` — parity-check failure from Step 6.6 (this should already have stopped the run; if it surfaces here something has gone wrong).
- `⚠ feature_test 00601 covers story_id 00999 not present in run or completed elsewhere` — orphan cover.
- `⚠ implementation story 00050 tag FEAT-9 does not match any feature in FEATURES` — tag drift.
