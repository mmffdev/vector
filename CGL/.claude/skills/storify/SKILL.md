---
name: storify
description: Convert a plan or free-form work description into a numbered story approval list, then create approved stories as cards in the Planka Backlog with ownership metadata and dedup protection.
argument-hint: [plan text or work description — or leave blank to be prompted]
---

# /storify

Turn a plan or work description into shippable user stories, get approval, then push them to Planka Backlog.

## Hard rule (no exceptions)

Every card created by /storify MUST end the run carrying ALL FOUR of:

1. `NNNNN —` prefix in the title (5-digit zero-padded story ID, em dash, then title).
2. `PH-NNNN` phase label.
3. `FE-<AREA>NNNN` feature area label (3-letter code from `docs/c_feature_areas.md` decision tree).
4. `storify` creation-source label (id `1760724305328473193`).

Plus `MULTI AGENT` (berry-red, id `1760728388919624826`) iff Step 2b qualifies it.

A card missing any of (1)–(4) at end of run is a **defect** and the run is a **failure**, regardless of which steps "succeeded". You MUST:

- Run Step 0 BEFORE any card creation. No "I'll just create the cards and label them later" — Step 0 produces the IDs the title prefix and phase label depend on.
- Run Step 3c (label verification) for every batch. Not optional. Not "if I remember". Not "skipped because the curl looked OK". The curl response is known-untrustworthy (returns success while the label silently fails to attach); Step 3c is the ONLY thing that catches this.
- If Step 3c finds any card under-labelled, retry via MCP `assign_label_to_card` until verified. Do NOT print Step 5's success report while any card is missing labels — surface the failure with ⚠ instead.
- If you cannot complete Step 0 (e.g. user hasn't told you the phase, no FE label fits and you haven't asked them to allocate one), STOP and ask. Do not create cards with placeholder labels and "fix it later".

