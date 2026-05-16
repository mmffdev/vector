---
name: retro
description: Honest retrospective on the most recent work segment. 5 Whys with mandatory reversal validation, two-table heatmap output, recurring-issue ledger sync, auto-promotion to S1 tech debt after 3+ unresolved hits. Triggers on `<r>` or auto-fires when an endless loop is detected.
argument-hint: [--auto-loop] [--scope full|segment] [--note "<one-liner>"]
allowed-tools: Read Grep Glob Bash Write Edit Agent
---

# Retro Perspective Skill (`<r>`)

Honest retrospective on the **last segment** of work since the most recent "go" / "start" / approval gate. Two tables, one heatmap scale, one ledger.

## Behaviour

**Solo-dev mode triage (since 2026-05-17).** Before running the 7-gate flow, branch by trigger mode:

- **`--auto-loop`** → loop-detector circuit breaker fired. Run the full retro immediately — this path is **always on**, both modes. The loop detector is a safety rail.
- **Manual `<r>` invocation in solo-dev mode** → warn the user this is heavyweight for a solo hobby project and offer the lightweight alternative:

  ```
  Solo-dev mode is active. A full retro writes RETRO-NNN.json, updates the ledger,
  may auto-promote findings to S1 tech debt, and bumps three docs. For a solo session
  that's a lot of paperwork for one observation.

  Lightweight option: append a one-line entry to lessons.md at repo root
  (date + observation + 1-line takeaway). Pick:
    [1] full retro (the original flow below)
    [2] lessons.md one-liner (recommended for solo)
    [3] cancel
  ```

  Wait for the user's pick. `[2]` writes one line to root `lessons.md` and exits.
  `[1]` proceeds to step 1 below. `[3]` exits cleanly.

If the user passes `--full` explicitly, skip the warning and proceed straight to step 1.

1. Read `.claude/commands/c_retro.md` for the full protocol — gates, tables, ledger contract, reversal validation, sync function with self-check.
2. Determine trigger mode:
   - `--auto-loop` → invoked by the loop detector hook (sentinel file `/tmp/.claude-retro-loop-trigger` exists). Honest assessment lead-in = "Loop detected". Do NOT clear the sentinel until the retro JSON is written and the ledger is updated.
   - default → user invoked via `<r>`. Lead-in = "User invoked".
3. Determine segment scope:
   - `--scope full` → entire session jsonl
   - `--scope segment` (default) → from last "go" / "start" / approval message to now
4. Allocate `RETRO-NNN` per `docs/c_retro_index.md` (counter + zero-padded 3-digit). Scan `dev/retros/RETRO-*.json` for the highest existing N and use `max(file, scan) + 1`.
5. Run the 7-gate flow in `c_retro.md`:
   - **Gate 1** — Collect signals (toolUse counts, errors, retries, files touched, files re-read, time-on-task).
   - **Gate 2** — Cluster into findings (one finding per distinct issue or win).
   - **Gate 3** — For each finding in Table 1: 5 Whys forward, then **mandatory reversal** ("therefore X is inevitable because Y"). If any why fails reversal, the finding is downgraded to "incomplete analysis" and severity capped at 3 until the user supplies the missing link.
   - **Gate 4** — Score each Table 1 finding on the 1–5 heatmap (5=red/white = "this will keep biting us"; 1=green/white = "barely worth noting"). Score Table 2 wins on the same 1–5 scale (5=amazing).
   - **Gate 5** — Update the recurring-issue ledger (`dev/retros/LEDGER.json`):
     - Compute fingerprint `<error_class>:<file_or_endpoint>:<symptom_hash>` per Gate 3 spec.
     - If fingerprint exists: increment hit_count, append a new hit row, update `last_seen`, recompute trend (last 3 severities).
     - If fingerprint is new: create entry with hit_count=1.
     - If hit_count >= 3 AND status != resolved: auto-promote to S1 in `docs/c_tech_debt.md` (one append, idempotent on `RETRO-NNN` reference).
   - **Gate 6** — Auto-actions on activation (no gating per user directive 2026-05-04):
     - S1 / S2 candidates from Gate 5 → append to `docs/c_tech_debt.md` with `RETRO-NNN` reference.
     - CLAUDE.md proposals → write to `dev/retros/RETRO-NNN.proposed-claudemd.md` (NEVER auto-edit CLAUDE.md). User merges manually.
   - **Gate 7** — Persist the retro JSON to `dev/retros/RETRO-NNN.json` (canonical schema in `c_retro.md`). Update `docs/c_retro_index.md`.
