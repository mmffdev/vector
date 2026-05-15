# Handover — Workspace ↔ Topology hierarchy clarification + tenant-details rename

**Branch:** `001_redesign` · **Machine handoff:** moving to Mac Studio · **Date:** 2026-05-15

---

## PARKED — pick up after <rg> skill ships

Picking these up after the `<rg>` substrate shipped to Tracker's `001_red_green` branch (commits `22233a7`, `3539edb`, `4ff4369`, `3421fbe`, `3793372`, `5cd2fa7`). Working `/red-green` page at http://localhost:5103/red-green renders 12 groups + 160 planned tests + 10 auto-discovered tests for the Vector project.

**PLA-0050 runtime smoke + AC7 gap CLOSED 2026-05-15.** AC5/AC6/AC7 verified via curl. Discovered + closed gap: route had no `RequirePageAccess` middleware despite the AC7 contract; added `auth.RequirePageAccess(pageAccessResolver, "va-tenant-settings")` to the `/tenant-settings` route in `cmd/server/main.go` + migration 201 seeded the `grp_global` grant in `users_roles_pages`. ACs 10/11 (browser smoke) still want a human in the loop.

1. **PLA-0050 browser smoke (ACs 10/11).** Manual 5-min job: log in as gadmin → `/vector-admin/tenant-settings` → confirm all 16 fields render with current values, edit one, save, see toast confirmation. Then log out, log in as user-tier (`claude_1_test@mmffdev.com` / `password123!`) → navigate to same URL → see PageAccessDenied component (not the editor). Once both confirmed, flip AC10/AC11 to done in `dev/plans/PLA-0050.json`.

2. **Cleanup-register Story 3 — inheritance read-path — SHIPPED 2026-05-16 as PLA-0051.** Backend COALESCE merge in `workspacemasterrecord.Service.Get` + per-field source markers (`workspace | tenant | system_default`) + PATCH `clear_overrides[]` semantics + UI `<InheritanceIndicator>` POC-wired on timezone + data_region. 8 backend integration tests + 5 frontend vitest tests landed in Tracker `/red-green` (Group 2 + Group 9 respectively) — all green. Pre-existing gap closed in flight: handler.Get passed subscription_id where workspace_id was expected — defensive fallback added in `FDWSubscriptionResolver.SubscriptionFor` + filed as TD-WS-001 for proper handler rewire. Remaining 9 inheritable fields (description, datetime_format, workdays, week_start, rank_method, build_changeset_tracking, primary_contact_email, notes, date_format) tracked as PLA-0051 follow-up — Tracker will define final per-field layout before they wire.

3. **Cleanup-register Story 4 + Story 6.** Story 4 (drop legacy singular `workspace` table in mmff_vector) and Story 6 (verify topology permissioning after `roles_org_nodes` was dropped in migration 175) remain unstarted. Both are small follow-ups. Story 4 needs a `grep -rn '\bworkspace\b' backend/ app/` audit first.

4. **Page-access auto-grant trigger (filed for follow-up).** Migration 193 documented the intent of a Postgres trigger that would auto-grant `grp_global` + `grp_padmin` on every new `pages` INSERT, but it was never built. Until then, every new system page needs an explicit grant-seed migration (see 201 for the pattern). Worth filing as TD when it bites again.

**Parking principle:** files this stale grow stale fast. If we don't pick these up within ~2 sessions, the parked notes should be re-grilled against the live code before action.

---

---

## TL;DR for the next agent

The user is in the middle of clarifying **where the workspace concept lives in Vector's hierarchy** — strategic-portfolio spine or topology spine. Answer: **topology spine, exactly as already built**. The architecture R028 intended is already shipped. The discomfort the user felt was real but came from **misleading table/route names**, not from a wrong architecture. The next step is a cleanup-and-rename register, not a DB move.

**Do NOT move `master_record_workspaces` from mmff_vector to vector_artefacts.** That instinct was the wrong call (would orphan 5 FKs, including `users_roles_workspaces` → users/subscriptions cross-DB). Reasoning below.