This rule overrides any local convenience or perceived urgency. Shipping un-labelled cards breaks the agent contract downstream (cards can't be filtered, phase boards lose accuracy, story-ID gaps hide deletions). If you are in a hurry, /storify is not the tool — create one card manually with `<backlog>` instead.

## Step 0 — Allocate IDs and labels (BLOCKING — do not skip)

This step gates everything. If any sub-step is incomplete, you MUST stop and resolve it before any card is created. Treat Step 0 outputs (`STORY_IDS`, `PH_LABEL_ID`, `FE_LABEL_ID`) as required parameters of Step 3 — the curl command in Step 3 cannot run without them.

1. Read `docs/c_story_index.md`. Note **Last issued**.
2. Cross-check: scan the board's card titles for the highest existing `NNNNN —` prefix. If higher than the file value, use the scan value (means another agent bumped without committing the doc).
3. Compute starting ID = `max(file, scan) + 1`. Allocate one ID per story you'll create. Write them down explicitly (e.g. `STORY_IDS = [00025, 00026, 00027, 00028, 00029]`) — you'll paste them into Step 3.
4. Determine the **phase label** for this batch (e.g. `PH-0004`). Read `docs/c_story_index.md` to see active phase, or ask the user. If the label doesn't exist on the board, create it via REST (see template below). Record the label ID as `PH_LABEL_ID`.
5. Determine the **feature area label**. Read `docs/c_feature_areas.md` and use the decision tree (Layer 1 → Layer 2 or 3) to classify each story into exactly one 3-letter area code. Check the Registry table for an existing `FE-<AREA>NNNN` label ID. If a new counter is needed, propose the next sequential number to the user; on approval, create the label via REST (see template below), append a row to the registry, and record the label ID as `FE_LABEL_ID`.

**Label creation (use `.claude/bin/planka` helper):**
```bash
PH_LABEL_ID=$(./.claude/bin/planka create-label 1760699595475649556 "PH-NNNN" "midnight-blue" 65536)
```
For feature labels, use `tank-green` color instead.

**Self-check before continuing:** can you state, for the next message, exact values for `STORY_IDS`, `PH_LABEL_ID`, and `FE_LABEL_ID`? If any is "I'll figure it out later", stop and complete it now.

## Step 1 — Parse stories

Read `$ARGUMENTS` (or ask the user for input if blank). Extract discrete, shippable user-facing units. Grain rule: **one card = one thing a user can observe as done**. Not a task, not a file edit.

**Split stories that are too complex or ambiguous.** Before presenting, scan each candidate story and split if any apply:
- The AC needs "and" / "then" to describe what done looks like — usually two observable units.
- It mixes layers that can ship independently (e.g. correctness/orchestration logic + a transport/UI on top).
- It bundles a self-contained visual or design surface inside a flow (split the component out from the flow that uses it).
- The title is vague ("system", "support for X", "wizard") — force concrete sub-units.
- You can't write a single one-line AC without hand-waving.

Conversely, **don't over-split**: if two adjacent items can't be observed as done independently (e.g. UI phase 1 without phase 2 is half a screen), merge them. One card must be observably complete on its own.

After splitting, present the proposed split/merge changes alongside the numbered list so the user can approve the grain too.

Present a numbered approval list:

```
1. <Story title>
   AC: <one-line acceptance criterion>

2. <Story title>
   AC: <one-line acceptance criterion>
...
```

Ask the user: "Approve all, or specify which numbers to create (e.g. 1,3,5)?"

## Step 2 — Dedup check (run before each card)

For each approved story title, run the dedup check documented in `docs/c_backlog.md` (section "Dedup check").

- `DUPLICATE` → skip with notice: `Skipped "<title>" — already exists as card <id>`
- `SIMILAR` → warn and ask user to confirm before proceeding
- `OK` → proceed

## Step 2b — Parallel-safe classification

For each story that passes dedup, decide whether to also apply the `MULTI AGENT` label (id `1760728388919624826`, color `berry-red`). A story qualifies when **all** are true:
- Touches only its own files (no shared modules, no cross-cutting refactor).
- No schema changes / no pending migrations on the same tables.
- No shared service state (no handler registration, no DI wiring, no global config).
- Is not blocked by another card in the same batch (no dependency on a sibling that hasn't landed).

**Disqualifiers (common):** any migration, any backend endpoint that shares a router/DI tree with peers, anything that depends on a sibling endpoint or migration in the same batch.

**Typical qualifiers:** standalone UI stubs, pure components with mock data, single-file utility helpers, single-file constants.

When in doubt, leave it unlabelled — false-positive parallel labels cause merge conflicts.

Present the classification to the user alongside the dedup result so they can override before cards are created.

## Step 3 — Create cards

For each story that passes dedup. Use the allocated story ID (`NNNNN`) from Step 0 in the card title — the format is `NNNNN — <title>` (5-digit zero-padded, em dash, then title).

**Hard rule (no shortcuts):** every card MUST end Step 3 carrying exactly the labels specified — phase (`PH-NNNN`), feature (`FE-<AREA>NNNN`), creation source (`storify`), and `MULTI AGENT` if Step 2b qualified it. A card with missing labels is a defect; do NOT proceed to Step 4 until Step 3c verifies they are all attached. This applies regardless of which transport you use (REST, MCP, mixed).

**Do NOT use `mcp__planka__create_card` alone, and do NOT trust its `labels[]` parameter.** Verified: that field is silently broken — the schema accepts it, the server ignores it, the card is created with zero labels. Reliable paths are: (a) the REST template below (create card via curl, then POST to `/card-labels` per label), or (b) `mcp__planka__create_card` (no `labels` arg) followed by the same. Either way, Step 3c is mandatory.

**Use `.claude/bin/planka` helper:**
```bash
DATE=$(date +%Y-%m-%d)
BRANCH=$(git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
STORY_ID="00021"  # allocated in Step 0
TITLE="<story title>"
DESCRIPTION="AC: <acceptance criterion>

---
_Agent: storify | ${DATE} | ${BRANCH}_"

CARD=$(./.claude/bin/planka create-card 1760700028730475544 "${STORY_ID} — ${TITLE}" "${DESCRIPTION}")

# Apply storify label (creation source)
./.claude/bin/planka label-card "$CARD" "1760724305328473193"

# Apply phase label (PH-NNNN — id from Step 0)
./.claude/bin/planka label-card "$CARD" "<PH_LABEL_ID>"

# Apply feature label (FE-<AREA>NNNN — id from Step 0)
./.claude/bin/planka label-card "$CARD" "<FE_LABEL_ID>"

# If parallel-safe (per Step 2b), also apply MULTI AGENT label (berry-red)
# ./.claude/bin/planka label-card "$CARD" "1760728388919624826"
```

## Step 3c — Verify labels (mandatory; gate to Step 4)

After all cards in this batch are created, verify each card has its full label set. This is the only thing that catches the silent-success failure mode (label attach returns 200 but is silently dropped).

**You MUST run this command — it asserts the required label set for each card and exits non-zero on any defect. Do not paraphrase, eyeball the JSON, or claim you "checked manually" — run it verbatim, with `CARD_IDS` and `REQUIRED` filled in from this batch:**

```bash
# Comma-separated card IDs from this batch:
CARD_IDS="<id1>,<id2>,<id3>"
# Comma-separated required label NAMES (add MULTI AGENT only for parallel-safe cards):
REQUIRED="storify,PH-0004,FE-<AREA>0001"

./.claude/bin/planka verify-labels "$CARD_IDS" "$REQUIRED"
```

If the script exits 0, every card in the batch has the full required set — proceed to Step 4.

If it exits 1, one or more cards are under-labelled. **You may not proceed to Step 4 or Step 5 success reporting.** Retry the missing labels via MCP `mcp__planka__assign_label_to_card` (idempotent and reliable), then re-run this script. Repeat until exit 0. If MCP retries also fail (rare), surface in Step 5 with `⚠ <id> — MISSING [<labels>]` and stop — do not pretend the run succeeded.

## Step 4 — Update story index

After all cards are created, update `docs/c_story_index.md`:

1. Set **Last issued** to the highest allocated ID from this batch (e.g. `00025` if you created 5 cards starting at 00021).
2. Do NOT touch the deletion log — that's only for kills.

This MUST happen before reporting; other agents read this file to allocate their next IDs.

## Step 5 — Report

Print a summary. Each created card line MUST list its actual labels (from Step 3c verification, not from intent) so the reader can audit at a glance:

```
Created N cards in Planka Backlog (IDs 00021–00025, phase PH-0004, feature FE-<AREA>0001):
  ✓ 00021 — <title> (card: <card_id>) [PH-0004, FE-<AREA>0001, storify]
  ✓ 00022 — <title> (card: <card_id>) [PH-0004, FE-<AREA>0001, storify, MULTI AGENT]
  ✗ <title> — skipped (duplicate of 00018)
```

If any card ended Step 3c missing labels (and the MCP retry also failed), surface it in the report with `⚠ 00023 — <title> — MISSING [storify]` so the human can intervene.

## Key IDs (do not re-fetch)

| Thing | ID |
|---|---|
| Backlog list | `1760700028730475544` |
| Board | `1760699595475649556` |
| Label: storify | `1760724305328473193` |
