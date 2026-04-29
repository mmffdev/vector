---
name: Silent execution mode
description: During large tasks, show ONLY todo status updates — no bash commands, no bash output, no edit output, no file contents
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
When executing large multi-phase tasks, the user wants completely silent execution. Show ONLY the TodoWrite status updates (in progress / done). Never show bash commands, bash output, edit operations, or file contents in chat. Only speak up if hitting a blocker that needs user input.

**Why:** The user monitors progress via the todo list and reads diffs in their IDE. Showing execution details clutters the chat and wastes context.

**How to apply:** Any time you're executing a plan with multiple phases/steps. Use TodoWrite for progress. Suppress all tool output from chat narrative.
