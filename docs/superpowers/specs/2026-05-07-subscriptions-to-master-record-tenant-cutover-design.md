# PLA-0024 — `subscriptions` → `master_record_tenant` cutover

> **Status:** draft, awaiting review.
> **Plan ID:** PLA-0024 (next available; allocated against `docs/c_plan_index.md`).
> **Date:** 2026-05-07.
> **Approach:** option C (hybrid — atomic DB rename, phased app migration via transitional view).

## 1. Goal

Cut the codebase off the `subscriptions` table and onto `master_record_tenant.tenant_id` as the canonical tenant identity. Drop `subscriptions` at the end. Net result: one tenant table, one column name (`tenant_id`), one consistent term across DB / Go / TS / JWT / docs.

## 2. Why now

- **PLA-0023** (vector-artefacts cutover) and the new tenant-settings page have already established `master_record_tenant` as the live tenant record. Continuing to leave 36 FK columns named `subscription_id` and a `subscriptions` table that exists only as a join target is technical debt that grows with every new table.
- The naming rename is irreversible-by-cost — every table added under the current shape has to be undone later, so the cost compounds.
- No live external users → atomic DB cutover is cheap.

## 3. Non-goals

- No change to JWT signing keys, algorithms, or session lifetime.
- No change to RBAC model (roles, permissions, role_permissions stay).
- No change to row-level tenant isolation semantics — purely a rename + FK retarget.
- No data semantics change. Every existing row's tenant identity is preserved.

## 4. Approach — option C (hybrid)

| Layer | Style | Reason |
|---|---|---|
| DB schema | **Atomic** — one migration renames every column + retargets every FK + creates a transitional view | Column renames are cheap in Postgres; doing them piecemeal multiplies migration count without reducing risk |
| Backend Go | **Phased** per package | Each package has tests; flipping one package at a time keeps the test signal honest |
| Frontend TS | **Phased** per file/route | Same reason; also reduces merge-conflict surface |
| Legacy table drop | **Atomic** at the end | Once readers are gone, drop the view + legacy table in one final migration |

The transitional `subscriptions` VIEW is the keystone. After Phase 1, any unmigrated app code reading from `subscriptions` continues to work (read-only) because the view projects `master_record_tenant` columns under the old names. Writers that target `subscriptions` directly will fail — that's intentional, the impact map showed there are no such writers in user-facing code paths (writes go through service layers that we're migrating in Phase 3).

## 5. Phases

### Phase 1 — DB cutover (single atomic migration)

**File:** `db/schema/129_subscriptions_to_master_record_tenant.sql` + paired DOWN.

Steps inside one transaction:

