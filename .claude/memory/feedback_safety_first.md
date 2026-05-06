---
name: Always recommend the safest, best approach
description: When facing options on risky/destructive/multi-path work (migrations, deletes, force-pushes, schema/credential changes, env switches), lead with the safest option as the recommendation — not just neutral A/B/C
type: feedback
originSessionId: 1c78088f-5e4b-44b3-a787-05861b3b8995
---
When presenting options for risky or multi-path work, lead with an explicit recommendation of the safest, best approach — do not just enumerate neutral A/B/C and ask the user to pick. Make the safe path the default.

**Why:** The user wants Claude to act like a senior engineer who has formed a judgement, not a menu of equivalent choices. Neutral enumeration shifts decision burden onto the user and risks them picking a less-safe path because they didn't see the trade-off framed. This came up explicitly during PLA-0007 G1 application, where multiple options for handling a migrate dry-run mismatch were presented without a strong recommendation.

**How to apply:**
- Migrations / schema work: pre-flight snapshot, dry-run first, single-transaction with assertions, post-flight diff. Recommend that ordering, not "you could also just psql it directly."
- Destructive git ops (`reset --hard`, `push --force`, `branch -D`, `clean -f`): always recommend the non-destructive equivalent first (stash, revert, new branch). Only escalate to destructive on explicit confirmation.
- Credential / protected-account changes: recommend NEVER touching the row; recommend creating a new account or asking instead.
- Env / production switches: recommend dev → staging → prod ordering; never recommend skipping a tier.
- When listing options, always rank them: "Recommended: X (safest because …). Alternative: Y (faster but trades off …). Avoid: Z (would …)."
- If only one safe option exists, say so plainly — don't manufacture alternatives.
- Apply this even in auto mode: auto mode means "execute without asking on routine work," not "skip the safety analysis." Risky decision points still get the safest recommendation surfaced.
