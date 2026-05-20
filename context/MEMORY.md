<!-- Cap: ~10,000 chars. Curated working memory, loaded as frozen snapshot at session start. Mid-session writes persist but take effect next session. Add via `/remember` or the memory-write skill. -->
# Working Memory

## HARD RULES (verbatim — also in .claude/CLAUDE.md)

**HARD RULE — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify password_hash, email, is_active, role, or password_changed_at of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `cookra@me.com`, or `user@mmffdev.com`. Reset to `password` on 2026-05-02. If a login fails, ASK — never "fix" by overwriting. For gadmin/padmin/user testing, create NEW accounts (e.g. `claude-gadmin@mmffdev.com`). Cannot be overridden.

**HARD RULE — NEVER DESTRUCTIVE GIT:** Never run `reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, or any command that destroys work — without explicit confirmation. Cannot be overridden.

**HARD RULE — NEVER GIT STASH:** Never run `git stash`, `git stash --include-untracked`, `git stash pop`, or `git stash drop`. Full stop. On 2026-05-16 a `stash --include-untracked` nuked hours of in-flight work across 17 files. For pre-session state use `git diff HEAD -- <file>` or `git show HEAD:<file>` (read-only). For temporary revert: copy to `/tmp/` first, then `git checkout HEAD -- <specific-file>`. Never `git add .` or `git add -A` — stage by explicit path.

**HARD RULE — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim: (1) find handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify pool (`pool` / `vaPool` / `libPools`), (3) cross-check `docs/c_c_db_routing.md`. Only then open psql with the correct `-d <dbname>`. Three DBs in play: `mmff_vector` (pool), `vector_artefacts` (vaPool — artefact_types, artefacts, flows, field_library, timebox_*), `mmff_library` (libPools — read-only spine). Cannot be overridden.

**HARD RULE — BACKEND PINNED TO `dev`:** Active env is permanently dev. Does not change for any reason except the user typing it in chat. Never run `<server> -s` / `<server> -p`, never switch via launcher, never ask "should I switch?". If anything flips the marker to staging/production: silently revert (restart Go on :5100 with `BACKEND_ENV=dev`, tunnel :5435, rewrite marker). Staging/prod env files are refusing stubs; recovery files at `backend/.env.staging.locked` / `.env.production.locked`. SSH config `mmffdev-pg` deliberately omits `LocalForward 5434`. Cannot be overridden.

**HARD RULE — LOOP DETECTED:** When a system-reminder begins with `LOOP DETECTED`, the loop-detector hook has fired 5 consecutive stuck signals. MUST invoke `<r> --auto-loop` before any further tool use except Read. Do not "just try one more thing".

**HARD RULE — SERVER IS THE GATE:** Any visibility / role / scope / permission filter writes the SERVER-SIDE check FIRST. Client-side is defence-in-depth, never the authoritative gate. The wire payload must not contain data the caller isn't cleared for; hiding it in the client is the wrong answer for a Trust-No-One, SOC 2, defence/finance product. When user asks "is this locked by the backend?" the answer must be "yes" with proof (handler + test). If the change is UX-only and looks like security: STOP, identify the threat, write the backend filter first. Origin: TD-NAV-AUTH-TIER. Cannot be overridden.

## Active Mode

**Solo-dev mode since 2026-05-17.** WIP cap 5 in `Vector_Scope.md`; anything past goes to `## Parked` (swap-in/swap-out). Stories: title + AC only (full 7-gate flow behind `--full` flag). No new PLA plans — new work = one-line entry in Vector_Scope.md; existing 53 PLA files preserved as archaeology. Indexes (c_plan_index.md, c_story_index.md) frozen with `## FROZEN — solo-dev mode` header. Retros auto-only (loop-detector circuit breaker stays). Scratch outside repo at `~/Vector-scratch/`. ★ FORCING FUNCTION pinned top of Vector_Scope.md. Flips to prod-ready on first external user committed OR launch date set. Commit tag in solo-dev: `[solo-dev]`.

## Collaboration baseline

**Design conversation IS the iteration loop.** Don't rush to code; "how would this work?" usually wants thinking. Push back honestly; bland agreement is less useful than honest disagreement. Play back proposals before responding ("ncy" = "nice catch yes"). Surface tensions, don't paper over. Converge before coding — "yes, that's the shape" is the moment.

**Stakeholder foundation mode** — sole stakeholder, no deadline. Foundation > patch. Option B (right architecture, bigger PR) usually beats Option A. Cleanup, not deferral. Tech-debt is a flag, not an exit.

**Always recommend the safest, best approach.** Never neutral A/B/C menus. Lead: "Recommended: X. Alternative: Y. Avoid: Z."

**Buyer profile: defence + finance.** NIST 800-53 mod/high, AAL2/AAL3, CMMC L2/L3, FFIEC, PCI-DSS 4.0, SOC 2, ISO 27001. "Out of scope" is wrong — expect compensating controls (DPoP, session anomaly, CSP+SRI, audit). Audit narrative matters as much as control.

## Workflow rules

