---
name: feedback-deferrals-register
description: Every time I defer work — "hold until X", "out of scope for this commit", "needs its own plan" — I MUST add it to docs/c_tech_debt.md before moving on. Spoken deferrals decay; register entries persist.
metadata:
  type: feedback
---

When I say any of these phrases during a session — or thinking-equivalent thereof — it triggers a register entry:

- "hold until …"
- "out of scope for this commit"
- "needs its own plan / its own session / its own commit"
- "deferred", "deferred to later"
- "follow-up"
- "leave for next time"
- "not blocking"
- "tech debt, not addressing now"

**Why:** On 2026-05-13 I deferred four items in one session (auth/handler.go cookie clear-list, openapi.yaml retirement, check_callers.py regex bug, api-contracts workflow PR-only trigger). I named them in chat and in commit messages but did not file them. Rick noticed: "when we defer things are you listing them to do later?" — answer was no. Spoken deferrals across sessions = invisible debt = compounding mess. The project has had a standing rule for this since the start of the tech-debt register; I just wasn't honoring it.

**How to apply (mandatory, every session):**

1. **Before the commit that contains the deferral** — open [`docs/c_tech_debt.md`](../../../docs/c_tech_debt.md) and append a row to the register table.
2. **Row format** matches existing entries:
   ```
   | TD-<AREA>-NNN | YYYY-MM-DD | S1|S2|S3 | <Area> | <Debt — what is it, where does it live> | <Trigger — what makes it bite, with date/event if known> | <Cap in place — comment/canary/register entry that makes it visible now> | <Pay-down — the cheapest action that resolves it> |
   ```
3. **Pick an area prefix** matching existing ones (e.g. `TD-LIB-*`, `TD-PERM-*`, `TD-DB-*`, `TD-AUTH-*`, `TD-FE-*`, `TD-API-*`). Invent a new one only if nothing fits.
4. **Severity rule of thumb:**
   - **S1** — fix in the same PR (deferrals are almost never S1)
   - **S2** — latent, foreseeable trigger (cookie clear-list, openapi retirement)
   - **S3** — structural slow tax (regex bug in a CI script, PR-trigger gap)
5. **Trigger must be specific.** "Eventually" is not a trigger. "Sep 2026 (cookie TTL + sunset)" is. "Next /samantha/v2 route added without spec entry" is. "First PR to main that touches v1 spec" is.
6. **Commit the register update in the SAME commit as the deferred work** when possible, so a future blame finds them together. If the work and the deferral land in separate commits, that's fine — but commit the register row in the next commit, not "later".
7. **Mention the register ID in the commit message** that creates the deferral, so `git log --grep "TD-<ID>"` finds both the entry and the change that spawned it.

**Self-check at the end of every session:** scan my own outputs for the trigger phrases above. Any unregistered deferrals → file them now, commit, push.

Related: [[feedback-empirical-blast-radius]] (don't defer based on second-hand summaries; verify the deferral is actually safe), [[feedback-no-debt]] (overrides cap-and-defer for new debt I'm introducing — fix that immediately).
