# Technical debt — standing rule and register

This is a **standing instruction** for Claude Code in this repo. Read it on any task that:

- adds a new abstraction, table, polymorphic relationship, or cross-cutting pattern
- touches code already flagged in the register below
- does a refactor, schema change, or architectural decision
- delivers a workaround, "TODO", or anything labelled "we'll fix this later"

If none of those apply, you do not need to load this doc.

## The standing rule

Every task **maintains the debt register**. That means three obligations, in order:

1. **Identify** — when you spot debt during a task (smell, workaround, missing cleanup, latent foot-gun, brittle invariant), name it. Don't keep it in your head.
2. **Measure** — give it a severity (S1/S2/S3) and a trigger (the event that turns latent debt into pain). Severity and trigger are the only fields that matter; everything else is colour.
3. **Recommend** — record the cheapest action that caps the debt (doc + canary + lint), and the action that pays it down (refactor + migration). Caps go in immediately; pay-downs wait for the trigger.

The rule is **not** "fix all debt now". The rule is **debt is never invisible**. Visible debt is bounded; invisible debt compounds.

## Severity scale

| Severity | Meaning | Response |
|---|---|---|
| **S1 — bleeding** | Causing incidents now, or will on the next deploy/handler/feature | Fix in the same PR. No exceptions. |
| **S2 — latent** | Dormant but the trigger is foreseeable (next archive handler, second writer, first prod tenant, etc.) | Cap immediately (doc + canary + comment at the trigger site). Schedule pay-down before trigger fires. |
| **S3 — structural** | Slow tax on every future change in this area | Cap with the register entry. Pay down when the area is touched for another reason, or when a second symptom appears. |

## What "cap" means

A cap is a cheap, mechanical safeguard that makes the debt visible the moment it bites:

- **Doc** — a leaf under `docs/c_*.md` describing the rule, the why, and the trigger
- **Canary** — a test that fails when the latent condition becomes real (orphan rows, missing handler, drifted schema, etc.)
- **Lint / comment / assertion** — at the most likely future-edit site, a comment or runtime check that surfaces the rule when someone touches it
- **Register entry** — the row below, so future-Claude finds it without re-deriving

Caps cost hours, not days. If the cap costs days, it's not a cap — it's the pay-down, and you're doing it for the wrong reason.

## Process per task

When you finish a task, before reporting back:

1. **Did this task introduce debt?** If yes, add an entry below.
2. **Did this task touch debt already in the register?** If yes, either pay it down (and remove the entry) or update the entry with what you learned.
3. **Did the trigger fire on any S2 entry?** If yes, raise it to S1 and address before merging.
4. **Recommend** — if any S2/S3 entry has crossed its trigger condition during this work, surface it to the user in your final message: "While doing X, I noticed entry N's trigger has fired — recommend pay-down now."

Do not silently fix every S3 you see — most are correctly deferred. Do surface them when you're already in the area.

## Register

One row per item. Keep entries terse. Date format: `YYYY-MM-DD`. Mark resolved items with `~~strikethrough~~` and a resolved-on date for one cycle, then remove.