6. Run the **mandatory step-8 self-check** (sync function in `c_retro.md`):
   - Re-read every file the retro touched.
   - Verify: retro JSON parses; every ledger entry referenced by this retro contains a `RETRO-NNN` back-reference; every tech-debt append references this retro; index counter matches.
   - **FAIL LOUD** on any gap. Roll back partial writes (delete RETRO-NNN.json, undo ledger updates by last-known-good copy, undo tech-debt append by line range).
   - Only on green: clear `/tmp/.claude-retro-loop-trigger` (if present), report success.
7. Render the two tables to chat plus a one-line link to the Dev → Retrospectives tab.

## Required outputs (every run)

| Output | Path | Failure mode |
|---|---|---|
| Retro JSON | `dev/retros/RETRO-NNN.json` | Skill fails if missing or unparseable |
| Ledger update | `dev/retros/LEDGER.json` | Skill fails if fingerprint not appended |
| Index bump | `docs/c_retro_index.md` (Last issued) | Skill fails if stale |
| Tech-debt append | `docs/c_tech_debt.md` | Skill fails if S1 promotion missed |
| Proposed CLAUDE.md edits | `dev/retros/RETRO-NNN.proposed-claudemd.md` | Optional (only if proposals exist) |

## Reversal contract (the heart of the skill)

For every "why N → why N+1" link:

> **Forward**: "Why did X happen? → Because Y."
> **Reversal**: "Therefore, given Y, X is inevitable because <causal chain>."

If the reversal cannot be stated without hand-waving, the chain is broken at that link. Annotate the broken link explicitly in the JSON and stop the chain there. The retro's honest_assessment must say "chain broken at why-N" and severity is capped at 3.

This catches the most common 5 Whys failure: stitching together correlated facts instead of causal ones.

## Two tables (chat output)

**Table 1 — Root Cause Analysis**

| order | REF | Category | Issue | 5 Whys + reversal | Resolution steps | Heatmap |
|---|---|---|---|---|---|---|
| 1 | `RETRO-NNN/01` | Process / Tooling / Knowledge / Env | one-line | inline 5 whys | numbered steps | 1–5 |

**Table 2 — What Went Well**

| order | REF | Category | Win | Why it worked | Heatmap (all green) |
|---|---|---|---|---|---|

**Heatmap rendering — dev-ui catalog only.** The Retros tab is a Dev Setup page, so the panel ([`dev/pages/DevRetrosPanel.tsx`](../../../dev/pages/DevRetrosPanel.tsx)) renders heatmap cells using `.dui-table` cells with `.dui-pill--h1` … `.dui-pill--h5` (Table 1) and `.dui-pill--w1` … `.dui-pill--w5` (Table 2) — all theme-token-driven, defined in [`dev/styles/dev-ui.css`](../../../dev/styles/dev-ui.css), no inline styles. The retro JSON output is **rendering-agnostic** — it stores `severity: 1–5`; class translation lives in the panel. Do NOT bake `ui-retro__*` (legacy) or invented class strings into the JSON. See [`docs/c_c_dev_ui_primitives.md`](../../../docs/c_c_dev_ui_primitives.md).

## Trigger modes

- **User invoked** — `<r>` from the chat. Skill runs normally.
- **Auto-loop** — Loop detector hook writes `/tmp/.claude-retro-loop-trigger` and injects a `<system-reminder>` via UserPromptSubmit. The system-reminder instructs the agent to invoke `<r> --auto-loop`. The skill detects the sentinel and tags the retro with `triggered_by: "loop-detector"` plus signal counts in `loop_signals`.

See `.claude/hooks/loop-detector.sh` for signal logic; trigger fires when **all** of these hold within a 10-minute sliding window: ≥4 same-tool repeats, no new files read, no user message, same error class on the last 3 tool results, no Edit/Write success.

$ARGUMENTS
