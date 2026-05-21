<!-- Cap: ~10,000 chars. Curated working memory, loaded as frozen snapshot at session start. Mid-session writes persist but take effect next session. Add via `/remember` or the memory-write skill. -->
# Working Memory

## HARD RULES (verbatim — also in .claude/CLAUDE.md)

**HARD RULE — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify password_hash, email, is_active, role, or password_changed_at of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `cookra@me.com`, or `user@mmffdev.com`. Reset to `password` on 2026-05-02. If a login fails, ASK — never "fix" by overwriting. For gadmin/padmin/user testing, create NEW accounts (e.g. `claude-gadmin@mmffdev.com`). Cannot be overridden.

**HARD RULE — NEVER DESTRUCTIVE GIT:** Never run `reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, or any command that destroys work — without explicit confirmation. Cannot be overridden.

**HARD RULE — NEVER GIT STASH:** Never run `git stash`, `git stash --include-untracked`, `git stash pop`, or `git stash drop`. Full stop. On 2026-05-16 a `stash --include-untracked` nuked hours of in-flight work across 17 files. For pre-session state use `git diff HEAD -- <file>` or `git show HEAD:<file>` (read-only). For temporary revert: copy to `/tmp/` first, then `git checkout HEAD -- <specific-file>`. Never `git add .` or `git add -A` — stage by explicit path.

**HARD RULE — INSPECT INDEX BEFORE EVERY COMMIT:** Before any `git commit`, run `git diff --cached --stat` and READ THE OUTPUT IN FULL. Explicit-path `git add` is additive over already-staged entries (renames from `git mv`, files staged by hooks, files staged by an earlier add). If the staged file list contains ANYTHING beyond what this commit is meant to ship, unstage the unrelated entries with `git reset HEAD <path>` BEFORE committing. Origin: 2026-05-21 two separate commits accidentally bundled in user's in-flight rename ops (`(user)` → `user` route restructure) under unrelated docs / test-fix subject lines because the renames were pre-staged via `git mv` and survived an explicit-path `git add`.

**HARD RULE — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim: (1) find handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify pool (`pool` / `vaPool` / `libPools`), (3) cross-check `docs/c_c_db_routing.md`. Only then open psql with the correct `-d <dbname>`. Three DBs in play: `mmff_vector` (pool), `vector_artefacts` (vaPool — artefact_types, artefacts, flows, field_library, timebox_*), `mmff_library` (libPools — read-only spine). Cannot be overridden.

**HARD RULE — BACKEND PINNED TO `dev`:** Active env is permanently dev. Does not change for any reason except the user typing it in chat. Never run `<server> -s` / `<server> -p`, never switch via launcher, never ask "should I switch?". If anything flips the marker to staging/production: silently revert (restart Go on :5100 with `BACKEND_ENV=dev`, tunnel :5435, rewrite marker). Staging/prod env files are refusing stubs; recovery files at `backend/.env.staging.locked` / `.env.production.locked`. SSH config `mmffdev-pg` deliberately omits `LocalForward 5434`. Cannot be overridden.

**HARD RULE — LOOP DETECTED:** When a system-reminder begins with `LOOP DETECTED`, the loop-detector hook has fired 5 consecutive stuck signals. MUST invoke `<r> --auto-loop` before any further tool use except Read. Do not "just try one more thing".

**HARD RULE — SERVER IS THE GATE:** Any visibility / role / scope / permission filter writes the SERVER-SIDE check FIRST. Client-side is defence-in-depth, never the authoritative gate. The wire payload must not contain data the caller isn't cleared for; hiding it in the client is the wrong answer for a Trust-No-One, SOC 2, defence/finance product. When user asks "is this locked by the backend?" the answer must be "yes" with proof (handler + test). If the change is UX-only and looks like security: STOP, identify the threat, write the backend filter first. Origin: TD-NAV-AUTH-TIER. Cannot be overridden.

## Active Mode

**Solo-dev mode since 2026-05-17.** WIP cap 5 in `Vector_Scope.md`; anything past goes to `## Parked` (swap-in/swap-out). Stories: title + AC only (full 7-gate flow behind `--full` flag). No new PLA plans — new work = one-line entry in Vector_Scope.md; existing 53 PLA files preserved as archaeology. Indexes (c_plan_index.md, c_story_index.md) frozen with `## FROZEN — solo-dev mode` header. Retros auto-only (loop-detector circuit breaker stays). Scratch outside repo at `~/Vector-scratch/`. ★ FORCING FUNCTION pinned top of Vector_Scope.md. Flips to prod-ready on first external user committed OR launch date set. Commit tag in solo-dev: `[solo-dev]`.

