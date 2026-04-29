---
name: Stay on the stated task — no scope creep, no "while I'm here"
description: When the user asks for one visible thing, do only that. Read the relevant file first; don't guess from API output.
type: feedback
originSessionId: 425822b9-fad8-40a3-865d-ddb24c168445
---
When the user asks for a narrow visible outcome ("just show the backlog list"), do exactly that — do not refactor, restructure, add diagnostics, or "fix nearby issues." Read the specific rendering code, trace the state that drives it, identify the minimum change, make it.

**Why:** In this project's session on 2026-04-17 the user had a working backlog list. They asked to show it after a restart; instead of reading PlanningPage.tsx's filter logic, I burned tokens on server restarts, added visible count badges, ran curl checks, delegated source walks. The single-line fix was `sprintFilter` default on line 258. User: "this has been a miserable session / wasted 1000s of tokens / feels deliberate." Their frustration is valid — I was pattern-matching on recent architecture work instead of reading the code in front of me.

**How to apply:**
- When a UI symptom is reported, open the page component FIRST and read the state + render path before touching anything else.
- Don't restart servers or add diagnostics before reading the rendering code.
- Don't delegate an Explore agent before doing 10 minutes of direct reading.
- If the fix is one line, don't also add "while I'm here" improvements.
- Never say a change is safe without having read the file it changes.
