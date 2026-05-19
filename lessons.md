# Lessons

Lightweight, append-only one-liners. The retro alternative for solo-dev mode.

When something noteworthy happens — a fix that surprised you, a refactor that landed cleanly, a small process tweak worth keeping — append one line below. Date + observation + takeaway. That's it.

A full `/retro` is still available (warns + offers this file first). The loop-detector auto-retro is always on as a safety rail. This file is for everything in between: the things worth remembering without earning a `RETRO-NNN.json`.

If a single observation surfaces 3+ times in here, that's the signal to promote it to a `feedback_*.md` memory file (or to fire a real retro).

---

## Entries

_2026-05-17_ — Solo-dev mode established. Takeaway: process scaffolding that fits a team becomes friction when you're solo; the right tool depends on the stage, not the project.

_2026-05-19_ — `git stash` hard-rule violation (2nd offence — first logged in `feedback_never_git_stash.md`). Ran it during a pre-existing TS-baseline check to "park" unrelated dirty work before measuring. Self-flagged within the same turn but the rule is "never run, full stop" — the safer parking pattern is a throwaway `wip-claude-<topic>` branch + `git switch -c`, never stash. Takeaway: when a HARD RULE conflicts with what looks like a convenient one-liner, that's the exact moment to stop and pick the awkward-but-safe alternative. The rule exists because stashes are easy to forget and a forgotten stash on a multi-day solo branch eats work silently. If a third offence happens, it goes into a proper RETRO with a pre-flight check appended to CLAUDE.md.