1. Drop `master_record_tenant.tenant_id`'s FK to `subscriptions(id)`. The PK becomes free-standing.
2. Rename `subscriptions` → `_subscriptions_legacy` (preserve as a table for rollback safety).
3. For each of the 36 vector tables holding `subscription_id` (full list from impact map): drop the FK constraint, rename column → `tenant_id`, add new FK → `master_record_tenant(tenant_id)` preserving the original `ON DELETE` action, rename indexes containing `subscription_id` in their name.
4. `users` table: same treatment — `subscription_id` → `tenant_id`, FK retargeted to `master_record_tenant(tenant_id)`.
5. Library schema (`mmff_library`): `portfolio_models.owner_subscription_id` → `owner_tenant_id`; `portfolio_model_shares.grantee_subscription_id` → `grantee_tenant_id`; `release_channel.audience_subscription_ids` → `audience_tenant_ids`. These are app-enforced (no DB FK), so this is a pure column rename.
6. Recreate `subscriptions` as a VIEW: `CREATE VIEW subscriptions AS SELECT tenant_id AS id, tenant_name AS name, /* enumerate all original columns */ FROM master_record_tenant;`. Read-only by default (Postgres views are read-only unless rules are added — we deliberately don't add them).
7. Audit any trigger functions that referenced `subscription_id` and `CREATE OR REPLACE` them with the new column name.

**DOWN** reverses the entire transaction: drop view, restore physical table from `_subscriptions_legacy`, rename all columns back, restore FKs.

**Rollback constraint:** if Phase 1 lands and any Phase 2/3/4 work fails, revert by running the DOWN — the view and legacy table both exist for that purpose.

### Phase 2 — Auth boundary

The auth boundary is the most load-bearing rename. Three commits:

- **Backend auth (`backend/internal/auth/`)**: rename `User.SubscriptionID` → `User.TenantID`. JWT `AccessClaims` gains `TenantID`; the unmarshaler (already partially in place per the impact map) accepts either claim name during grace. Token writers emit `tenant_id`. SQL flips from `SELECT subscription_id FROM users` → `SELECT tenant_id FROM users`. API key context key renames `api_key_subscription_id` → `api_key_tenant_id`.
- **Audit logger**: payload struct field rename. New rows carry `tenant_id`; historical rows keep their `subscription_id` payload (accept the discontinuity — don't backfill).
- **Frontend `AuthContext`**: type field renamed `tenant_id`; reader accepts either key from the response for one cycle.

After Phase 2, force re-login (single config flip) so every active session carries a `tenant_id`-shaped token.

### Phase 3 — Backend service migration

One package per commit, each with its own tests passing. Packages identified from the impact map:

- `entityrefs` (3 SQL strings)
- `ranking` (6 SQL strings)
- `portfolioitems` (9 SQL strings)
- `workitems` (full count TBD — sweep)
- `workitemsv2` (full count TBD — sweep)
- `libraryreleases` (uses `u.SubscriptionID` indirectly via `Reconciler.Count`, `subscriptionTier`)
- Sweep: any package matching `grep -rn 'subscription_id\|SubscriptionID' backend/` after the named packages flip

Each commit updates SQL strings, struct fields, method parameter names (where they encode tenant identity), and tests.

### Phase 4 — Frontend migration

Per-file/per-route commits:

- Wire types: `app/lib/workspacesApi.ts`, `app/lib/topologyApi.ts`, `app/(user)/workspace-settings/_shared.tsx`, `app/hooks/useRealtimeSubscription.ts`.
- AuthContext consumers: sidebar (`AppSidebar_2.tsx`), work-items page, admin/roles page.
- API route handlers: `app/api/v2/strategy-items/route.ts` (+ `[id]`), `app/api/v2/field-library/route.ts` (+ `[id]`).
- Portfolio-model: `subscriptionId` props → `tenantId` across `page.tsx`, `AdoptionOverlay.tsx`, `adoptionConstants.ts`. Telemetry payload field renamed in the same commit.

A new lint rule `lint:no-subscription-id` (Python script under `dev/scripts/` per the project's lint convention) lands at the end of Phase 4 to prevent regressions: any new `subscription_id`/`subscriptionId`/`SubscriptionID` reference fails CI.

### Phase 5 — Drop legacy

**File:** `db/schema/130_drop_subscriptions_view.sql` + paired DOWN.

Steps:

1. `DROP VIEW subscriptions;`
2. `DROP TABLE _subscriptions_legacy;`
3. Update `docs/c_schema.md` to remove the `subscriptions` row and any references.

DOWN recreates the view from `_subscriptions_legacy` (which means the DOWN must be paired with a backup taken before step 2).

Phase 5 lands only after Phase 4 has been live with no read errors against the view for a full session-cycle.

### Phase 6 — Documentation + memory

- `docs/c_schema.md`: remove all `subscription_id` references; add the new `tenant_id` column to each table's documentation.
- `docs/c_security.md`: rename any auth-boundary references.
- `.claude/memory/project_subscriptions_rename.md` → mark complete or delete.
- `c_plan_index.md`: register PLA-0024 as `complete`.

## 6. Risks & mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Library schema's `owner_subscription_id`/`grantee_subscription_id` are app-enforced FKs that span DBs (`mmff_library` → `mmff_vector`). Renaming the column doesn't break the data, but library service code reading these columns must update in lockstep. | Single library service commit in Phase 3 covering both schemas. |
| R2 | Active JWTs in flight at the moment of Phase 2 deploy. | Token reader accepts both `subscription_id` and `tenant_id` claim shapes for one cycle; after Phase 2, force re-login. |
| R3 | Audit log historical rows carry `subscription_id` JSON payload. | Accept the discontinuity. New rows use `tenant_id`. Audit query layer must read both keys (one-line change). |
| R4 | The transitional `subscriptions` VIEW must mirror every column of the original table. Missing columns → silent breakage in unmigrated readers. | Phase 1 includes a column-by-column enumeration step against the live `subscriptions` table; verify view DDL against `\d subscriptions` output before applying. |
| R5 | Trigger functions touched by 126/127/128 are still recent — rebuilding them in Phase 1 risks regression. | Phase 1 explicitly `CREATE OR REPLACE`s every trigger function that references either column; tested via no-op UPDATE on each affected table. |
| R6 | Test fixtures with hardcoded `subscription_id` will break en masse during Phase 3/4. | Each per-package commit updates its own tests. Don't ship a phase commit with red tests. |
| R7 | The `lint:no-subscription-id` rule could collide with intentional historical references in seed comments / migration files. | Lint rule scopes to `app/`, `backend/`, `dev/` source roots; excludes `db/schema/` and `db/library_schema/` (migrations preserve historical names). |

## 7. Story decomposition (preview only — not yet filed via `<stories>`)

~17 cards across 6 phases. F-estimates approximate; risk levels per the project's RISK-LOW/MED/HIGH ladder.

**Phase 1 — DB cutover**
- DB cutover migration (rename 36 + users + library, view, trigger fns) — **F8 / RISK-HIGH**

**Phase 2 — Auth boundary**
- Backend auth: User.TenantID + JWT claim flip + grace reader — **F5 / RISK-HIGH**
- Audit logger struct rename — **F2 / RISK-LOW**
- Frontend AuthContext: tenant_id with sub_id grace — **F3 / RISK-MED**

**Phase 3 — Backend services**
- entityrefs SQL flip — **F2 / RISK-LOW**
- ranking SQL flip — **F3 / RISK-LOW**
- portfolioitems SQL flip — **F5 / RISK-MED**
- workitems + workitemsv2 SQL flip — **F5 / RISK-MED**
- libraryreleases SQL flip (covers cross-DB) — **F3 / RISK-MED**
- Backend sweep (residual packages) — **F3 / RISK-LOW**

**Phase 4 — Frontend**
- Wire types + AuthContext consumers — **F3 / RISK-LOW**
- v2 API routes SQL flip — **F3 / RISK-LOW**
- Portfolio-model props rename — **F5 / RISK-MED**
- `lint:no-subscription-id` rule — **F3 / RISK-LOW**

**Phase 5 — Drop legacy**
- Drop view + legacy table — **F3 / RISK-MED**

**Phase 6 — Docs + memory**
- Update c_schema.md, c_security.md, memory entries, plan index — **F2 / RISK-LOW**

Total estimate: **F58** ≈ 4–6 working sessions if executed sequentially, fewer if Phase 3/4 packages run in parallel commits.

## 8. Acceptance

- All 37+ tables (36 + users) read and write `tenant_id`. Confirmed via `information_schema.columns` query: zero rows where `column_name = 'subscription_id'` in user-facing schemas.
- `subscriptions` table no longer exists; the view is dropped.
- No string literal `subscription_id` remains in `app/`, `backend/`, or `dev/` source roots (enforced by `lint:no-subscription-id`).
- Login on a fresh DB succeeds; existing JWTs from before Phase 2 continue to work for the grace cycle.
- All package tests pass.
- `docs/c_schema.md` reflects the new shape.
- `docs/c_plan_index.md` shows PLA-0024 as `complete`.

## 9. Rollback strategy

Each phase commits independently. Per-phase rollback:

- **Phase 1**: `git revert <migration commit>` + run the paired DOWN script. The DOWN restores the physical `subscriptions` table from `_subscriptions_legacy` (which still exists between Phase 1 and Phase 5).
- **Phase 2**: revert the auth commits; tokens carry both shapes during grace, so old/new clients both keep working.
- **Phase 3/4**: revert per-package commits independently.
- **Phase 5**: cannot be rolled back without restoring `_subscriptions_legacy` from a backup. Take a snapshot before applying.

## 10. Out of scope

- Renaming the global "subscriptions" concept in user-facing copy (billing pages, marketing). Tenant identity ≠ billing relationship; that distinction stays.
- API key payload format on disk (the existing API key records still carry `subscription_id` JSON internally — they get rotated on next issuance).
- The `mmff_library` seed comments referring to `subscriptions` table — these are historical narrative; leave as-is.

## 11. Open questions for review

1. **Library schema column rename in Phase 1 vs deferred**: bundling library renames into Phase 1 means one big migration; deferring means the library service can flip independently in Phase 3. Recommendation: bundle (atomic = simpler).
2. **Drop `_subscriptions_legacy` immediately at Phase 5, or keep for one more cycle**: keeping it gives a one-week DOWN window; dropping is cleaner. Recommendation: keep for one cycle then drop in a follow-up commit.
3. **Lint rule scope**: should `dev/scripts/` and `dev/registries/` be exempt or in-scope? Recommendation: in-scope (no historical reason for tooling to reference `subscription_id`).

---

**Next step after this spec is approved:** invoke `superpowers:writing-plans` to produce the bite-sized implementation plan at `docs/superpowers/plans/2026-05-07-pla-0024-subscriptions-cutover.md`, then run `<stories>` to register PLA-0024 + 17 cards in Planka.
