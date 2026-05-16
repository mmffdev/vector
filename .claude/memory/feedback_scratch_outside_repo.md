---
name: scratch-outside-repo
description: Solo-dev mode — design exploration, screenshots, ad-hoc seed dumps live in ~/Vector-scratch/, not the repo working tree.
metadata:
  type: feedback
---

In **solo-dev mode** (since 2026-05-17), scratch artefacts live in `~/Vector-scratch/`, not in the repo working tree.

**Why:** When design iteration, screenshot dumps, and prototype scaffolds accumulate in the working tree as untracked files, they pollute `git status`, get indexed by grep/find, eat space, and force a decision ("commit? delete? keep ignoring?") on every session. Out-of-repo, they're invisible to git tooling and can be deleted en-masse when the question is settled. The Vector repo is for shippable code and durable docs. Scratch is exploration.

**How to apply:**

- New design work, screenshots, layout iterations, ad-hoc seed dumps, prototype scratch → `~/Vector-scratch/`.
- Organise scratch by topic (`flow-state-redesign/`, `topology-canvas-v2/`, etc.), not by date.
- If something in scratch survives 2+ sessions AND remains useful, that's the signal to either (a) commit it to the repo proper, (b) move the *idea* to memory as a `feedback_*.md` or `project_*.md` file, or (c) delete it.
- The SessionStart hook surfaces untracked files in the Vector repo as a count — anything you want to keep but don't want to commit should move to `~/Vector-scratch/` first.
- **Exception:** `.claude/scratch/` inside the repo is for documents that need to be referenced by Claude (e.g. `correction-prompt.md`). Those are committed deliberately as scratch-but-tracked. Don't conflate with `~/Vector-scratch/`.

**Edge cases:**

- **Screenshots referenced from a doc** — commit them under `docs/assets/` or `dev/research/<RNNN>/`, not scratch. Scratch is for screenshots that aren't referenced anywhere durable.
- **Seed SQL** — if it's a real fixture, it belongs in `db/<dbname>/dev-seeds/`. If it's a one-shot for "let me see what happens", scratch.
- **Prototype skill output** — `<prototype>` skill writes to its own area; only "after the fact" scratch from the exploration moves to `~/Vector-scratch/`.

**Prod-ready re-activation:** Rule stays. Scratch outside the repo is good hygiene regardless of mode.

Related: [[solo-dev-mode]], [[never-wipe-uncommitted]], [[never-git-stash]].