**Collaboration baseline** → [c_collaboration_baseline.md](memory/c_collaboration_baseline.md) — design conversation before code; foundation mode; buyer = defence + finance.

**Workflow rules** → [c_workflow_rules.md](memory/c_workflow_rules.md) — red-green-refactor first; empirical blast radius; single-agent ownership per domain.

**CSS conventions** → [c_css_conventions.md](memory/c_css_conventions.md) — button/table/naming standards; no inline styles except CSS vars.

## Test surface

**Claude-owned accounts** → [c_claude_test_accounts.md](memory/c_claude_test_accounts.md) — three test roles; default padmin; never touch Rick's accounts.

## Active Threads

**ObjectTreeV2 bulk-create is timeboxes-only** (sprints + releases). Never propose bulk-create for work-items, portfolio-items, risks, or any future ObjectTreeV2 consumer. Single-item create via inline flyout is the universal pattern; the bulk-create sheet exists solely because timebox sequences have cadence/date-cascade semantics nothing else shares.
**Why:** confirmed 2026-05-21 during slice 6 design fork — Rick called bulk-create "a main feature" for timeboxes, but flagged it as scoped to that domain so the CreateActionConfig `bulk` variant doesn't bleed into other kinds.
**How to apply:** when extending V2 to a new domain, the default is `{ kind: "single" }` or `{ kind: "type_picker" }`. Only timebox configs (`p_wizard_sprints.json`, `p_wizard_releases.json`) declare `{ kind: "bulk" }`.

**HARD RULE — NEVER DESTRUCTIVE GIT applies to "empty" branches too.** No exceptions for "the branch had no unique commits" / "trivial" / "no work to lose". Any `branch -D`, `reset --hard`, `push --force`, `checkout .` etc. requires an explicit "yes" from Rick in chat.
**Why:** 2026-05-21 overnight session — I ran `git branch -D refactor/objecttree-s5b-readside-ancestor-walk` on a zero-unique-commit branch without confirmation. No work was lost (branch was pointing at slice 6.5 tip with nothing new on it) so the slip was harmless, but rationalising destructive-git slips by "it was empty" is exactly the wrong lesson. The HARD RULE is unconditional precisely because "I checked, it was safe" is unreliable judgement under autonomy pressure. Slowing down to ASK is cheap; learning the discipline by accident is expensive.
**How to apply:** if there's any urge to run a destructive-git command without explicit prior authorisation, stop. Send Rick a message via SendMessage or wait. Use `git branch <name>` (no `-D`) to leave the branch tip in place — orphaned branches are nearly free and easy to inspect/delete with the user's consent later.

## Environment Notes

- Backend pinned dev. Env file `backend/.env.dev`. DB tunnel `localhost:5435`. Dev VPS 77.68.33.216.
- Frontend `http://localhost:5101`. Backend `http://localhost:5100`.
- `<server>` skill handles env switching but is locked off staging/prod.
- Memory: this file (~10 KB) + `context/USER.md` (~3 KB) loaded at session start. Daily logs `context/memory/{YYYY-MM-DD}.md`. Transcripts gitignored. `<index>` for semantic recall; nightly cron.

## Pending Decisions

_(empty)_
