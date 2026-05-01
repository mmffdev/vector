---
name: Never wipe uncommitted work
description: Never run git checkout, git restore, git reset --hard, or any command that overwrites uncommitted working tree changes without explicit user confirmation
type: feedback
originSessionId: 0f779eb1-91e3-46e0-8199-d8a54719ec8f
---
Never run `git checkout HEAD -- <file>`, `git restore`, `git reset --hard`, or any destructive git operation that can overwrite uncommitted working tree changes without first asking the user.

**Why:** On 2026-04-27, running `git checkout HEAD -- app/(user)/preferences/navigation/page.tsx` wiped an entire session's worth of uncommitted work (rename/delete controls for custom pages). The user was furious. This is irreversible without recovery from session logs.

**How to apply:** If you are tempted to revert a file to HEAD to "start clean", STOP. Read the current file first, understand what uncommitted changes exist, and ask the user before touching them. The only exception is if the user explicitly says "revert this file" or "discard my changes to X".

**Incident 2 (2026-04-27, session 0f779eb1):** Repeated the same violation on `app/globals.css` and `app/(user)/preferences/navigation/page.tsx`. Destroyed hours of uncommitted nav prefs work and visually broke the portfolio model wizard by removing `model-chooser-grid` CSS that the modified WizardModelCardList.tsx depended on. The rationalization was "start clean to fix a CSS visibility issue." This was wrong. Recovery required replaying 40 TSX edits and 45 CSS edits from the session JSONL. Do not rationalize bypassing this rule under any circumstance.
