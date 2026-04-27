---
name: stories
description: 7-gate story acceptance system; Fibonacci estimation (F0–F13); auto-split F21+; AIGEN + phase + feature + EST + RISK labels.
allowed-tools: Bash, Read, Write, Edit
---

# /stories

Turn a plan or work description into shippable user stories with 7-gate acceptance system, create them in Planka Backlog, then wait for user approval.

## Workflow

1. **You invoke `/stories`** with a plan or work description.
2. **Skill decomposes into stories** and runs them through the 7-gate system (Steps 0–7).
3. **Cards are created in Planka Backlog** with all required labels attached and verified.
4. **User reviews in Planka** and decides which to work on.
5. **User says "go"** — you move approved cards from Backlog → To Do and begin implementation.

The `/stories` skill ends after Step 7 (cards in Backlog, ready for review). It does **not** move cards to To Do or start work — that happens after user approval.

## Hard Rules (No Exceptions)

Every card created by `/stories` MUST end the run carrying ALL SEVEN of:

1. **Story ID + Title** — `NNNNN — Title` (5-digit zero-padded ID, em dash, title)
2. **AIGEN label** — creation source (id `1761454228267599083`, color lagoon-blue)
3. **Phase label** — `PH-NNNN` (e.g., `PH-0005`)
4. **Feature area label** — `FE-AAAANNNN` (3-letter area code + 4-digit counter; e.g., `FE-DEV0001`)
5. **Estimation label** — `EST-F#` (Fibonacci F0–F13 only; F21+ triggers automatic split)
6. **Risk label** — `RISK-LOW` / `RISK-MED` / `RISK-HIGH`
7. **Description** — User story format with 3+ "As Proven by" acceptance criteria

A card missing any of (1)–(7) at end of run is a **defect**. The run **fails** regardless of which steps "succeeded". You MUST:

- **Run Step 0 BEFORE any card creation.** Step 0 produces the IDs and labels (1–4) that every card depends on.
- **Run Step 3c (label verification) for every batch.** Not optional. Step 3c is the ONLY thing that catches silent-success label failures.
- **If Step 3c finds missing labels, retry via MCP** until verified. Do NOT report success while cards are under-labelled.
- **If confidence < 85% on ANY gate, STOP.** Do not create the card; ask the user to revise.
- **If a story scores F21+, split automatically.** Show proposed breakdown; do NOT report intermediate steps.

---

## Step 0 — Allocate IDs and Labels (BLOCKING)

This step gates everything. Do not skip any sub-step.

1. **Read `docs/c_story_index.md`.** Note the **Last issued** ID.
2. **Scan the board's card titles** for the highest existing `NNNNN —` prefix. If higher than the file, use the scan value (another agent may have incremented).
3. **Compute starting ID** = `max(file, scan) + 1`. Allocate one ID per story. Write them explicitly (e.g., `STORY_IDS = [00050, 00051, 00052]`).
4. **Determine phase label** (e.g., `PH-0005`). Read `docs/c_story_index.md` for active phase. If the label doesn't exist on the board, create it via `mcp__planka__create_label` (color: `midnight-blue`). Record `PH_LABEL_ID`.
5. **Determine feature area label.** Read `docs/c_feature_areas.md`. If a matching `FE-AAAANNNN` exists, reuse its ID. If not, propose the next sequential counter to the user; on approval, create via `mcp__planka__create_label` (color: `tank-green`). Record `FE_LABEL_ID`.

**Self-check:** Can you state exact values for `STORY_IDS`, `PH_LABEL_ID`, and `FE_LABEL_ID` before proceeding? If any is "I'll figure it out later", stop and complete it now.

---

## Step 1 — Parse Stories

From the user's input, extract discrete, shippable user-facing units. One card = one thing a user can observe as done.

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

For each approved story title, run dedup per `docs/c_backlog.md` (section "Dedup check"):

- `DUPLICATE` → skip with notice: `Skipped "<title>" — already exists as card <id>`
- `SIMILAR` → warn and ask user to confirm before proceeding
- `OK` → proceed to Step 2b

---

## Step 2b — Parallel-Safe Classification (Optional)

Decide whether to apply the `MULTI AGENT` label (id `1760728388919624826`, color `berry-red`). A story qualifies when **all** are true:

- Touches only its own files (no shared modules, no cross-cutting refactor).
- No schema changes / no pending migrations on the same tables.
- No shared service state (no handler registration, no DI wiring, no global config).
- Is not blocked by another card in the same batch.

**Disqualifiers:** any migration, any shared endpoint, anything depending on a sibling in the same batch.

When in doubt, leave unlabelled — false-positive parallel labels cause merge conflicts.

Present classification to the user before card creation so they can override.

---

## Step 3 — Confidence Gate (85%+ rule)

Before creating ANY card, assess 85%+ confidence on these seven criteria. If ANY criterion < 85%, **STOP and ask the user to revise**.

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
- Do NOT create the card.
- Ask the user to clarify, revise, or split the story.
- Revised story (or split stories) are re-submitted to Step 3.

**If ALL criteria >= 85%:**
- Proceed to Step 4 (split check).

---

## Step 4 — Split Logic (F21+ Auto-Split)

If any story is estimated F21 or higher:

1. **STOP** — refuse to create the card.
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

