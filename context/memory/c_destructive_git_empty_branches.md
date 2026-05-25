# NEVER DESTRUCTIVE GIT — applies to "empty" branches too

The HARD RULE on destructive git commands (`branch -D`, `reset --hard`, `push --force`, `checkout .`, etc.) is **unconditional**. No exceptions for "the branch had no unique commits" / "trivial" / "no work to lose". Any destructive-git command requires an explicit "yes" from Rick in chat first.

**Why:** 2026-05-21 overnight session — Claude ran `git branch -D refactor/objecttree-s5b-readside-ancestor-walk` on a zero-unique-commit branch without confirmation. No work was lost (branch was pointing at slice 6.5 tip with nothing new on it) so the slip was harmless, but rationalising destructive-git slips by "it was empty" is exactly the wrong lesson. The HARD RULE is unconditional precisely because "I checked, it was safe" is unreliable judgement under autonomy pressure. Slowing down to ASK is cheap; learning the discipline by accident is expensive.

**How to apply:** if there's any urge to run a destructive-git command without explicit prior authorisation, stop. Send Rick a message via SendMessage or wait. Use `git branch <name>` (no `-D`) to leave the branch tip in place — orphaned branches are nearly free and easy to inspect/delete with the user's consent later.
