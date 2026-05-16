---
name: feedback-red-green-always
description: Red-green-refactor is the only acceptable sequence. Write the failing test first, then implement; never refactor or delete code first and verify after.
metadata:
  type: feedback
---

**Red-green-refactor is non-negotiable. Write the failing test BEFORE the change, every time. No exceptions for "obvious" refactors, deletions, or seemingly-mechanical work.**

**Why:** Rick called this out 2026-05-16 after I batched a TD sweep where I wrote tests for *some* but not all pay-downs. The pattern I'd been falling into:

- ✅ Red-first for architectural changes (TD-WS-001 ActiveWorkspaceResolver, NULL-scan regression).
- ❌ Skipped red-first for: TD-WORKITEMS-DUPE refactor, TD-WORKITEMS-GENERIC summary shape change, TD-LIB-001 JWT dual-accept deletion. Justification I gave myself was "it's just a refactor / mechanical / will fail to compile if wrong." Each of those produced clean diffs, but the discipline went sideways.

Rick's framing: *"as per red-green you write the test before, not after, always."* The asymmetry between writing-test-first vs verifying-after isn't about whether the code is right — it's about whether the **next regression** will be caught. A green test written after the fact only proves the current state; a test written first proves the contract the code now satisfies.

**How to apply:**

- Before any code change — even a one-line deletion, a rename, a refactor that "just shuffles things around" — write a failing test that pins down the post-change behaviour.
- For deletions: write a test that asserts the deleted code's job is now handled by the kept code (the natural-unmarshal path, the generic ByType lookup, etc.). The test fails *because the old code is still in the way* or *because the contract isn't enforced yet*.
- For refactors: write a test that exercises the public surface before touching internals. If the test passes against the old code, the refactor is a no-op contract change and you're fine. If it fails, you've found the contract drift before shipping.
- For "obvious" mechanical fixes: especially these. The "obvious" framing is the trap — it's where you skip verification because the change "looks right."
- If a test can't be written for the change (CSS catalogue migrations, docker image swaps, infra changes), that's a signal the change shouldn't be a TD-style commit-and-go — it needs its own design pass and per-step smoke gates.
- Smoke testing after the fact is fine as additional confidence — it is NOT a substitute for the red test.

**Related:**
- [[feedback_stories_system]] — the 7-gate acceptance system already encodes test-first (Gate AIGEN includes "tests written" as a precondition).
- [[feedback_read_source_when_stuck]] — same family: don't shortcut the discipline because the change "looks simple."
- TD-TEST-003 in `docs/c_tech_debt.md` — the very entry that exists because PLA-0032 + PLA-0050 shipped without tests; same anti-pattern.
