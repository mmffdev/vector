---
name: scope commit bracket ref
description: Always include a letter-prefixed scope ref in square brackets in commit messages so the scope-commit-note hook can match the commit to a Vector_Scope.md item.
type: feedback
---

When committing work that maps to a known scope item in `Vector_Scope.md`, include the ref in square brackets in the commit subject line, e.g. `feat([B19.3.3]): graph renders three.js nodes` or `fix([M3.1.1], [B19.6.4]): defect ETL + graph route`.

**Why:** the `scope-commit-note.sh` PostToolUse hook resolves commits to scope items in priority order — (1) explicit `[REF]` tags in the commit message, (2) `.claude/scope-refs.map` keyword lookup, otherwise → `## Unmatched Commits`. The fuzzy keyword-against-item-text fallback was removed on 2026-05-09 because it over-matched (10+ items per commit on common words like "v1", "API", "spec"). So if the commit message has no `[REF]` tag and no map keyword hits, the commit lands in Unmatched and the user perceives "loads of updates with no counter advance".

**How to apply:** in every commit message you generate via Bash, scan the working scope of the change, look up the matching ref in `Vector_Scope.md` (refs are letter-prefixed: `B19.1.4`, `M3.1.1` — not bare numeric), and prepend `[REF]` to the conventional-commit type, e.g. `feat([B19.1.4]): ...`. If multiple items, comma-separate: `[B19.1.4, B19.6.3]`. If the work doesn't map to scope, leave plain — Unmatched is the right place for ad-hoc work.
