---
name: feedback-dirty-files-are-other-peoples-work
description: "Pre-existing dirty files in the working tree are active in-progress work from other contributors/sessions, NOT abandoned dirt to be manoeuvred around. Never reset/checkout/stash someone else's dirty file just to produce a cleaner own-commit. Ask first."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 34a4879b-48d5-40ab-9500-9f7c1e8c8548
---

When a file is dirty in `git status` from BEFORE the current session began, that's not noise — it's somebody else's in-progress work. Other people (or other Claude sessions, or the user themselves) are mid-edit. The state is fragile.

**The wrong move (2026-05-16, TD-SUMMARY-TONE pay-down):** `globals.css` had ~145 lines of pre-existing dirty work. I added my 12-line danger-tone hunk on top of it. To get a "clean" commit containing only my hunk, I:
1. backed up the dirty file to `/tmp`,
2. `git checkout HEAD -- app/globals.css` (RESET the dirty work-in-progress),
3. re-applied only my hunk to the now-clean file,
4. committed,
5. `cp` restored the backup to the working tree.

The working tree ended up byte-identical to before, so I assumed no harm done. The user pushed back: *"yes its dirty but people are working with it"* — meaning the live working tree state IS the medium other people are reading and editing. Even a momentary `checkout` of someone else's file is destructive in spirit, even if reversible in mechanics: it stomps their working state for the duration of the operation; if any tool (linter, IDE watcher, another agent) reads the file during that window, it sees the wrong content.

**Why:** Other contributors trust that their working tree won't be silently rewound by an unrelated agent. The fact that I restored it doesn't matter — between checkout and restore, their work was gone from disk.

**How to apply:**
- Default: if a file is dirty from prior work, just stage the whole file (carrying the pre-existing dirt along) and let the user disentangle later in a follow-up commit.
- Or: use `git add -p` to interactively select only your hunk — never touches the working tree's content.
- Never: `git checkout HEAD -- <dirty-file>`, `git restore --source=HEAD <dirty-file>`, `git stash` then restore — these all temporarily remove the dirty work from disk.
- If a clean focused commit really matters and `git add -p` isn't viable: **ASK FIRST** with explicit framing — "your globals.css has 145 lines of unrelated dirty work; I'd like to backup-checkout-add-restore to produce a clean focused commit, OK?"

Linked: [[feedback-empirical-blast-radius]] [[feedback-safety-first]] [[feedback-never-wipe-uncommitted]]
