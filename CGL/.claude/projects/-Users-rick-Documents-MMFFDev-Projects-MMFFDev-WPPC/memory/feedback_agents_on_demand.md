---
name: Agents on demand, not preloaded
description: Don't offer agent skills at sprint start — invoke them when the task warrants it
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
Don't preload agent skills at sprint start. Instead, spawn sub-agents (frontend/backend/docs) on my own judgement when a task warrants parallel or specialist delegation.

**Why:** User prefers lean workflow — agents add overhead when not needed, and Claude should decide when to use them.

**How to apply:** Skip the sprint start agent prompt. Use agents when there's genuinely parallel frontend+backend work, or when a task matches a specialist's domain and the main context would benefit from delegation.
