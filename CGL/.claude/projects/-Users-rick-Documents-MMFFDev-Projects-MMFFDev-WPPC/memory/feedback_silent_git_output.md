---
name: Silent git output
description: Never show raw git command output in chat unless user includes -SD flag
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
Don't show raw git output (log, diff, status, push, merge, tag, fetch, checkout, etc.) in chat. Report only the outcome — success/fail and key facts (e.g. "13 commits ahead", "merged", "pushed 3 branches + 1 tag").

**Why:** User reads git output in their IDE/terminal, not in chat. Mirrors the existing "No Diff Output" rule.

**How to apply:** Always. Exception: if user includes **-SD** in their message, show the raw output for that response only.
