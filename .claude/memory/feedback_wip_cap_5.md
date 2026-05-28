---
name: wip-cap-5
description: WIP count is advisory only as of 2026-05-28 — the historical 5-theme cap was demoted because the session-start nag was firing constantly and getting in the way. SessionStart still surfaces the theme count for awareness.
metadata:
  type: feedback
---

**WIP count is advisory** (since 2026-05-28). The session-start hook still emits the in-flight theme count for situational awareness, but the cap is no longer enforced and there's no "park one before starting new work" warning.

**History:** From 2026-05-17 to 2026-05-28 the cap was a hard 5 themes, enforced by `.claude/hooks/scope-session-start.sh` with a ⚠️ banner on every session start when exceeded. Rick demoted it because the warning was firing on most sessions and the friction outweighed the discipline value.

**Why:** Multi-stream work in solo context still fragments attention. But the *enforcement* mechanism (a session-start banner Rick had to read and dismiss) cost more than the discipline gained — Rick already self-regulates context-switching; the hook was telling him things he knew. The count itself is still useful as a glanceable check; the cap rhetoric isn't.

**How to apply:**

- **Don't suggest parking** unless Rick raises it himself. The advisory count is information, not a prompt for action.
- **Don't claim a cap exists.** If Rick asks "what's the WIP cap?", the answer is "no cap — it's advisory now."
- **Parking is still a valid tool**, just user-initiated. The `# Parked — solo-dev mode (since 2026-05-17)` section in `Vector_Scope.md` is still the destination if Rick wants to shelve a theme.

**Origin signal:** "remove the cap and make it an advisory, its pising me off" — 2026-05-28. The cap firing was an active irritant, not a useful nudge.

Related: [[solo-dev-mode]], [[no-new-pla-plans]], [[scratch-outside-repo]], [[retros-auto-only]].
