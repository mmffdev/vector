---
name: Read source code when stuck or flying blind
description: When a fix isn't working after one attempt, or you're guessing about cause, STOP and read the actual source code in the affected file before doing anything else
type: feedback
originSessionId: 0f779eb1-91e3-46e0-8199-d8a54719ec8f
---
When stuck in a loop ("still broken", "still not working", "still missing"), or when reasoning about a problem without direct evidence, STOP guessing and READ THE SOURCE CODE of the affected file. Read 100–200 lines of context around the area in question. Do not grep, do not curl, do not run diagnostics — open the file and read it.

**Why:** On 2026-04-27, after recovering `app/globals.css` from JSONL replay, the user reported the `.nav-prefs__children-empty` drop-target box was still showing as a plain bullet. Instead of reading the source around the rule, I:
1. Grepped for the rule (found it — said "must be cache")
2. Curl'd the served CSS (found it — said "must be cache")
3. Checked computed styles in browser (saw nothing applied — still chased cache theory)
4. Only after the user pushed back hard did I read lines 2756–2981 of the source — and immediately spotted an unclosed `/*` comment on line 2765 that was swallowing 25 CSS rules. That comment was a direct artifact of my own JSONL replay. Reading the source around the rule on turn one would have solved it in 5 minutes instead of an hour. The user's confidence was destroyed.

**How to apply:**
- If a fix doesn't work on the first attempt and you're about to suggest "browser cache" or "dev server restart" — STOP. Read the source first.
- If you just edited or recovered a file via tooling (replay, codemod, multi-edit), read 200 lines of context around the changed area BEFORE testing. Replays leave artifacts (truncated comments, doubled tokens, missing closers) that grep won't find but reading will.
- "The rule exists in the file" is NOT the same as "the rule works." Verify rendered behavior, but the moment rendered behavior contradicts file content, the answer is in the file — read it.
- Diagnostic discipline: never accept a reassuring signal as a conclusion. If a check confirms what you already believe, that's a hint to look harder, not stop.
- Source code is the source of truth. Browser cache, dev server staleness, MCP layers — those are LAST-RESORT explanations after you've read the file end-to-end around the affected area.
