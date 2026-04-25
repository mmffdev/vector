---
name: Card lifecycle — move states on every task
description: Every Planka card must be moved through Backlog→To Do→Doing→Completed as work progresses. Never create a card and code without moving it first.
type: feedback
originSessionId: 1f23fed8-fdbe-4fc7-9b8e-889d9321e756
---
The card lifecycle rule in CLAUDE.md (line 18) is hard and applies to every task, including quick one-liners:

1. On "go"/approval → move card **Backlog → To Do**
2. On first code edit → move **To Do → Doing**
3. On code-complete → move **Doing → Completed**

Full contract is in `docs/c_c_backlog_agent.md`.

**Why:** Without state moves the board is useless for tracking. A card stuck in Backlog while the work is done is invisible to the user.

**How to apply:**
- As soon as I decide to work a card, move it to To Do (or Doing if I'm starting immediately).
- Do not make the first code edit until the card is in Doing.
- After the last change, move to Completed and post a one-line comment with what was done.
- This applies even for 30-second styling fixes — no exceptions.
- Use `PATCH /api/cards/<id>` with `{"listId":"<target>","position":65536}`. See `docs/c_c_planka_rest.md` for REST templates.
