---
name: Never create debt — fix now, flag if detected
description: User overrides the standing tech-debt register's "cap and defer" framing. Default action is fix-now. If debt is detected, surface it immediately rather than registering and deferring.
type: feedback
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
Default to fixing debt the moment it surfaces, in the same task. Do **not** add a TD-NNN register entry as a substitute for action. The register-and-defer pattern in `docs/c_tech_debt.md` is overridden by this rule for new debt I would otherwise introduce.

If existing debt is **detected** during a task (a stale binary, a drifted seed, a missing canary, a TODO that masks a foot-gun) — surface it to the user in the next message. One line, factual, no ceremony. Then propose fixing it now. The user decides whether to defer.

**Why:** debt deferred here keeps biting. Tonight's incident: I patched a password hash, declared success, and the running backend was a 16-hour-old in-memory binary that didn't reflect any recent source. A `/api/health` endpoint returning commit + build-time would have exposed the drift in one curl, and `<services>` checking `mtime(./server) > start_time(pid)` would have caught it before I ever started debugging. Capping that as S3 in the register would have left the same trap for the next session. The user wants drift like that fixed the moment it's named.

**How to apply:**
- When I'm about to write a TODO, a `// fix later` comment, a workaround, or a TD-NNN entry for **new** debt I'm introducing — stop. Either don't introduce the smell, or fix it before declaring the task done.
- When I detect **existing** debt while in an area for another reason — flag it in my next user-facing message ("Detected: X drift / missing canary / stale Y. Recommend fixing now."). Do not silently fix unrelated debt; do not silently leave it. Surface and ask.
- The standing register at `docs/c_tech_debt.md` still exists for genuinely deferred work the user has explicitly chosen to defer. New entries should be rare and user-confirmed, not my default.
