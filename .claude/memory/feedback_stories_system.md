---
name: Story acceptance system — AIGEN + Fibonacci + Risk gates
description: Hard gates for every story before backlog entry — 7 required attributes, confidence thresholds, split logic
type: feedback
originSessionId: eb9596cd-e90d-4375-94e7-4cb506cb339a
---
## Hard Rule: All stories must pass 7-gate acceptance system

Every card MUST carry these before exiting `<stories>` skill:
1. **ID + Title** (`NNNNN — Title`)
2. **AIGEN label** (creation source, replaces "storify")
3. **Phase label** (`PH-0005`)
4. **Feature area label** (`FE-DEV0001`)
5. **EST label** (Fibonacci: F0–F13 only; F21+ triggers automatic split)
6. **RISK label** (RISK-LOW / RISK-MED / RISK-HIGH)
7. **Description** (User story: "As a <role>, I wish <action>, so that <benefit>" + 3+ "As Proven by" criteria)

## Fibonacci Estimation (Hard Rule)

- F0 = spike/research (no impl)
- F1 = 1–2 hours
- F2 = 1–2 hours
- F3 = 2–4 hours
- F5 = 4–8 hours (half-day)
- F8 = 1–2 days
- F13 = 2–3 days **← HARD LIMIT**
- **F21+ = MUST SPLIT** (show proposed breakdown to user, don't report intermediate steps)

**Why:** Complexity > F13 indicates a story that should have been split from the start. Skill catches this and proposes breakdown.

## Risk Labels (Gate)

- **RISK-LOW** (green) = isolated, proven patterns, minimal dependencies
- **RISK-MED** (yellow) = some unknowns, moderate dependencies, integration work
- **RISK-HIGH** (red) = novel, major dependencies, schema changes, breakage potential

Risk is assessed alongside EST; together they drive whether a story should be split.

## Confidence Thresholds

- **85%+ before backlog:** All 7 gates must be >= 85% confident before card is created
- **90%+ for "Ready for Review":** If confidence drops < 90% during work, card halts and replan is triggered

## Split Logic (No Intermediate Reporting)

When `<stories>` detects a story should be split (EST >= F21 or complexity analysis suggests it):
- Skill STOPS and proposes breakdown
- Shows proposed story list with EST + RISK for each
- User approves or revises
- **Do NOT report the split process** — just present final list and ask for approval

## Replanning During Development

If confidence drops < 90% at any point:
1. Skill STOPS (does not auto-move card)
2. Re-assesses scope, EST, RISK, AC
3. Proposes replan (update AC, revise EST, split if needed)
4. Pauses until user confirms revision

No silent updates; confidence must be restored before work continues.

## Why This System

- **Fibonacci:** Complexity exponential; F13 is realistic team limit; F21+ indicates split early
- **Risk gate:** Prevents surprises; RISK-HIGH forces conversation about approach
- **85%/90% gates:** Catches ambiguity before wasted work; restores confidence if issues emerge
- **AIGEN label:** AI-generated stories are tracked separately from human-created ones
- **"As Proven by":** Forces verifiable acceptance; prevents vague "done" criteria
