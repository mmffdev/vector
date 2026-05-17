# MEMORY index — load-bearing only

The entries below are the **always-relevant** memories: incident-earned safety, current mode, collaboration baseline, critical workflow. Everything else lives in [MEMORY_ARCHIVE.md](MEMORY_ARCHIVE.md) — grep that when context is needed but you can't find it here.

### Safety (incident-earned — always applies)

- [Never change passwords (HARD RULE)](feedback_never_change_passwords.md) — Never touch password_hash/email/role/is_active on gadmin@/padmin@/cookra@/user@; ask Rick or use claude@ test account.
- [Backend pinned to dev (HARD RULE)](feedback_dev_only.md) — Env permanently dev; staging/prod refusing stubs; revert any non-dev marker silently.
- [Never assume a database (HARD RULE)](feedback_never_assume_database.md) — Always trace handler → main.go pool → routing doc before any psql query; no "probably lives in X".
- [Never wipe uncommitted](feedback_never_wipe_uncommitted.md) — Do not run destructive git clean; always preserve local work.
- [Never git stash, period](feedback_never_git_stash.md) — Never run `git stash`/`stash pop`/`stash drop`; on 2026-05-16 a stash --include-untracked nuked hours of Rick's in-flight work across 17 files. Use surgical `git checkout <ref> -- <path>` or copy-to-/tmp instead.

### Active mode (current — solo-dev since 2026-05-17)

- [Solo-dev mode (since 2026-05-17)](feedback_solo_dev_mode.md) — WIP cap 5, stories=title+AC, no new PLAs, indexes frozen, retros auto-only; hard rails unchanged; flips to prod-ready when first external user or launch date is set.
- [No new PLA plans in solo-dev mode](feedback_no_new_pla_plans.md) — New work = sub-item in Vector_Scope.md; 53 existing PLA files preserved as archaeology; c_plan_index.md frozen at PLA-0055.
- [Retros auto-only in solo-dev mode](feedback_retros_auto_only.md) — Loop-detector auto-retro stays as safety rail; manual <r> warns + offers lessons.md one-liner.
- [Scratch outside the repo](feedback_scratch_outside_repo.md) — Design exploration, screenshots, ad-hoc seed dumps live in ~/Vector-scratch/, not the working tree.
- [WIP cap = 5 themes in Vector_Scope.md](feedback_wip_cap_5.md) — Adding a new theme = swap; touching a parked theme = swap; SessionStart hook warns at 6+.

### Collaboration baseline (how to work with Rick)

- [User background and expertise](user_background.md) — UX/Art History degree, 20+ years Agile Coach & transformation lead; no formal engineering training.
- [Stakeholder foundation mode — recommend right architecture, not minimum patch](user_stakeholder_foundation_mode.md) — Sole stakeholder, no deadline. Default to "do it right" over "ship today"; Option B over Option A.
- [Design conversation IS the iteration loop](user_design_collaboration_mode.md) — Push and pull on ideas before coding; converge then build. Long-form architecture discussions are the work, not preamble to it.
- [Always recommend the safest, best approach](feedback_safety_first.md) — Lead with ranked safest-first recommendation; never neutral A/B/C menus.

### CSS conventions (every CSS/JSX edit)

- [CSS canonical — buttons, tables, inline styles, tokens](css_canonical.md) — `.btn` + variant on every button; `tree_accordion-dense__*` for every table; no inline `style={{}}`; `--accent`/`--accent-ink` for interactive state, never `--brand`.
- [CSS/HTML naming convention](css_naming_convention.md) — `root-block__Container_Child_leaf` pattern; confirmation step fires only when introducing a NEW root-block or renaming an existing chain; routine additions under an existing root don't trigger.

### Test surface (whenever logging in or creating accounts)

- [Test accounts — Claude-owned + human-owned](test_accounts.md) — Use claude@/claude_N_test@ for testing; HARD RULE on human accounts (gadmin/padmin/user@).

### Stories (when creating any story)

- [All stories MUST go through /stories shortcut](feedback_stories_shortcut_mandatory.md) — No exceptions, no direct Planka writes; every story routes through the skill (solo-dev mode = title + AC only).

### Critical workflow rules (apply every task)

- [Read source when stuck or flying blind](feedback_read_source_when_stuck.md) — If a fix doesn't work, STOP and read 100–200 lines of source before grepping/curling/blaming cache; source is truth.
- [Empirical blast-radius before any change](feedback_empirical_blast_radius.md) — Never rely on a prior agent's summary; read the actual workflow/script/snapshot files yourself before recommending or making cross-cutting changes.
- [Deferrals always go in the tech-debt register](feedback_deferrals_register.md) — When I defer work ("hold until", "out of scope", "needs its own plan", "follow-up"), file it in docs/c_tech_debt.md with severity + trigger BEFORE the commit that creates the deferral.
- [Never create debt — fix now, flag if detected](feedback_no_debt.md) — Overrides cap-and-defer; introduce no new debt, surface detected debt immediately.
- [Red-green-refactor is non-negotiable](feedback_red_green_always.md) — Always write the failing test FIRST; never refactor/delete and verify after. No exceptions for "obvious" or "mechanical" changes.
- [No hardcoded order/list from DB data](feedback_no_hardcoded_order_from_db_data.md) — Never invent an order/mapping in TSX or Go when the data is DB-driven; if the column doesn't carry the signal, STOP and surface the gap.
- [Bracket-tag commits with scope ref](feedback_scope_commit_bracket_ref.md) — Always include `[B19.1.4]` (or `[solo-dev]` in current mode) in commit subject; otherwise scope-commit-note hook can't match → Unmatched.
- [Cookbook every non-trivial SQL + bash](feedback_cookbooks.md) — Append novel psql queries to `docs/c_sql_cookbook.md` and novel bash commands to `docs/c_bash_cookbook.md` before moving on; stop re-deriving same incantations.

### Rules

1. When you learn something worth remembering, write it to the right file immediately. If it's load-bearing (incident-earned safety, active mode, collaboration baseline, critical workflow rule), index it here. Otherwise index it in [MEMORY_ARCHIVE.md](MEMORY_ARCHIVE.md).
2. Keep this file as a current index with one-line descriptions. Aim for ≤25 entries. If you cross that, something here either belongs in the archive or has been derived enough into code/docs that it can be dropped.
3. Read this file at session start. Load other files (here or in the archive) only when relevant.
4. **Archive is grep-able, not auto-loaded.** When a question touches an archive topic (e.g. "how does the PageBuilder architecture work?", "what's the tracker API key?"), grep MEMORY_ARCHIVE.md → read the linked file.
5. **Project memory dir is canonical:** `.claude/memory/` inside this repo. Mirrored to `~/.claude/projects/.../memory/` so Claude Code's auto-load picks it up. Always write to project; sync to global as a follow-up.
6. **Boot files are not indexed.** Boot snapshots (`boot1.md`, `boot2.md`, …, `bootA.md`) live in this directory but DO NOT get index entries — read via the `<b> -N -R` skill.