## Step 5 — Create Cards

For each story passing Steps 0–4:

**Hard rule:** Use `./.claude/bin/planka` helper — NEVER use curl directly. Do NOT use `mcp__planka__create_card` with `labels[]` parameter (silently broken). Reliable path:

1. Create card via `mcp__planka__create_card` (no labels).
2. Attach each label via `mcp__planka__assign_label_to_card` (one call per label).
3. Run Step 5c (verify all labels attached).

Card title format: `NNNNN — <Title>` (5-digit zero-padded ID from Step 0, em dash, then title).

Description format:
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

Required labels to attach (4 mandatory + 1 optional):
1. `AIGEN` (id `1761454228267599083`)
2. `PH-NNNN` (id from Step 0: `PH_LABEL_ID`)
3. `FE-AAAANNNN` (id from Step 0: `FE_LABEL_ID`)
4. `EST-F#` (e.g., id `1761454230876456173` for `EST-F0`)
5. `RISK-LOW/MED/HIGH` (e.g., id `1761454246445712635` for `RISK-LOW`)
6. `MULTI AGENT` (id `1760728388919624826`) — only if Step 2b qualified

---

## Step 5c — Verify Labels (Mandatory; Gates to Step 6)

After all cards in this batch are created, verify each card has its full label set. This catches silent-success failures.

**You MUST run this exact script:**

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")

# Comma-separated card IDs from this batch:
CARD_IDS="<id1>,<id2>,<id3>"
# Comma-separated required label NAMES (add MULTI AGENT only for parallel-safe cards):
REQUIRED="AIGEN,PH-0005,FE-DEV0001,EST-F3,RISK-MED"

curl -s "http://localhost:3333/api/boards/1760699595475649556" \
  -H "Authorization: Bearer $TOKEN" \
  | CARD_IDS="$CARD_IDS" REQUIRED="$REQUIRED" python3 -c "
import sys, json, os
d = json.load(sys.stdin); inc = d.get('included', {})
labels = {l['id']: l['name'] for l in inc.get('labels', [])}
byCard = {}
for cl in inc.get('cardLabels', []):
    byCard.setdefault(cl['cardId'], []).append(labels.get(cl['labelId'], cl['labelId']))
required = set(s.strip() for s in os.environ['REQUIRED'].split(',') if s.strip())
fail = 0
for cid in os.environ['CARD_IDS'].split(','):
    cid = cid.strip()
    if not cid: continue
    have = set(byCard.get(cid, []))
    missing = required - have
    if missing:
        fail += 1
        print(f'DEFECT  {cid}  missing: {sorted(missing)}  have: {sorted(have)}')
    else:
        print(f'OK      {cid}  {sorted(have)}')
sys.exit(1 if fail else 0)
"
```

If exit 0: all labels are attached; proceed to Step 6.

If exit 1: one or more cards are under-labelled. **Do NOT proceed to Step 6.** Retry missing labels via `mcp__planka__assign_label_to_card`, then re-run this script. Repeat until exit 0.

---

## Step 6 — Update Story Index

After all cards are created, update `docs/c_story_index.md`:

1. Set **Last issued** to the highest allocated ID from this batch (e.g., `00052` if you created 3 cards from 00050–00052).
2. Do NOT touch the deletion log.

This MUST happen before reporting; other agents read this file to allocate their next IDs.

---

## Step 7 — Report

Print a summary. Each created card line MUST list its actual labels (from Step 5c verification):

```
Created N cards in Planka Backlog (IDs 00050–00052, phase PH-0005, feature FE-DEV0001):
  ✓ 00050 — <title> (card: <card_id>) [PH-0005, FE-DEV0001, AIGEN, EST-F3, RISK-MED]
  ✓ 00051 — <title> (card: <card_id>) [PH-0005, FE-DEV0001, AIGEN, EST-F5, RISK-MED, MULTI AGENT]
  ✓ 00052 — <title> (card: <card_id>) [PH-0005, FE-DEV0001, AIGEN, EST-F2, RISK-LOW]
  ✗ <title> — skipped (duplicate of 00018)
```

If any card ended Step 5c missing labels (and MCP retry also failed), surface with `⚠ 00050 — <title> — MISSING [EST-F3]` so the human can intervene. **Do NOT report success while any card is under-labelled.**

---

## Key IDs (Do Not Re-Fetch)

| Thing | ID |
|---|---|
| Backlog list | `1760700028730475544` |
| Board | `1760699595475649556` |
| Label: AIGEN | `1761454228267599083` |
| Label: EST-F0 | `1761454230876456173` |
| Label: EST-F1 | `1761454233325929711` |
| Label: EST-F2 | `1761454235641185521` |
| Label: EST-F3 | `1761454237830612211` |
| Label: EST-F5 | `1761454239961318645` |
| Label: EST-F8 | `1761454242100413687` |
| Label: EST-F13 | `1761454244239508729` |
| Label: RISK-LOW | `1761454246445712635` |
| Label: RISK-MED | `1761454248593196285` |
| Label: RISK-HIGH | `1761454250866509055` |
| Label: MULTI AGENT | `1760728388919624826` |
| Label: FE-UI0002 | `1762058691722348184` |
| Label: FE-DEV0004 | `1762105753893602703` |
