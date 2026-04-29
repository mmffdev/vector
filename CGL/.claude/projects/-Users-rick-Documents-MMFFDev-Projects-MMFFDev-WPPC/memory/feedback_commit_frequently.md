---
name: Commit after each feature
description: Commit frequently during sprints — after each feature/fix, not in one big batch at sprint close
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
Commit after completing each feature, bug fix, or logical unit of work — don't batch everything into a single pre-close commit. The pre-commit hook runs TypeScript type-checking on all staged files, and a 47-file commit surfaces every accumulated issue at once, blocking the sprint close.

**Why:** Sprint013 close took three attempts because 47 files were staged at once and the type checker found 100+ errors across linter-modified files. Committing after each feature would have caught issues immediately with 3-5 files at a time.

**How to apply:** After completing a feature or fix (build passes, verified working), immediately `git add` the relevant files and commit with the sprint prefix. Don't wait for the user to ask — propose the commit proactively.