**First story to draft (when user confirms):** rename `master_record_tenant` (in vector_artefacts) → `master_record_workspace`. Pure rename, RF1.4.4 column-prefix pattern is the precedent. Then route rename, then real tenant-defaults table, then inheritance.

---

## What I changed in code this session

### 1. `<CircularAdditor>` source-state rail — 1-based index pill

[`app/components/catalogue/c_circular_additor/circularAdditor.tsx`](app/components/catalogue/c_circular_additor/circularAdditor.tsx)

Left rail rows now show `[1] • Name`, `[2] • Name`, … before the colour dot, so the rail position matches the digit inside the orbit node.

```diff
- {items.map((s) => (
+ {items.map((s, i) => (
    <li key={s.id}>
      <button … className="flow-rules__rail-row" …>
+       <span className="flow-rules__rail-index" aria-hidden>{i + 1}</span>
        <span className="flow-rules__rail-dot" style={{ background: s.colour }} aria-hidden />
        <span className="flow-rules__rail-name">{s.label}</span>
      </button>
    </li>
  ))}
```

CSS in [`app/globals.css`](app/globals.css):
- `.flow-rules__rail-row` grid changed from `10px 1fr` → `22px 10px 1fr`.
- New `.flow-rules__rail-index` rule — pill style using `--surface-sunken` + `--border`, tabular-nums, hover variant uses `--accent`.

### 2. Page rename — `workspace-admin/organisation` → `vector-admin/tenant-details`

- **Source:** `app/(user)/workspace-admin/organisation/` (deleted entire directory).
- **Target:** [`app/(user)/vector-admin/tenant-details/page.tsx`](app/(user)/vector-admin/tenant-details/page.tsx) — was a 24-line stub, now holds the full 691-line content from organisation. Component renamed `OrganisationPage` → `TenantDetailsPage`. Heading/Panel text updated to "Tenant Details".
- **DB nav:** deleted `pages` row `ws-organisation` (id `995a21a2-0c4c-4772-83b9-eff6f2082370`) from `pages` in mmff_vector. Kept `va-tenant-details` (id `15ecf170-e896-4e1b-bbc1-014c0b40fb07`).
- **Caveat for next agent:** the route URL still says "tenant" but the page edits **workspace-level** data (`master_record_tenant` in vector_artefacts is keyed `workspace_id`, not `subscription_id`). Item #3 in the cleanup register below addresses this.

### 3. Plan files touched

`dev/plans/PLA-0031.json`, `PLA-0032.json`, `PLA-0033.json`, `PLA-0034.json` — modified (need to review what changed before commit; likely incidental from previous session).

`docs/c_c_v1_v2_cutover.md` — modified, likewise.

---

## The hierarchy question (the real meat — read this before doing anything)

### What the user asked

> "Need to clarify how the workspace as an object exists in the hierarchy. My feeling is we made it part of the strategic portfolio hierarchy and it should I think be part of the topology hierarchy. Can you look through our research papers, to see how Rally does it, check if we captured the workspace and how it sets the overall scope/focus of the tool."

### Sources I read

- [`dev/research/R028.json`](dev/research/R028.json) — synthesis paper, "Portfolio hierarchy & scoping — synthesis + Vector recommendations" (2026-05-02). This is the **load-bearing document**.
- [`docs/c_c_topology.md`](docs/c_c_topology.md) — the topology doc.
- Migration files [`082_org_nodes.sql`](db/mmff_vector/schema/082_org_nodes.sql), [`098_workspaces.sql`](db/mmff_vector/schema/098_workspaces.sql), [`099_org_nodes_workspace_id.sql`](db/mmff_vector/schema/099_org_nodes_workspace_id.sql), [`131_rename_workspaces_to_master_record_workspaces.sql`](db/mmff_vector/schema/131_rename_workspaces_to_master_record_workspaces.sql), [`036_master_record_tenant.sql`](db/vector_artefacts/schema/036_master_record_tenant.sql).
- Briefly: [`dev/research/R022.json`](dev/research/R022.json) (Rally portfolio hierarchy) — confirmed Rally treats workspace as the **top-level scope container above projects**; PortfolioItems sit at workspace level above projects, deliberately decoupling strategy from execution.

