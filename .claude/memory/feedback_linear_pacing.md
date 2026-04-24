---
name: Linear pacing over batched work
description: User prefers one-step-at-a-time, visible checkpoints, confirm before moving on
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
Work linearly: finish and verify one step before starting the next. Show checkpoints (commit, typecheck, smoke test) and pause for confirmation at natural boundaries.

**Why:** User confirmed on 2026-04-21 that this style feels "more accurate, clean, understandable" than batching multiple concerns into one pass. Validated after the CSS migration + dev split + commit sequence was done step-by-step with explicit checkpoints.

**How to apply:** Avoid bundling unrelated changes. Don't chain "and also" work without asking. After each meaningful step (migration, split, commit, new page), surface state and wait for a go signal before the next one — especially on multi-file refactors.
