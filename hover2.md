# Handover — 2026-05-18 evening

Reboot pickup note. Read this first, then [Vector_Scope.md](Vector_Scope.md) for the canonical state.

---

## Where we are right now

**Today closed two big initiatives. Two WIP slots are free of 5.**

| Initiative | Status | Closing commit |
|---|---|---|
| **B16.8 Security Hardening** (all 5 phases) | ✅ DONE 2026-05-18 | `176eef5` (P5) |
| **RF1 Codebase Recovery (PLA-0048)** | ✅ DONE 2026-05-18 | `9435539` |
| FE-POR-0002 Chrome Scope Picker | ✅ DONE 2026-05-17 | (earlier) |
| **FLOW1** Flow-State Kind + Pull-Eligibility | 🔵 IN FLIGHT | unstarted today |
| **F1** Artefact-Type + Flow-State Customisation | 🔵 IN FLIGHT | unstarted today |

Pre-reboot session was a long marathon (started with finishing B16.8.10 E2E debug, then walked the entire B16.8 ladder P1→P5, then closed RF1's two open stop gates). Built up significant context that doesn't need to survive.

## What the next session should do first

1. **Read [Vector_Scope.md](Vector_Scope.md) lines 1-15** for the current "Last updated" + WIP slot status. Doc version is 2.43.
2. **Skim [docs/c_tech_debt.md](docs/c_tech_debt.md) for entries added 2026-05-18** — there are new TD entries from today's work that bear on what's next:
   - `TD-SEC-HIBP-PROMOTE-TO-ENFORCE` (B16.8 P4 rollout path: telemetry → soak → enforce)
   - `TD-SEC-REDIS-DEPENDENCY` (trigger = multi-replica deploy)
   - `TD-SEC-DOMPURIFY-CLIENT` (consolidate when 3rd consumer appears)
   - `TD-UI-PLACEHOLDER-HANDLERS` (6 dead onClick handlers in CustomFieldsTree + p_ObjectTree)
   - `TD-RF1-DOC-GO-ADOPTION` (41 packages need `doc.go`)
   - `TD-RF1-TEST-COLUMN-RENAME-DRIFT` (14 packages with pre-RF1.4.4 column refs in test fixtures)
3. **Run `git log --oneline -20`** to see today's commit chain. Today landed both my work (B16.8 phases, RF1 close, Sentinel) and a parallel agent's DPoP work (RFC 9449 device binding) — they coexist cleanly.

## What was shipped today (chronological)

Eight commits in two streams. Mine first, then DPoP work in parallel.

**B16.8 Security Hardening (5 phases, my work):**
- `b2c64b6` — B16.8.10 E2E fixes: INET cast in sessions-list SQL + remove duplicate `r.Delete` in workspaces Mount (was silently shadowing the step-up gate)
- `76c93a2` — P1 scope close-out (markers .8/.9/.10/.12)
- `627ddd1` — P2: DOMPurify wraps on Header.tsx + HelpDocRenderer.tsx (defense-in-depth over backend `SanitiseHelpBodyHTML`)
- `b0cf595` — P3: Sentinel coordination layer (`app/contexts/Sentinel.tsx`) closes JWT/scope desync via module-level `scopeReloadRef`
- `dfcaa9e` — P4: HIBP k-anonymity breach-password check (`backend/internal/auth/hibp.go`); disabled by default, 3-mode env, fail-open
- `176eef5` — P5: audit-event alerting (`backend/internal/alerting/`); HMAC-SHA256-signed webhook fan-out for selected `audit_logs` actions

**RF1 close-out:**
- `1c9a98a` — RF1.1.8 stop gate closed (all 5 drift-prevention lints green)
- `9435539` — RF1 fully closed; RF1.7 gaps captured as TD entries

**Parallel DPoP work (NOT mine, but landed in the same session):**
- `8722a54` — DPoP substrate (migrations + parser + JTI cache)
- `177db51` — DPoP frontend keypair + proof minting
- `b9c8b68` — DPoP backend enforcement live
- `14e4f10` — DPoP refresh-token binding
- `3634361` — cookie handoff replaces `/login?redirect=`
- `e82ef94` — `TD-URL-SHAREABLE-VIEWS` filed

There was a transient build break mid-afternoon when DPoP added a `dpopJKT string` parameter to `SignAccessToken`/`Login`/`MFAVerifyLogin`/`SwitchWorkspace` before all 6 caller sites had been updated. **Build is green now** as of post-9435539. If the next session sees `go build ./...` red, it's not me.

## Live state of the codebase (verified end of session)

- `go build ./...` — clean
- 5 RF1 drift-prevention lints (`sql-in-sqlfile-only`, `no-empty-route-block`, `exemption-ratchet`, `deferral-needs-td-id`, `package-naming-convention`) all pass against HEAD
- `migrate -dry-run` against all 3 DBs — up to date (after applying `082_drop_subscription_prefix_unique.sql` to `vector_artefacts` mid-session)
- `npx tsc --noEmit` — pre-existing drift in unrelated files (none from today's work)
- Alerting tests (`go test -race ./internal/alerting/`) — 13 tests pass
- HIBP tests (`go test ./internal/auth/ -run TestHIBP|TestQueryHIBP`) — 7 tests pass
- Sentinel feature test (`npx vitest run app/featuretests/__tests__/f_sentinel_scope_reload.test.tsx`) — 6 tests pass
- B16.8.10 contract test (`npx vitest run app/hooks/__tests__/useStepUpAction.test.tsx`) — 5 tests pass

**⚠️ Known test failures (NOT introduced today, pre-existing):**
- 14 backend packages fail `go test` from pre-RF1.4.4 column-rename drift in test fixtures (production code uses the renamed columns correctly). Captured in `TD-RF1-TEST-COLUMN-RENAME-DRIFT`. The packages: addressables, artefactitems, dbinvariants, errorsreport, featuretests (build fail), librarydb, libraryreleases, nav, portfoliomodels, realtime (build fail), roles, timeboxsprints, topology, workspaces.

## Uncommitted dirty state (intentional, not for committing)

- `.claude/*` — local Claude config (CLAUDE.md, MEMORY.md, settings.json)
- `Vector_Scope.md` — clean (committed in 9435539)
- `app/components/QRCodeTrigger.tsx` — pre-existing drift, not touched today
- `app/hooks/useRealtimeSubscription.ts` + `useTopologyHandoffs.ts` — pre-existing drift
- `dev/pages/DevComponentsPanel.tsx` — pre-existing drift
- `context/` (new dir), `.claude/skills/index/` + `memory-write/` (new dirs) — Claude memory infra, leave alone
- `backend/internal/cspreport/` — checked-in elsewhere
- `db/mmff_vector/schema/209_csp_reports.sql` — checked-in elsewhere

Don't stage `.claude/` or `context/` files unless explicitly asked — they're local-only.

## What's next (user's call)

WIP cap is 5, 2 slots free. The four standing tracks:

1. **FLOW1 — Flow-State Kind + Pull-Eligibility Model** (🔵 IN FLIGHT, not started today). Foundational lifecycle primitive (`kind`: backlog/todo/in_progress/done/accepted/cancelled + `is_pullable` flag on flow_states). Unblocks F1. Likely the right next pick — it's the dependency root.

2. **F1 — Artefact-Type + Flow-State Customisation page** (🔵 IN FLIGHT, not started today). User-facing settings page, depends on FLOW1.

3. **Unpark something** (3 parked items: FE-POR-0003 topology scope clamp on artefact reads, B18.7 shared methods catalogue, B-SHARE short-link service). FE-POR-0003 has the most context — a Summary clamp landed in `fa434e2` but the full slice hasn't been picked back up.

4. **Pay down today's RF1 gaps** (TD-RF1-DOC-GO-ADOPTION ~3-4hr alphabetical sweep, TD-RF1-TEST-COLUMN-RENAME-DRIFT ~2-4hr mechanical edits). Honest about what's left, but not glamorous.

User asked for the reboot at end of session, didn't pick what's next. Ask before assuming.

## Reminders for the next Claude

- **Solo-dev mode is active** — `.claude/memory/feedback_solo_dev_mode.md` is load-bearing. Foundation > patch. Option B (right architecture, bigger PR) usually beats Option A (smallest correct thing). "Fix the bug" sometimes hides three structural issues — name them.
- **HARD RULES in CLAUDE.md** — human accounts off limits, no destructive git, never assume a database (always trace backend wiring + check `docs/c_c_db_routing.md`), backend env pinned to dev.
- **Test accounts** — `.claude/memory/test_accounts.md`. Use `claude_2_test@` / `claude_3_test@` for testing; never the human accounts.
- **B16.8 alerting + HIBP are shipped but DISABLED by default** in every env. To turn them on, set `AUDIT_ALERT_WEBHOOK_URL` + `AUDIT_ALERT_ACTIONS` (alerting) or `HIBP_CHECK_MODE=telemetry` (HIBP) in env files. Don't enable without checking with user — both have rollout TD entries.
- **DPoP is live as of today.** If you touch auth, account for the `dpopJKT` parameter. The parallel agent did most of the wiring; check `internal/auth/dpop*.go` and `app/lib/dpop.ts` for the surface.
- **Avoid duplicate console.logs.** P5 cleared the noisy ScopeContext ones today. If you add new debug logs, remove them before commit.

## Session-specific feedback the user gave me today

- **Tighter scope than the written plan when reality permits.** Sentinel.tsx P3: the original plan said to shim all four contexts. Audit showed catalogues already coordinate correctly via `useActiveWorkspace`; shipped just Auth↔Scope coordination. User explicitly approved this tighter interpretation. Default: read the plan critically before implementing.
- **Defense-in-depth language matters for procurement.** The user is positioning for defence/finance. When framing TD entries or commit messages, name the standards basis (NIST 800-63B AAL2, RFC 9449, FFIEC 2021, etc.) and the procurement-evidence value.
- **Fail-open is the right default for security controls that depend on third parties.** HIBP outage should never lock users out of their own password change. Alerting webhook failure should never block audit row INSERT. Both have explicit fail-open semantics with audit-log breadcrumbs so ops can spot a sustained outage.
- **When the classifier blocks a destructive action mid-session, surface it and let the user run it themselves.** Migration 082 apply was blocked despite an AskUserQuestion confirmation — pasted the one-liner for the user, picked back up after. Don't fight the classifier.

---

End of handover. Read Vector_Scope.md next.
