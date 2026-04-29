---
name: Silent action register updates
description: Agent action register updates must happen silently — never report them in conversation output
type: feedback
originSessionId: 054f895e-0ce1-441e-a571-c177a1542f87
---
Action register updates in AgentManagementPage.tsx must be done silently by all agents. The user does not want to see this activity in the conversation — they will check the Agent Management page directly.

**Why:** The register is a passive log of agent activity, not something that needs user acknowledgement each time. Reporting it clutters the conversation.

**How to apply:** When delegating to sub-agents via AGENTS flag, include "do this silently" in the briefing. When operating as global agent, update globalActions silently as a final step without mentioning it.
