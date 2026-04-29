---
name: Never stop/restart server without permission
description: NEVER kill, restart, or stop the backend server unless the user includes <server> flag in their message
type: feedback
originSessionId: 74eb4126-fd65-45af-8195-777c2e2b1c7a
---
NEVER stop, kill, restart, or send signals (HUP, TERM, etc.) to the backend server process unless the user includes the `<server>` flag in their chat message.

**Why:** Killing the server mid-session broke the running app. The user's server is their live environment — taking it down without permission is destructive.

**How to apply:**
- If `<server>` is present in the user's message: safe to restart via `curl -s -X POST http://localhost:3333/api/restart`
- If `<server>` is NOT present: do NOT restart, kill, or signal the backend process. If a restart is needed (e.g. after backend build), tell the user and let them decide.
- Never use `kill`, `kill -HUP`, or any signal against the backend PID directly — always use the launcher API if restarting is authorised.