**Red-green-refactor is non-negotiable.** Write the failing test FIRST, every time. No exceptions for "obvious" refactors, deletions, mechanical work. Asymmetry: a green test written after only proves current state; written first proves the contract.

**Never create debt — fix now, flag if detected.** Detecting existing debt mid-task: one-line flag, propose fixing now. `docs/c_tech_debt.md` is for user-confirmed deferrals only.

**Deferrals → tech-debt register.** "hold until" / "out of scope" / "follow-up" / "not blocking" → file in `docs/c_tech_debt.md` with severity + trigger BEFORE commit, ID in commit msg. Diagnose before scoping — honest size + explicit trigger, never optimistic. Boundary regressions fixed SAME session; only multi-session test-infra debt deferred.

**Bracket-tag commits with scope ref.** Always include `[B19.1.4]` (current solo-dev mode: `[solo-dev]`) in commit subject; otherwise scope-commit-note hook can't match → Unmatched.

**Empirical blast radius.** Never rely on a prior agent's summary. Read the actual workflow/script/snapshot files before recommending cross-cutting changes. "An agent said X" is hypothesis, not evidence. If a fix doesn't work first attempt OR reasoning without direct evidence: STOP, read 100–200 lines of source around the area. Source is truth.

**UUIDs and enum codes are the contract.** Display names drift (workspace, role, topology node). Identify by UUID in SQL. Don't flag name-mismatch as warning (housekeeping). DO stop and ask on real contradiction (UUID resolves to row contradicting plain language).

**No hardcoded order/list from DB data.** Never invent an order/mapping in TSX/Go when data is DB-driven. If column doesn't carry the signal → STOP, surface gap. Multi-tenant: tenants edit their own model; any frontend hardcoded list diverges immediately.

**Cookbook every non-trivial SQL + bash.** Append novel psql queries to `docs/c_sql_cookbook.md` and novel bash to `docs/c_bash_cookbook.md` BEFORE moving on. SQL entries name DB + pool. Stop re-deriving same incantations.

**All stories via `/stories` shortcut.** No exceptions. No direct Planka writes. Even "just one card" routes through the skill (solo-dev mode = title + AC only).

**Single-agent ownership per domain.** Never spawn a second agent into a package another is currently/recently working — they adopt different mental models and break the seam. Origin: 2026-05-20 fields-domain — two parallel agents wired workspace-fields writers two different ways; frontend imported names that didn't exist. Before spawning: check if another agent touched the target dir this session. If yes, SendMessage (continues with context), not new Agent.

**Never auto-commit.** Never run `git commit` without explicit user ask. "Done" / "looks good" / "build is green" do NOT authorize a commit — wait for "commit" or equivalent. Tell subagents the same in their prompt.

## CSS conventions

**Buttons:** every `<button>` carries `.btn` + variant. Variants in [app/globals.css](app/globals.css) ~1141–1255: `--primary`, `--secondary`, `--ghost`, `--icon` (36×36, combine with `--ghost`), `--danger`, `--row-expander`, `--sm`, `--lg`, `--block`. Bespoke selectors NEVER restate baseline. Naked `<button>` = defect.

**Tables:** every table uses `.tree_accordion-dense__*` (scroll/table/head/th/row/cell/`--numeric`/`--center`/`--mono`/`--epic`/`--child`/`--selected`). Old `.table*` family DEPRECATED (overflow:hidden clipped sticky heads). Column widths via `<col style={{width:N}}/>` inside `<colgroup>` — only sanctioned inline style.

**No inline `style={{}}`.** Exception: `style={{"--my-var": value}}` for genuinely dynamic CSS-var assignment. Custom interactive elements compose from tokens — active uses `--accent` / `--accent-ink`, never `--brand` (`--brand` is for identity marks only).

**CSS/HTML naming:** `root-block__Container_Child_leaf`. `__` once at root, `_` deeper, `-` modifier only. No BEM `--`, no generics like `wrapper`/`container`/`box`. Proposal step fires ONLY when introducing NEW root-block or renaming chain — routine additions under existing root: silent.

## Test surface

**Claude-owned accounts** (free to use, soft rule = don't modify): `claude@mmffdev.com` / `password` (user, ID `ef289df1-fcc0-4a5b-bf1b-3d3cf59be708`); `claude_1_test@` (user), `claude_2_test@` (padmin), `claude_3_test@` (gadmin) — all `password123!`. Fixture sub `00000000-0000-0000-0000-000000000001`, dev `mmff_vector` via :5435. Login at `:5101/login` or `POST :5100/auth/login`.

## Active Threads

_(empty — populated as work progresses)_

## Environment Notes

- Backend pinned dev. Env file `backend/.env.dev`. DB tunnel `localhost:5435`. Dev VPS 77.68.33.216.
- Frontend `http://localhost:5101`. Backend `http://localhost:5100`.
- `<server>` skill handles env switching but is locked off staging/prod.
- Memory: this file (~10 KB) + `context/USER.md` (~3 KB) loaded at session start. Daily logs `context/memory/{YYYY-MM-DD}.md`. Transcripts gitignored. `<index>` for semantic recall; nightly cron.

## Pending Decisions

_(empty)_
