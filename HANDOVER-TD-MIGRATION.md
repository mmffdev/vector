# SELF-HANDOVER — Tech-Debt → GitHub Issues migration (PREP phase, not started)

**Written 2026-06-09, before a context reset.** Read this, then resume. This is a
NEW task the user handed off as a first-person work order; I had just finished the
PLAT1.9/1.12 CP-session work (separate, DONE + pushed — see bottom).

---

## THE TASK (user's work order, verbatim intent)

Move Vector's tech-debt tracking off local markdown onto **GitHub Issues + a
Projects v2 board** on `mmffdev-platform` (`git@github.com:mmffdev/mmffdev-platform.git`).
End state: GitHub Issues = single source of truth; the `.md` becomes a stub.

**Decisions LOCKED by the user:**
- Source of truth: the **monorepo** copy `…/MMFFDev - Platform/products/vector/docs/c_tech_debt.md`. ALSO migrate `…/products/vector/docs/Security/Sentinel/sentinel_tech_debt.md` (platform-scoped, `TD-SENT-*` namespace).
- Schema: Issues + Projects v2 **typed custom fields** (Severity / Area / Added), not just labels.
- Old register: retire fully → stub linking to GitHub Issues.

**User's 3 answers (already given — DO NOT re-ask):**
1. **Completed entries** (`c_c_tech_debt_completed.md`, ~82) → migrate as **CLOSED issues** for history (the `[TD-review …]` verdicts are the SOC2/defence audit-trail value). VERIFY that file path exists first — I never confirmed it.
2. **Rewire CLAUDE.md + skills**: LAND THE DATA FIRST, rewire as a **separate follow-up commit** (don't break the `<report>`/`<scope>` write-target mid-migration).
3. **Board**: ONE board, `area:` field discriminates (not separate boards). Saved view per lane if wanted.

**User's final decision on execution scope (just given):**
> **PREP ONLY — STOP BEFORE ANY GITHUB WRITES.** A sub-agent does the merge + parse + writes the create-script (dry-run), creates ZERO issues/boards. User + I review the JSON + script, user green-lights, THEN a second run executes. This matches the user's own "stop to eyeball" gate.

I was about to dispatch a `general-purpose` sub-agent for the PREP phase when the user asked for this handover. **Next action: dispatch that sub-agent (prep only).**

---

## ⚠️ CRITICAL FINDING — the two registers have DIVERGED BOTH WAYS

The user's plan assumed monorepo = canonical + a one-way freshness sync. **That is WRONG and would lose data.** I diffed by TD-ID set:

- **STANDALONE** (`…/MMFFDev - Vector/docs/c_tech_debt.md`, 123 active rows) has **`TD-PLATFORM-IDENTITY-CARVEOUT`** (I wrote it 2026-06-09 — the AC4 carve-out blast-radius map, S2, 4 cross-DB JOINs + verify query). **NOT in the monorepo copy.**
- **MONOREPO** (`…/Platform/products/vector/docs/c_tech_debt.md`, 124 active rows) has **`TD-PLAT-AUTH-SDK-ADOPTION`** + **`TD-PLAT-AUTH-BRIDGE-ADOPTION`**. **NOT in the standalone.**

So **Step 0 must be a TWO-WAY MERGE**, not a one-way sync. The "2026-06-07 TD-review marker" heuristic does NOT catch this (carve-out is dated 06-09, one side only). **Reconcile by TD-ID union.** The delta is exactly these 3 IDs (1 standalone-only + 2 monorepo-only); also re-check body text of shared IDs for the [TD-review 2026-06-07] verdicts (TD-LIB-003, TD-DB-003, TD-API-002, TD-PG-002 etc.). True superset ≈ **125 active entries**. All 3 delta entries migrate as **OPEN** (live triggers).

Diff command that found it (re-run to confirm current state):
```bash
S="…/MMFFDev - Vector/docs/c_tech_debt.md"; M="…/Platform/products/vector/docs/c_tech_debt.md"
comm -23 <(grep -oE "TD-[A-Z0-9-]+" "$S" | sort -u) <(grep -oE "TD-[A-Z0-9-]+" "$M" | sort -u)  # standalone-only
comm -13 <(grep -oE "TD-[A-Z0-9-]+" "$S" | sort -u) <(grep -oE "TD-[A-Z0-9-]+" "$M" | sort -u)  # monorepo-only
```

---

## GROUND TRUTH (verified 2026-06-09)

- **`gh` auth**: active account `mmffdev` (keyring). Token scopes: `admin:public_key, gist, read:org, repo, workflow` — **NO `project` scope.** Projects v2 field writes WILL fail until `gh auth refresh -s project` (INTERACTIVE → the user must run it; ASK first). REST can't set v2 fields — board/field creation needs `gh api graphql`.
- **Register table schema**: `| ID | Added | Severity | Area | Debt | Trigger | Cap in place | Pay-down |`. Cells contain pipes inside backticks/links — **parse defensively** (don't naive-split on `|`).
- **`sentinel_tech_debt.md`** is referenced by a **HARD RULE in `.claude/CLAUDE.md`** (Sentinel sole-owner rule cites `TD-SENT-AUTH-EXTRACT`). If stubbed, that link MUST repoint to the issue or a load-bearing rule breaks.
- **282 `TD-*` refs across 136 source files** are canary/comment anchors — DO NOT touch; they keep working as references to each issue's `[TD-ID]` title.
- **HARD RULES that bind the sub-agent**: no branch without explicit user approval (commit on CURRENT branch `main`); `git diff --cached --stat` before every commit; never touch human accounts. Creating 123 live issues is outward-facing → only after user green-light (the PREP gate enforces this).
- **Uncommitted churn in STANDALONE Vector (NOT mine, do NOT sweep into any commit)**: `.claude/c_file_index.md`, `api-snapshots/caller-map.json`, all `log-viewer/*`, `?? .claude/memory/crypto-curve-preference.md`, `?? log-viewer/HANDOVER.md`. Explicit-path `git add` only.

---

## PREP-PHASE PLAN (what the sub-agent does — ZERO GitHub writes)

1. **Two-way merge** standalone ⇄ monorepo `c_tech_debt.md` by TD-ID union → one canonical superset (write it INTO the monorepo copy, the locked source of truth). Preserve every `[TD-review 2026-06-07 …]` verdict verbatim. Same for `sentinel_tech_debt.md` (likely no divergence, but check).
2. **Parse** the merged Register (~125 active) + the completed file (~82, if the path exists) into `td-migration.json` — structured records: `{id, added, severity, area, debt, trigger, cap, paydown, state: open|closed}`. Defensive pipe-splitting.
3. **Write the idempotent create-script** (dry-run mode, creates nothing): per record → issue title `[TD-ID] <short name>`, labels `tech-debt`+`severity:Sn`+`area:<slug>`, body `## Debt / ## Trigger / ## Cap in place / ## Pay-down` + migration footer (orig ID + added date). Script checks for existing `[TD-ID]` title before create (resumable). Plans the Project v2 board + 3 fields via `gh api graphql`.
4. **STOP.** Output `td-migration.json` + the script for me + the user to review. NO `gh` writes, NO board, NO issues.

**Then (after user green-light, a SECOND run):** auth refresh (user, interactive) → create board+fields → create issues (idempotent) → write TD-ID→issue# map → verify issues==rows + spot-check per severity.

**Then (SEPARATE follow-up commit, NOT this pass):** rewire `.claude/CLAUDE.md` tech-debt rule + `<scope>`/`<report>` skills to open issues instead of editing `.md`; replace both `.md` copies with stubs linking to `…/issues?q=label:tech-debt`; repoint the `TD-SENT-AUTH-EXTRACT` hard-rule link.

---

## REPO STATE (both clean + pushed, 2026-06-09)
- **Vector** `git@github-mmffdev:mmffdev/vector.git` — HEAD `6f3b79ef`, in sync with origin.
- **Platform** `git@github-mmffdev:mmffdev/mmffdev-platform.git` — HEAD `d15493e6`, in sync with origin.

## CONTEXT: what I finished JUST BEFORE this task (DONE, don't redo)
PLAT1.9/1.12 CP-session work — all committed + pushed, both repos green:
- Audit trail (platform `04fcaaba`), entitlement gate, PLAT1.9 FE flag-gated (`b57c90c4`/`3e4f0c1b`), DPoP-keypair binding + **CP-owned refresh** (platform `2a45657b` `internal/oidc/refresh` + vector `657ff47b` `refreshCpSession`). Tests: refresh store 8 + HTTP flow 6 + e2e 8 + cpAuth 9, all green. Flag `NEXT_PUBLIC_CP_AUTH_ENABLED` (FE) / `CP_AUTH_DUAL_ACCEPT`+`CP_AUTH_SHADOW` (Vector backend) / refresh store wired in CP `cmd/server/main.go`, all default OFF.
- Self-handover for THAT work: `…/MMFFDev - Platform/HANDOVER-SELF-PLAT1.7.md` (separate file, fully up to date).
- The ONLY true remaining PLAT gaps: the deliberate default-ON cutover flip (PLAT1.12 AC1, mechanism built/flag off), real interactive CP login (retire X-CP-Authenticated-User scaffold), durable substrates (in-mem→platform DB), and the approval-gated AC4 carve-out.

## RESUME ORDER
1. Re-run the two-way TD-ID diff (above) — confirm the 3-ID delta still holds (I may have merged it, or it may have grown).
2. Dispatch the PREP-phase sub-agent (general-purpose), brief = the PREP-PHASE PLAN section. Emphasise: TWO-WAY merge, ZERO GitHub writes, stop at `td-migration.json` + script.
3. Review the JSON + script with the user. Confirm `c_c_tech_debt_completed.md` path exists.
4. Only after green-light: the user runs `gh auth refresh -s project`, then the execute run.