| ID | Added | Severity | Area | Debt | Trigger (what makes it bite) | Cap in place | Pay-down |
|---|---|---|---|---|---|---|---|
| ~~TD-001~~ | 2026-04-23 | ~~S2~~ | ~~DB / polymorphic FKs~~ | ~~Four polymorphic relationships have no Postgres-enforced RI; only `page_entity_refs` has a live writer, and it has no archive cleanup.~~ | ~~First archive/delete handler for `workspace`, `portfolio`, or `product` ships without calling `cleanupPolymorphicChildren`.~~ | ~~[`docs/c_polymorphic_writes.md`](c_polymorphic_writes.md) + canary `backend/internal/dbcheck/orphans_test.go`~~ | **Resolved 2026-04-23 (capped + enforced + service-routed).** Migration 013 dispatch triggers reject orphan inserts at the DB layer; `backend/internal/entityrefs` centralises every polymorphic writer; `bookmarks.go` migrated; `CleanupChildren` ready for archive handlers (none exist yet — capped via registry comment + lifecycle test scaffolding). Phase 4 (per-kind tables) deferred per decision gate — re-open if external review flags the polymorphic shape. See `dev/planning/plan_db_polymorphic_paydown.md`. |
| TD-LIB-001 | 2026-04-24 | S2 | Auth / wire format | JWT dual-accept on `subscription_id` ↔ legacy `tenant_id` claim. Tokens issued before migration 017 still verify because `AccessClaims.UnmarshalJSON` falls back to `tenant_id` when `subscription_id` is absent. | One full access-token TTL passes after deploy (current `JWT_ACCESS_TTL` default 15m) AND a release lands that we want to trim. After that point no live token carries `tenant_id` and the dual-accept code is dead weight masking real bugs. | Custom `UnmarshalJSON` in `backend/internal/auth/tokens.go` with explicit comment naming the grace window. Refresh-token rotation forces re-issue, so the practical drain time is one refresh interval, not one access TTL. | Delete the `UnmarshalJSON` method + the legacy struct field once one full refresh-token cycle has elapsed post-deploy; rely on the natural unmarshal. Single-file diff. |
| TD-LIB-002 | 2026-04-24 | S3 | DB / billing surface | `subscriptions.tier` defaults to `'pro'` for every existing row. The entitlements service that actually maps a paying customer to a tier doesn't exist yet; until it does, every subscription is implicitly pro and the `mmff_library` reconciler will hand out pro presets to free accounts. | First production customer enrols on a non-pro plan, OR `mmff_library` reconciler ships and starts enforcing tier-gated reads. | CHECK constraint pins the column to `(free, pro, enterprise)` so writers can't smuggle bogus values. Column comment names the temporary default. | Wire the billing/entitlements service to write `tier` on subscription creation and on plan change; backfill existing rows from billing source-of-truth before the reconciler enforces tier gating. |
| TD-LIB-003 | 2026-04-24 | S2 | DB / cross-DB consistency | `pending_library_cleanup_jobs` exists but has no worker. Once the first writer enqueues a job (preset-archive propagation, template-instance unlink, library-mirror purge) the row sits forever. | First archive/adopt handler against a `mmff_library`-derived entity ships and INSERTs into the queue. The DB-side enqueue is harmless on its own; the user-visible bug is "I archived a preset and the cross-DB mirror still serves it." | Table + indexes + constraints exist; the contract (claim with `FOR UPDATE SKIP LOCKED`, exp backoff, `dead` status at `max_attempts`) is documented in the migration header and `feature_library_db_and_portfolio_presets_v3.md` §4. No writer can enqueue yet, so no orphan jobs accrue. | Implement the worker (Go binary or in-process goroutine — TBD per v3 plan §4) before merging the first writer that calls into it. Add a CI canary `SELECT count(*) WHERE status = 'dead'` once the worker exists. |
| TD-LIB-004 | 2026-04-24 | S3 | DB / migration tooling | The `\i` "dry-run" pattern (`BEGIN; \i 017_…sql; ROLLBACK;`) doesn't work — inner `BEGIN/COMMIT` in the included file finalises before the outer `ROLLBACK` runs, so the migration commits silently. Discovered while applying 017–019; verified migrations applied despite intent to roll back. | Next attempt to dry-run a migration this way against shared infra. The blast radius scales with the migration. | This entry. Anyone doing a dry-run on shared infra must use `pg_dump` + restore to a scratch DB, OR strip the inner `BEGIN/COMMIT` from the file before the dry-run, OR run against a local Postgres. | Add a `db/scripts/dry-run-migration.sh` that copies the file, strips `BEGIN/COMMIT`, runs it inside an outer transaction with `ROLLBACK`, and reports diffs. Make it the documented path in `c_postgresql.md`. |
| TD-LIB-006 | 2026-04-25 | S3 | Frontend / library catalogue | `/portfolio-model` hardcodes the seeded MMFF family id (`00000000-0000-0000-0000-00000000a000`) because no list endpoint exists. Fine while there's exactly one bundle, but adding a second system bundle (SAFe / Jira / Rally / Kanban — Phase 6) means the page will only ever show MMFF. | Second model bundle ships from MMFF (Phase 6 first system-model release). At that point the page silently hides the new bundle. | Constant + comment at top of `app/(user)/portfolio-model/page.tsx` names the limitation; this register entry. | Add `GET /api/portfolio-models` list endpoint (paginated, filtered by `scope` + visibility), then replace the constant with a fetch + selector. UI-only swap once the endpoint exists. |
| TD-LIB-007 | 2026-04-25 | S2 | DB / cross-DB consistency | `subscription_portfolio_model_state.adopted_model_id` references `mmff_library.portfolio_models.id` but Postgres has no cross-DB FKs, so the reference is app-enforced only. If the adoption handler skips the validation step, or if a library row is hard-deleted (today blocked by soft-archive convention only), the adoption row becomes a dangling pointer. | First adoption-handler writer ships and either (a) forgets to validate against `mmff_library` before INSERT, or (b) the library reconciler ever does a hard DELETE on `portfolio_models`. | Migration 026 column comment + table comment name the limitation. CHECK constraint on `status` + partial unique constrain the row vocabulary so a reconciler can mark stale adoptions `failed`/`rolled_back` cleanly. | Wire the adoption handler through `backend/internal/entityrefs` (or a sibling cross-DB writer service) so every INSERT goes through one validating path; add nightly reconciler SELECT to compare `adopted_model_id` against live `mmff_library.portfolio_models.id` (per `feature_library_db_and_portfolio_presets_v3.md` §8 orphan sweep). |
| TD-LIB-008 | 2026-04-25 | S3 | DB / cross-DB consistency | `error_events.code` is a string FK by value to `mmff_library.error_codes.code`. Postgres can't enforce a cross-DB FK. Same class of debt as TD-LIB-007 but lower severity: an unknown/renamed code degrades a dashboard label, not a saga. | First reporter ships and (a) writes a code that doesn't exist in the library catalogue, or (b) the library renames a code without a vector-side rename pass. The reader sees a row with no library label. | Migration 028 column + table comments name the limitation. Index on `(subscription_id, code, occurred_at DESC)` keeps "find unknown codes" SELECTs cheap. | Add a writer-side validator (`reportError(code, …)` SHOULD reject unknown codes in dev mode and silently downgrade in prod), then a nightly reconciler SELECT comparing `DISTINCT error_events.code` against `mmff_library.error_codes.code`. Cheap UI-only follow-up — no schema change required. |
| TD-LIB-009 | 2026-04-25 | S2 | DB / cross-DB consistency | All five adoption mirror tables (`subscription_layers`, `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`, `subscription_terminology`) carry `source_library_id` + `source_library_version` referencing `mmff_library.portfolio_model_*` rows with no DB-enforced cross-DB FK. If the adoption orchestrator skips validation, or the library hard-deletes a row, every dependent mirror row becomes a dangling snapshot. Severity is S2 not S3 because the mirrors are the subscription's source-of-truth for layers/workflows — a dangling mirror row breaks state transitions, not just a dashboard label. | First write through the adoption orchestrator (card 00008) that bypasses the library-validation step, OR the library reconciler ever performs a hard DELETE on a `portfolio_model_*` row. The user-visible bug: workflow that points at a `source_library_id` for which no library row exists, blocking upgrade reconciliation. | Migration 029 header + per-table `COMMENT ON TABLE/COLUMN` name the limitation. `source_library_version > 0` CHECK keeps the snapshot column non-zero so a reconciler can tell "stamped" from "uninitialised". `idx_<table>_source ON (subscription_id, source_library_id) WHERE archived_at IS NULL` makes orphan-sweep SELECTs cheap. Same pattern + writer-rules contract as TD-LIB-007. | Route every mirror INSERT through one validating path (e.g. extend `backend/internal/entityrefs` or a sibling adoption writer) that confirms `(source_library_id, source_library_version)` exists in `mmff_library` before commit. Add nightly reconciler SELECT (per `feature_library_db_and_portfolio_presets_v3.md` §8) that joins each mirror table's `(source_library_id, source_library_version)` against `mmff_library.portfolio_model_*` and reports orphans. |

## Anti-patterns (don't do these)

- **Silent fix.** Resolving debt without removing the register entry — future-Claude will assume it's still latent and add a duplicate cap.
- **Over-capping.** Building elaborate guards for S3 debt that has no trigger in sight. Caps are for S1/S2; S3 gets a register entry and that's it.
- **Pay-down at first sight.** Refactoring a polymorphic relationship "while you're in there" on an unrelated task. Pay-downs are scheduled, not opportunistic, unless the trigger has fired.
- **TODO comments without a register entry.** A TODO in code is debt that isn't measured. Either add the register entry or do the work.
- **"We'll come back to it."** Either it's S1 (do it now), S2 (cap it now, schedule pay-down), or S3 (register it). There's no fourth option.

## How to surface to the user

When you add or escalate a register entry during a task, end your reply with a one-line debt note:

> **Debt:** added TD-007 (S2) — bookmark cache lacks invalidation on tenant rename. Capped with doc; pay-down deferred until tenant rename ships.

When a trigger fires:

> **Debt trigger:** TD-001's pay-down condition met (second polymorphic writer landing in this PR). Recommend migrating `entity_stakeholders` to per-kind tables before merge.

Short, factual, no ceremony. The user decides whether to act.