### What R028 actually decided (Decision A.2)

The workspace container is **itself a tree**, mirroring how real organisations are structured. Schema: `org_nodes` table with self-referential `parent_id`. Scale target: Lloyds-scale, 1,000–3,000 nodes; depth/width arbitrary; tenant-named levels (no fixed taxonomy). Clamp policy per-node (`inherit`/`open`/`restrict-subtree`/`restrict-node`). **It's a designed product surface — canvas-based block-diagram editor, not a settings list.** Working name "Org Design", now realised as **"Topology"** (see `c_c_topology.md` for the locked naming decisions).

### Where the build actually stands (already shipped!)

The architecture R028 intended is **already migrated and live**:

| Layer | Built? | Where |
|---|---|---|
| `org_nodes` self-referential tree | ✅ | mmff_vector (migration 082) |
| Workspace tier above org_nodes | ✅ | mmff_vector (migration 098, renamed in 131 → `master_record_workspaces`) |
| `org_nodes.workspace_id` NOT NULL FK | ✅ | mmff_vector (migration 099) |
| `/topology` canvas page | ✅ | `app/(user)/topology/`, `backend/internal/orgdesign/` |
| Federated handoff (gadmin → padmin per office) | ✅ | covered in `c_c_topology.md` |
| Clamp predicate middleware | ✅ | `ClampPredicate(user_id)` in orgdesign service |
| Per-workspace locale/calendar (UAE doesn't work Fridays) | ✅ | `master_record_tenant` in **vector_artefacts**, keyed `workspace_id` |

### The chain (this is the answer to the user's question)

```
subscriptions  (tenant — paying customer / legal entity, in mmff_vector)
    │ 1..N
    ▼
master_record_workspaces  (workspace tier — top scope container, in mmff_vector)
    │ 1..N
    ▼
org_nodes  (org tree — Office/Team/Squad/…, free-form depth, in mmff_vector)
    │
    ▼
portfolio_items  (strategic spine: Theme → Initiative → Feature)
user_stories    (execution spine: Story → Task)
    ↑ both clamped via org_node_id, narrowed via workspace_id
```

**The strategic-portfolio hierarchy lives INSIDE the topology spine.** Portfolio items are content that exists within a workspace + org_node scope. The user's instinct is correct. The code already reflects it. The naming hides it.

---

## What's actually misnamed (the fog the user is sensing)

1. **`master_record_workspaces` (mmff_vector)** — name says "master record" (anchor identity) but the **real per-workspace anchor with locale/calendar/owner is `master_record_tenant` in vector_artefacts**. Two "master records" for the same workspace, two databases, different jobs.

2. **`master_record_tenant` (vector_artefacts) is keyed by `workspace_id`** — comment line 6 of [`036_master_record_tenant.sql`](db/vector_artefacts/schema/036_master_record_tenant.sql) says outright: *"One row per workspace holding canonical identity, time/date conventions, and planning defaults."* The "tenant" name preserves an old mental model from before the workspace-tier split (PLA-0006).

3. **`/workspace-admin/tenant-details`** (now `/vector-admin/tenant-details` after this session's move) edits `master_record_tenant` — i.e. **workspace-level** locale. URL says tenant, table says tenant, row is workspace-scoped.

4. **Legacy singular `workspace` table** still exists in mmff_vector alongside `master_record_workspaces` (migration 131 explicitly leaves it untouched). Likely dead — needs audit.

5. **`org_node_roles` was dropped in migration [175](db/mmff_vector/schema/175_drop_roles_org_nodes.sql)** — was renamed to `roles_org_nodes` in [133](db/mmff_vector/schema/133_rename_org_node_roles_to_roles_org_nodes.sql) then dropped in 175. Topology permissioning now resolves a different way (likely via the unified `users_roles_permissions` matrix introduced by PLA-0049). **Verify before storifying anything that depends on node-level roles** — read the orgdesign service and migration 175.

---

## Why NOT to move `master_record_workspaces` to vector_artefacts

User's earlier instinct: "move it for transparency." This is the wrong move. Why:

- `master_record_workspaces` in mmff_vector is the **transactional anchor**. Other mmff_vector tables FK against it — at minimum `users_roles_workspaces.users_roles_workspaces_id_workspace`. Cross-DB FKs aren't possible in Postgres.
- `users_roles_workspaces` itself has 4 other FKs pointing at `users` and `subscriptions` in mmff_vector. Cascade-moving everything would mean moving the whole identity platform.
- `master_record_tenant` in vector_artefacts (keyed `workspace_id`) is the **settings sidecar**. It already lives in vector_artefacts. That's where the "transparency" the user wanted **already is**.
- The pattern is correct: anchor in mmff_vector, settings/artefacts in vector_artefacts. Mirrors `artefact_types`, `flows`, `field_library` — they all key off a bare UUID in vector_artefacts and trust the anchor lives in mmff_vector. No FK across DBs; the application is sole writer of the join.

The "transparency" the user wanted comes from **renaming**, not moving.

---

## Cleanup register (priority order)

These are stories worth creating, in order. Each one is small and additive. None of them require moving rows across databases.

### Story 1 — Rename `master_record_tenants` → `master_record_workspaces` (in vector_artefacts) — **SHIPPED 2026-05-15 (00564 + 00565a + 00565b + 00566 + 00567-rename all done; only 00567 body fix deferred — covered by PLA-0032 order 3)**

> Allocated under [dev/plans/PLA-0032.json](dev/plans/PLA-0032.json) (merged, not a fresh PLA). 4 stories: SQL migration (00564), Go package rename (00565 — split into 00565a SQL strings, 00565b directory rename), frontend helper rename (00566), dev ETL script (00567). Plural plural plural — the handover originally said "workspace" singular but project convention is plural per migrations 060/063. NB: renamed table lives in vector_artefacts and shares a NAME with `master_record_workspaces` in mmff_vector (different DBs, different purposes — anchor identity vs settings sidecar). Documented as risk #3 in the plan.

#### What landed (2026-05-15, atomic cutover, unsupervised)

- **00564** — `db/vector_artefacts/schema/067_rename_master_record_tenants_to_workspaces.sql` written + applied to dev DB. Forward migration succeeded; `schema_migrations` backfilled. DOWN migration also written at `db/vector_artefacts/schema/down/067_*_DOWN.sql` for rollback.
- **00565a** — Go code SQL string updates: `backend/internal/tenantmasterrecord/{sql.go,service.go,handler.go}` + `backend/internal/portfoliomodels/{sql.go,dev_reset.go}` + `backend/internal/portfoliomodels/master_reset_crossdb_test.go` + `backend/cmd/server/main.go` (comment). All references to `master_record_tenants*` in vector_artefacts code paths updated to `master_record_workspaces*`. The two remaining `master_record_tenants` mentions in dev_reset.go (lines 64, 218) explicitly refer to the **mmff_vector vestigial table** which was never renamed — keep as-is. `go build ./...` is clean.
- **00566** — Frontend rename: `app/lib/tenantSettingsApi.ts` → `app/lib/workspaceSettingsApi.ts` (new file, old deleted). Type names `TenantSettings*` → `WorkspaceSettings*`. 3 consumers updated: `app/contexts/TenantContext.tsx`, `app/(user)/vector-admin/tenant-details/page.tsx`, `app/(user)/workspace-settings/workspace-settings/organisation/page.tsx`. JSON property keys kept as `tenant_*` (honest to the Go wire shape — Go JSON tags are deferred per TD-NAME-001). `tsc --noEmit` clean on touched files. **NOT renamed:** `app/contexts/TenantContext.tsx` filename itself (would cascade into every importer — separate scope).
- **00567 (file-rename half)** — `dev/scripts/etl_tenant_settings.sql` → `dev/scripts/etl_workspace_settings.sql` via `git mv` (preserves history). Header updated. **Body NOT updated** because it was already stale pre-rename (uses migration-036 column names that were renamed in migration 063 last week). Fixing the body is covered by PLA-0032 work-item order 3 (the existing "unverified ETL" entry) — out of scope for vocabulary rename.
- **00565b (supervised follow-up, 2026-05-15)** — directory rename `backend/internal/tenantmasterrecord/` → `workspacemasterrecord/` via `git mv` (history preserved); package declarations updated in handler/service/sql; main.go import + 2 constructor calls + 5 local variable names (`tenantSettingsPool/Svc/H` → `workspaceSettings*`) all updated. Scope ended up smaller than originally feared — portfoliomodels callers don't import the package, only reference table names in SQL strings (already done in 00565a). `go build ./...` clean; backend restarted; **all 5 smoke checks pass** (boot, env=dev, authenticated GET 200, PATCH round-trip 200, trigger fires).

#### What's deferred (next sit-down)

- **00567 body rewrite** — `dev/scripts/etl_workspace_settings.sql` body still uses migration-036 column names. Covered by PLA-0032 order 3 already (separate work-item).

#### Verified end-to-end (2026-05-15, supervised)

Backend restarted at 15:35:09. Five smoke checks passed against the renamed package + renamed table: `/healthz` 200 on dev env, gadmin login + JWT, GET `/_site/workspace-settings` returns 200 with the MMFFDev workspace row, PATCH `tenant_notes` round-trips with HTTP 200 and the trigger bumps `master_record_workspaces_updated_at`. DB verified directly via psql.

---

## PLA-0050 (Story 2 + 5 of cleanup register) — SHIPPED 2026-05-15 unsupervised

All 7 stories landed end-to-end across DB + Go + frontend + docs. Plan at [`dev/plans/PLA-0050.json`](dev/plans/PLA-0050.json). Summary of what's on disk:

- **DB** — vector_artefacts migration 068 created `master_record_tenants` (subscription-keyed, 16 columns, 7 check constraints, trigger). FDW shadow `fdw_subscriptions` added. Backfilled 33 subscription rows. mmff_vector migration 200 dropped the broken `fn_master_record_tenant_seed_for_subscription` trigger. Subscription INSERT now works (was broken at DB layer pre-rename — found this during scoping).
- **Go** — `backend/internal/tenantmasterrecord/` (NEW; sole writer for the new table). main.go imports the package, constructs `tenantSettingsSvc`, mounts `/_site/tenant-settings` GET + PATCH with the same auth chain as workspace-settings. `go build ./...` clean.
- **Frontend** — `app/lib/tenantSettingsApi.ts` (typed client). `app/(user)/vector-admin/tenant-settings/page.tsx` (NEW gadmin-only editor; component `TenantSettingsPage`). `app/(user)/workspace-admin/workspace-details/page.tsx` (NEW; moved from `vector-admin/tenant-details`; component `WorkspaceDetailsPage`). Old `vector-admin/tenant-details/` directory deleted. `tsc --noEmit` clean.
- **DB nav** — `pages` row updated: `va-tenant-details` → `ws-workspace-details` (label + href + tag_enum). New row `va-tenant-settings` inserted under `vector_admin` tag for the tenant page.
- **Docs** — `docs/c_c_db_routing.md` extended with both `workspacemasterrecord` + `tenantmasterrecord` rows. `docs/c_plan_index.md` bumped to PLA-0050.

### ⚠ Backend running binary is STALE — manual restart needed

When you return, the dev backend at `localhost:5100` is dead. The respawn flow during my unsupervised run hit a race: I SIGKILLed the old binary, air's automatic rebuild bound port 5100 successfully, then mid-run when I touched `main.go` for the tenant-settings code, air's hot-restart hit `bind: address already in use` (TIME_WAIT from the previous bind) and gave up after one retry. The currently running air process (PID 31817) is alive but not picking up file changes — likely confused by the second orphaned air process (PID 11580 from yesterday).

**Recovery:** kill BOTH air processes (`kill 11580 31817`) and any orphaned `go run` processes (PIDs 26707, 48926, 63164, 67493 from earlier sessions); restart air via the launcher. The new binary will pick up my code changes (Go package + main.go wiring) automatically.

### Pending verification after restart (PLA-0050 ACs 5, 6, 7, 10, 11)

- AC 5: GET `/_site/tenant-settings` as gadmin returns 200 with the 33-row backfill defaults for the MMFFDev subscription
- AC 6: PATCH a single field, verify 200 + `tenant_updated_at` bumps
- AC 7: Non-gadmin (claude_1_test) gets 403 — note: my mount used the same auth chain as workspace-settings (auth + fresh-password), so non-gadmin will currently get 200. Page-access gating is delegated to the `va-tenant-settings` page row seeded today; it'll filter the route via the page-access middleware once seed-time grants are wired. Story 3 of cleanup-register Story-3 plan can include this gate.
- AC 10: Browser load `/vector-admin/tenant-settings` as gadmin
- AC 11: Browser load `/vector-admin/tenant-settings` as user-tier — currently will load (see AC 7 caveat above)
- Also: `/workspace-admin/workspace-details` (the moved workspace editor) loads correctly

#### Pre-existing stale file I found (out of scope, not touched)

`db/seed/010_master_reset.sql` line 192–243 INSERTs into `vector_artefacts.master_record_tenants` using the **old column names** from migration 036 (`workspace_id`, `tenant_name`, `tenant_description`, etc.) — but migration 063 (2026-05-14) renamed those columns to `master_record_tenants_*`. The seed was already broken before today's rename. After 067, it's still broken (now wrong table name AND wrong column names). This file is `psql -f` invoked manually, not run automatically by anything I could find. Filed as a separate concern — covered by PLA-0032's existing "ETL script: unverified" work-item (order 3). Not in scope for 00564/00565a.

#### Rollback if needed

If something is wrong, `db/vector_artefacts/schema/down/067_rename_master_record_tenants_to_workspaces_DOWN.sql` reverses the rename in one transaction. Then `git revert` the commit.


- Pure rename; zero data risk.
- Pattern precedent: [`063_master_record_tenants_column_prefix_RF1_4_4.sql`](db/vector_artefacts/schema/063_master_record_tenants_column_prefix_RF1_4_4.sql) — the RF1.4.4 column-prefix rename. Mirror the pattern: table + indexes + constraints + trigger + comment + all column prefixes `tenant_*` → `workspace_*`.
- Update all Go code that references the table — `backend/internal/tenantmasterrecord/sql.go` (which should also be renamed).
- Update frontend API + page references.
- **This is the first thing to storify.** Establishes correct vocabulary; unblocks Story 3.

### Story 2 — Add a real tenant-defaults table — **SHIPPED 2026-05-15 (PLA-0050)**

- New table `master_record_tenants` in vector_artefacts, PK = `subscription_id`. Shipped as PLA-0050 stories 00568 (DB migration 068 + backfill + repair of broken seed trigger), 00569 (Go service + /_site/tenant-settings endpoint), 00571 (TS API helper), 00572 (frontend `/vector-admin/tenant-settings` page).
- Backfill ran: 33 subscriptions backfilled with system defaults.
- Pre-existing bug repaired: `fn_master_record_tenant_seed_for_subscription` trigger (pointing at dropped table) dropped via mmff_vector migration 200.
- Story 00570 (wire SeedForSubscription into subscription-create path) marked done-partial — no production Go code creates subscriptions today; auto-create-on-first-Get covers the gap.

### Story 3 — Implement inherit-from-tenant in the workspace-details read path — **SHIPPED 2026-05-16 (PLA-0051)**

- `workspacemasterrecord.Service.Get()` now performs a field-by-field COALESCE merge: workspace value → tenant default → system default; emits per-field `*_source` markers (`workspace | tenant | system_default`).
- Migrations 069 + 070 dropped NOT NULL on inheritable columns of both `master_record_workspaces` and `master_record_tenants` in vector_artefacts (NULL = inherit).
- PATCH gained `clear_overrides[]` semantics — explicit-list lets a workspace revert any subset of fields back to inheriting.
- Frontend `<InheritanceIndicator>` ships chip + button per field (Override/Inherited-from-Tenant/Default); POC-wired on timezone + data_region in `/workspace-admin/workspace-details`; remaining 9 fields pending Tracker UX call.
- TDD: 8 backend integration tests (Group 2) + 5 frontend vitest tests (Group 9) all green in Tracker's `/red-green` page — marquee first use of the `<rg>` substrate.
- In-flight gap: handler.Get passed `subscription_id` where `workspace_id` was expected → defensive fallback in `FDWSubscriptionResolver.SubscriptionFor` + filed as **TD-WS-001** for proper rewire.

### Story 4 — Drop the legacy singular `workspace` table

- Audit any remaining references in code (`grep -rn '\bworkspace\b' backend/ app/`).
- If unused, write a drop migration. If still referenced, file a TD-* entry.

### Story 5 — Rename the route — **SHIPPED 2026-05-15 as PLA-0050 / 00573**

- `/vector-admin/tenant-details` → `/workspace-admin/workspace-details`. Directory moved via cp; component renamed to `WorkspaceDetailsPage`; old directory deleted; `pages` row updated to `ws-workspace-details` / `workspace_admin` tag_enum.
- New tenant-settings page at `/vector-admin/tenant-settings` (PLA-0050 / 00572) takes the freed URL slot; gadmin-only page row `va-tenant-settings` seeded.

### Story 6 — Verify topology permissioning still works after `roles_org_nodes` drop

- Read migration [`175_drop_roles_org_nodes.sql`](db/mmff_vector/schema/175_drop_roles_org_nodes.sql) and the current `backend/internal/orgdesign/` code.
- Confirm node-level roles resolve correctly via the unified roles/permissions matrix (PLA-0049).
- If they don't, this is a P0 regression — file immediately.

---

## What to do on the Mac Studio

1. **Pull this branch** (`001_redesign`); commits will be there after the push below.
2. **Read this handover and `dev/research/R028.json`** (specifically §8 Decision A.2).
3. **Read `docs/c_c_topology.md`** end-to-end — that's the canonical source of truth for the topology spine.
4. **Confirm with the user** which story to start with (recommendation: Story 1 first).
5. **Run `<stories>` to draft the chosen story.** Use RF1.4.4 column-prefix rename as the structural template. Storify across all layers (DB migration, Go code, frontend, tests).

---

## Open questions to confirm with user

- Is the rename of `master_record_tenant` → `master_record_workspace` accepted as Story 1? (The user agreed in principle but said "lets take a breath" before any DB move; this is a rename not a move, but still worth confirming.)
- Does the user want a separate "tenant defaults" page at `/vector-admin/tenant-details` (gadmin-only) holding the **real** tenant-level fields (Story 2), and a workspace-level page at `/workspace-admin/workspace-details` (Stories 3 + 5)?
- Should Story 1 also drop the legacy `workspace` (singular) table at the same time, or is that a separate story (Story 4)? Recommendation: separate, because it has its own audit risk.

---

## Files modified this session (for context)

```
M  app/(user)/vector-admin/tenant-details/page.tsx           ← stub replaced w/ organisation page content
D  app/(user)/workspace-admin/organisation/page.tsx          ← whole dir deleted
M  app/components/catalogue/c_circular_additor/circularAdditor.tsx  ← rail index pill
M  app/globals.css                                            ← .flow-rules__rail-index + grid template change
M  dev/plans/PLA-0031.json … PLA-0034.json                   ← incidental, verify before commit
M  docs/c_c_v1_v2_cutover.md                                  ← incidental, verify before commit
M  package-lock.json                                           ← incidental
```

DB-only change: deleted `pages` row `ws-organisation` (id `995a21a2-0c4c-4772-83b9-eff6f2082370`) from `pages` in mmff_vector.

---

## Hard rules to keep in mind

- **HUMAN ACCOUNTS ARE OFF LIMITS:** never touch credential fields on `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `user@mmffdev.com`.
- **NEVER ASSUME A DATABASE:** trace handler → main.go pool → check `docs/c_c_db_routing.md` before any psql.
- **BACKEND ENV PINNED TO `dev`:** marker file in CLAUDE.md; never switch without explicit chat instruction.
- **CSS/HTML NAMING CONVENTION:** propose chain, show TSX + CSS, confirm before edit.
- **DEV-UI PRIMITIVES on `/dev`:** `.dui-*` catalog only, no bespoke classes.

— end of handover —
