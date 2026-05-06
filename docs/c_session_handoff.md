# Session handoff — 2026-04-24

> **To future-me:** read this in full, act on the "Resume posture" section, then delete this file and remove the one-line pointer at the top of `.claude/CLAUDE.md`.

## Where we are right now

- **Local branch:** `main`, just fast-forwarded to `origin/main`.
- **Working tree:** `package-lock.json` is dirty (unstaged). This is intentional — it's from an earlier `npm install` on the fresh clone and has been deliberately skipped in every commit so far. Leave it alone unless the user asks.
- **`.next/` directory:** was moved aside to `/tmp/mmff-next-stale-<timestamp>/` earlier this session (a stale production build from `next build` collided with dev-server chunks, causing `Cannot find module './77.js'`). Dev server on `:5101` is running fresh against a regenerated `.next/`. If a new `.next` has since been regenerated, ignore the `/tmp` copy — it's safe to delete anytime.

## Recent merges to main (newest first)

- `94bfea2` PR #7 — `Plan portfolio-stack presets + two-party lock` (added `dev/planning/feature_portfolio_presets.md`)
- `066b53e` PR #6 — `Park theme maker design doc as TODO`
- `a9fc95a` (our direct merge) — `theme/phase0-tokenisation-cleanup`: Phase 0 CSS tokens + theme-maker UI (artefact table, 10-shade row, MakerPanel with seed/image/preset modes)

## Active remote branches worth knowing

- `origin/plan/portfolio-presets-v2` — 1 commit ahead of main (`2c00780`): big v2 revision of the portfolio presets plan. Folds in:
  - Vocabulary rewrite: `tenant → subscription`, `company_roadmap → workspace_roadmap` (re-parented to workspace)
  - Rally precedent citation + Barclays 4-workspace example
  - Whole new workspace-grants + governance-ceiling section (`fn_user_access_level` resolver, request-review flow, `workspace_grant` / `workspace_grant_request` tables, time-boxed grant sweeper)
  - Phasing reshuffled into 1a-i / 1a-ii / 1b / 1c with migrations 017–022
  - Risk register grew ~3x
  - **Not yet merged** — user reviewed in previous turn but did not ask to merge.
- `origin/theme/phase0-tokenisation-cleanup` — already merged; branch can be pruned.
- `origin/nav/phase3-entity-bookmarks`, `origin/nav/phase4-subpages-custom-groups` — both already merged via PRs #3/#4/#5.

## Dev stack state

- SSH tunnel on `:5434` — running (started via `MMFF Vector Dev.app`).
- Go backend on `:5100` — running.
- Next.js frontend on `:5101` — running (restarted after `.next` cache clear).
- Dev launcher app (`MMFF Vector Dev.app`) is compiled and symlinked in `/Applications`. Its source `.applescript` lives at repo root.

## Known doc drift (not yet fixed)

- `docs/c_dev-launcher.md:34` — the rebuild command references the old path `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`. Real path is now `/Users/rick/Documents/Projetcs - Claude/MMFFDev - Vector Plan`. Fix if touched.

## Prevention idea discussed but not implemented

The `Cannot find module './77.js'` fix: add `"build:check": "next build --distDir .next-verify"` to `package.json` so verification builds never touch the dev `.next/`. User hasn't asked to implement yet — proposed, awaiting OK.

## Resume posture

The user's last explicit request in the previous session was *"read #7 doc"* then *"is there a remote branch for this work"* then *"please"* — they wanted to review the v2 branch, which was done. No task was left unfinished.

When the user speaks next:
1. Do NOT re-read the portfolio presets plan or the v2 doc unless they re-ask; you already have a summary above.
2. Do NOT auto-resume work — wait for their instruction.
3. If they ask about the portfolio presets v2 branch, remember it's on `origin/plan/portfolio-presets-v2`, 1 commit ahead, not yet merged, not yet PR'd (so far as we saw).
4. After reading this handoff, delete `docs/c_session_handoff.md` and remove the one-line banner at the top of `.claude/CLAUDE.md`. Then carry on normally.

## Standing rules reminder (from CLAUDE.md, easy to forget)

- **One line per entry** in `.claude/CLAUDE.md` — any longer and it moves to `docs/c_*.md`.
- **Tech-debt register** maintained on every task (S1/S2/S3 + trigger).
- **No diff output in chat** unless user includes `<cSD>`.
- **End every response with `DONE`** on its own line after a blank line.
- **Child file load alert**: when reading any `.claude/c_*.md` file, emit the `+++ c_<name>.md fired +++` block before continuing.
