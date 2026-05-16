---
name: never-git-stash
description: Never run git stash, git stash --include-untracked, or git stash pop. They destroy other people's dirty work. Use surgical extraction instead.
metadata:
  type: feedback
---

**Never run `git stash` or `git stash pop` — full stop.**

**Why:** On 2026-05-16 ~03:04 I ran `git stash --include-untracked --quiet` to "check pre-session state" while Rick had hours of uncommitted in-flight work in the working tree (flow-states-v2 multi-type rewrite, ResourceTree cog plumbing, p_ObjectTree Panel wrap, PageSummaryHeader helpable={false}, globals.css scroll-grow fix + cog menu CSS + page-summary sticky, work-items-tree-config querystring separator fix, plus 8 other files). The stash swept all of it. Then I tried `git stash pop` to recover and it failed — `git stash drop` removed the stash from the visible list. The work was only recoverable via `git fsck --no-reflogs` finding the dangling commit object. This cost Rick trust and forced him to catalogue his own losses to me file by file. This violated [[never-wipe-uncommitted]] and [[dirty-files-are-other-peoples-work]] — both already in memory.

**How to apply:**
1. **Never** run `git stash`, `git stash push`, `git stash --include-untracked`, `git stash pop`, or `git stash drop`. No exceptions. Not for "just a quick check". Not even on "just my files".
2. If I need to examine pre-session state, use `git diff HEAD -- <my-file>` or `git show HEAD:<my-file>` — read-only.
3. If I need to temporarily revert a file to verify a red signal, copy it to `/tmp/` first, then `git checkout HEAD -- <my-file>` (only the specific file, not a sweep). Restore by copying back from `/tmp/`.
4. If I need to extract content from a previous state, use `git show <ref>:<path> > /tmp/...` (read-only) or `git checkout <ref> -- <path>` for the specific file only.
5. When dirty files exist in the working tree that aren't mine: treat them as a minefield. Stage only my files with `git add <specific-paths>` and never `git add .` or `git add -A`.
6. Before any git command that affects working-tree state, recite this question out loud (in tool output): "does this touch a file I didn't create or modify myself this session?" — if yes, stop and ask.
7. The recovery path via `git fsck --no-reflogs --lost-found` works for ~2 weeks but is not a substitute for not destroying work in the first place.
