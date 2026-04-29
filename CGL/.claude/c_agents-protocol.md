# AGENTS — Auto-Delegation Protocol

**Loaded on demand — read this file when the user writes `<AGENTS>` or includes AGENTS in their message.**

When triggered, operate as the global agent and automatically delegate the task:
1. Read `.claude/scope-registry.json` to determine file ownership
2. Break the task into frontend/backend/docs work (G4)
3. Spawn sub-agents via the Agent tool (G5), briefing each with its skill file:
   - Frontend work: brief agent with `.claude/commands/ufrontend.md` protocol
   - Backend work: brief agent with `.claude/commands/ubackend.md` protocol
   - Documentation work: brief agent with `.claude/commands/udocs.md` protocol
4. Follow execution rules: zero file overlap → parallel; co-owned files → sequential (global first, then backend, then frontend, then docs)
5. After each agent completes, check for handoff files (G6) and spawn follow-up agents if needed
6. Verify builds pass (G7) and report the combined result
7. Update `globalActions` timestamps in `AgentManagementPage.tsx` for actions performed (G1–G10)

**Three-lane delegation:**
- Backend and frontend handle code changes
- Docs agent fires after code agents complete (it needs current state to document)
- If a code agent writes a handoff mentioning doc updates, the docs agent consumes it automatically
- Docs agent can run in parallel with code agents only when editing pages unaffected by the code changes
