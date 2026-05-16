---
name: retros-auto-only
description: Solo-dev mode — auto-loop retro stays as safety rail; manual <r> warns and offers a one-liner to lessons.md instead.
metadata:
  type: feedback
---

In **solo-dev mode** (since 2026-05-17), retros split by trigger:

- **`<r> --auto-loop`** (loop-detector circuit breaker) — **always on**. This is the safety rail that catches Claude stuck in a loop; it stays unchanged in both modes. When the hook fires, run the full 7-gate retro and write `RETRO-NNN.json`.
- **Manual `<r>`** — **warns** and offers a lightweight alternative: append a one-line entry to root `lessons.md` (date + observation + takeaway). The full retro is still available if the user explicitly picks `[1] full retro` or passes `--full`.

**Why:** The 7-gate retro (5 Whys + reversal validation + ledger fingerprint + auto-promotion to S1 + RETRO-NNN.json + 3 doc updates) was designed to surface recurring failures in a multi-agent / multi-engineer environment. In a solo hobby project, most observations don't warrant that ceremony — but the loop-detector circuit breaker absolutely does, because runaway loops burn money and waste a session.

`lessons.md` does the simple job: capture the observation so future-you can see the pattern. If a `lessons.md` line repeats 3+ times, that's the signal to promote it to a `feedback_*.md` memory file (or to fire a real retro).

**How to apply:**

- Loop-detector fires → run `<r> --auto-loop` immediately, no triage. The sentinel-clear handshake at Gate 7 step 6 of c_retro.md is critical — never short-circuit it.
- User types `<r>` → output the triage block:
  ```
  Solo-dev mode is active. A full retro writes RETRO-NNN.json, updates the ledger,
  may auto-promote findings to S1 tech debt, and bumps three docs. For a solo
  session that's a lot of paperwork for one observation.

  Lightweight option: append a one-line entry to lessons.md at repo root
  (date + observation + 1-line takeaway). Pick:
    [1] full retro (the original flow below)
    [2] lessons.md one-liner (recommended for solo)
    [3] cancel
  ```
- `[2]` writes `_YYYY-MM-DD_ — <observation>. Takeaway: <takeaway>.` to `lessons.md` and exits. Done in three lines.
- `[1]` proceeds with the full c_retro.md flow.
- `[3]` exits, no writes.

**Prod-ready re-activation:** Remove the FROZEN header from `docs/c_retro_index.md`. Remove the triage block from the retro skill. Manual `<r>` becomes the full flow again.

Related: [[solo-dev-mode]], [[no-debt]], [[deferrals-register]].
