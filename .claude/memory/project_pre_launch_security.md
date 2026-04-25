---
name: Pre-launch — scrub git history and harden security
description: At project launch, scrub git history of committed secrets and tighten security posture across the codebase.
type: project
originSessionId: 1f23fed8-fdbe-4fc7-9b8e-889d9321e756
---
At launch (before any external/public repo access), two mandatory tasks:

1. **Scrub git history** — `backend/.env.local` was committed with live credentials and MASTER_KEY in plaintext. Use `git filter-repo` to remove it from all past commits. Rotate all secrets that appeared in that file (DB passwords, JWT secrets, SMTP creds, MASTER_KEY).

2. **Harden security posture** — review and fix:
   - `dev/scripts/ssh_manager.sh` line 30: `DB_PASSWORD_DEFAULT` hardcoded in plaintext → replace with `read -s` prompt
   - Add `backend/.env.local` to `.gitignore` and untrack with `git rm --cached`
   - Create `backend/.env.example` with placeholder values for new developers
   - Audit any other secrets or credentials committed to the repo

**Why:** repo is currently private/internal so risk is contained. Pre-launch is the hard deadline — once external eyes touch the repo, history scrub becomes a breach response, not a cleanup.

**How to apply:** surface this checklist when the user says "launch", "ship", "go live", "external repo", or "invite contractors/remote workers".
