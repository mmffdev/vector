# Workflow Rules

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
