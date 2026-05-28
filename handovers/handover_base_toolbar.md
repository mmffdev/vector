# Agent Handover — Base Toolbar (StatusBarBottom shell chrome + users_statusbar_prefs)

**Date:** 2026-05-28
**Branch:** `refactor/flow-states-per-node`
**Last commit (this session):** `e9507123` — `feat(db): mig 136 — restore padmin's pre-fold custom pages + nav profiles + bookmarks`
**Surface:** new `.rd-shell__statusbar` footer band across the bottom of every `(user)` page; mounts `<StatusBarBottom>` from `app/redesign/components/`. Backed by mig 137 (`users_statusbar_prefs`).
**Status:** Chrome + component + migration FILE shipped in commit `10475cca`. **The migration was NOT applied** — `users_statusbar_prefs` does not exist in the dev DB, and the 39-file `schema_migrations` drift that blocks the runner is still unresolved. Audit captured as PLA069 on Dev → Reporting. See P5 in "Where to pick up next" for the unblock path.

> **Read-before-acting:** the bottom bar is currently chrome only — three hardcoded zero counts. The selection-persistence layer (the `users_statusbar_prefs` row + GET/PUT handler) is not wired yet. Pick-which-metrics UI is also not built. The component renders, the table exists, the seams are obvious — but nothing reads from or writes to the table yet.

---

## What this surface is for

A persistent **bottom status bar** on every authenticated page — a VS-Code-style strip the user fills with data points they want to keep an eye on (blockers, stories in the active meg, tasks, future UI/DB status). Three structural decisions locked this session:

1. **Selection is global per user** — one row per user in `users_statusbar_prefs`, no workspace key. The data each point *renders* may still vary per workspace (clamp-meg-driven counts change with scope), but the SELECTION is portable across tenants. User's framing: *"make it global, but some data output may be diff per workspace, thats fine for now, we will cover when we meet that issue."*
2. **Counts come from the clamp-scoped artefact summary endpoint** — `GET /_site/work-items/summary?meg=<topology_uuid>` already exists (handler at [backend/internal/artefactitems/handler.go:593](../backend/internal/artefactitems/handler.go#L593), service at [backend/internal/artefactitems/service.go:582](../backend/internal/artefactitems/service.go#L582), wire shape at [types.go:540](../backend/internal/artefactitems/types.go#L540)). Returns `{ total, blocked, by_type: { story, task, epic, defect, ... } }`. Frontend reads `useSentinel()` for the active topology node and passes it as `?meg=`. No new endpoint needed for the v1 data points.
3. **Bar height = 28px** — explicit choice after the user pushed back on a 86px first cut. The reference screenshot was 86 raw pixels at 2x DPR = ~28 CSS pixels = real VS Code statusbar height. *Don't change this without an explicit ask.*

---

## File map — where things live

### Component
- [app/redesign/components/StatusBarBottom.tsx](../app/redesign/components/StatusBarBottom.tsx) — `<StatusBarBottom>` primitive, no props, hardcoded `DATA_POINTS` array of three items (Blockers, Stories (clamp), Tasks) with `value: 0` placeholders. The array is the seam to wire real counts in. Renders an `<ul>` of label + value pairs, tabular-nums on the value so digits don't shift width on update.

### Shell wiring
- [app/redesign/components/RedesignShell.tsx](../app/redesign/components/RedesignShell.tsx) — imports `StatusBarBottom`, mounts a new `<footer className="rd-shell__statusbar" role="contentinfo" aria-label="Status bar">` sibling to `<main>` inside the shell grid. The footer wraps `<StatusBarBottom />`.

### Shell CSS
- [app/redesign/shell.css:11](../app/redesign/shell.css#L11) — new `--rd-statusbar-h: 28px` token on `.rd-shell`. Grid switched from a single implicit row to `grid-template-rows: 1fr auto`, `height: 100vh`. Rails 1 & 2 + `.rd-shell__main` switched from `100vh` to `calc(100vh - var(--rd-statusbar-h))` so the sticky rails and the scrolling main area stop above the bar — nothing sits behind it.
- Same file ~lines 22–66 — `.rd-shell__statusbar` rule (white bg, top border, `grid-column: 1 / -1`) + the `.rd-statusbar__Container*` family (left-aligned, 30px padding-left to match the rest of the shell's chrome).

### Root layout
- [app/layout.tsx](../app/layout.tsx) — `DevStatusFloat` import + bottom-right mount **removed**. The "D" / "S" / "P" floating square (env indicator) is gone. The component file at `app/components/DevStatusFloat.tsx` is still on disk (untouched, not deleted) in case the env indicator wants resurrecting later — but no callers reference it. The user's framing: *"remove the bottom right dev maekr square we dont need it anymore."*

### Database
- [db/vector_artefacts/schema/137_users_statusbar_prefs.sql](../db/vector_artefacts/schema/137_users_statusbar_prefs.sql) — `CREATE TABLE users_statusbar_prefs` with columns: `users_statusbar_prefs_id uuid PK`, `users_statusbar_prefs_user_id uuid FK → users(users_id) ON DELETE CASCADE`, `users_statusbar_prefs_data_points jsonb NOT NULL`, `users_statusbar_prefs_updated_at timestamptz NOT NULL DEFAULT now()`. Unique index on `users_statusbar_prefs_user_id` (one row per user, globally). Full table-name prefix per the HARD RULE.
- [db/vector_artefacts/schema/down/137_users_statusbar_prefs.sql](../db/vector_artefacts/schema/down/137_users_statusbar_prefs.sql) — paired DOWN.

### Plan / audit
- **PLA069** on Dev → Reporting → Plan tab — `vector_artefacts schema_migrations drift audit (2026-05-28)`. Captures the 39-row `schema_migrations` gap discovered while trying to apply mig 137, the per-migration verification probe matrix (all 42 assertions returned "already applied"), and seven deep-dive prompts (P1–P7) for the user to run later. **Not** added to `Vector_Scope.md` — explicit in the plan body that P1–P7 are investigation prompts for review, not stories to dispatch.

---

## What is DONE

- Bottom toolbar chrome — `.rd-shell__statusbar` footer band, 28px tall, white bg, border-top, spans all 3 shell columns. Shipped in commit `10475cca`.
- Sticky-rails height adjusted via `calc(100vh - var(--rd-statusbar-h))` on rail-1, rail-2, and `.rd-shell__main` — nothing overflows behind the new bar.
- `<StatusBarBottom>` component scaffolded with hardcoded `DATA_POINTS = [{blockers, stories_clamp, tasks}]` at value `0`. Renders inside the new footer. Left-aligned, 30px padding-left matching shell convention. Shipped in commit `10475cca`.
- `DevStatusFloat` removed from root `app/layout.tsx` (import + mount). Component file kept on disk for possible later resurrection. Shipped in commit `10475cca`.
- Migration 137 (`users_statusbar_prefs`) authored and on disk — table CREATE, UNIQUE index, paired DOWN. Shipped in commit `10475cca`.
- ~~Migration 137 applied to dev `vector_artefacts`.~~ → **Not done.** As of session end the table does not exist in the dev DB (`SELECT to_regclass('public.users_statusbar_prefs')` returns NULL) and the `schema_migrations` row for `137_*` is absent. The runner is blocked behind the 39-row drift — see P5 below. Once the backfill lands, `migrate -db vector_artefacts -env .env.dev` will pick up 137 and create the table.
- Migration 136 (`restore_padmin_pre_fold_nav`) shipped in commit `e9507123`. Independent of the toolbar work — surfaced earlier in the session and shipped while diagnosing the drift.
- Backend surface for clamp-scoped counts identified — `GET /_site/work-items/summary?meg=<topology_uuid>` already exists and already clamps via sentinel. `summary.blocked` → Blockers; `summary.by_type["story"]` → Stories (clamp); `summary.by_type["task"]` → Tasks. No new endpoint needed for v1.
- Plan PLA069 filed on Dev → Reporting capturing the drift audit + 7 deep-dive prompts.

---

## Where to pick up next

**P1 — Wire the data-point values to the live summary endpoint.** The component currently shows three zeros. Replace `DATA_POINTS` with a hook that calls `apiSite("/work-items/summary?meg=" + sentinel.megNodeId)`, maps `blocked` / `by_type.story` / `by_type.task` to the three lines, and refetches when the active topology node changes (`useSentinel()` exposes it; the existing `useScopedTopologyNodes` hook is a precedent for the dependency wiring). Cache for 10s or so — these counts don't need to be live-tailed. Skeleton dashes (`—`) while loading is fine; don't flash zeros.

**P2 — GET/PUT handler for `users_statusbar_prefs`.** Two routes under `/_site/users/me/statusbar-prefs`:
- `GET` returns `{ data_points: ["blockers", "stories_clamp", "tasks"] }` (default order if no row exists; no 404 — return the default).
- `PUT` accepts the same shape, upserts the row keyed on the authenticated user. Sentinel-clamp the user-id from JWT, not from request body.
Add to siteAPI.yaml; add `handler_test.go` covering empty-state + upsert + idempotent re-upsert.

**P3 — UI for picking which data points to show.** A small popover (long-press the bar? right-click? gear icon at the right edge of the bar?) listing the available data point keys with checkboxes + drag-handles for reorder. Persist on every change via PUT. Available keys today: `blockers`, `stories_clamp`, `tasks`. Future-pinned: `ui_status`, `db_status` (the user named these as "we will add UI and DB status to save them later"). Defer to **after P2** lands so persistence is in place when the picker appears.

**P4 — UI status + DB status data points.** User mentioned these for later: `ui_status` (probably client-side state — last-action result, online/offline, something along those lines) and `db_status` (probably backend connectivity — last-known dev/staging/production env, latency, healthy/degraded). Frame both as new `DataPointKey` literals + new render branches in `StatusBarBottom`. The env-indicator that lived in `DevStatusFloat` could fold back in here as `db_status` — same data, new location.

**P5 — Resolve the schema_migrations drift (PLA069).** The 39-row backfill is either already done (if you authorised the INSERT in the prior turn) or still pending. Verify: `SELECT count(*) FROM schema_migrations WHERE filename ~ '^(09[3-9]|1[0-2]\d|130|136)_'` should return 39. If 0, the backfill is still pending — see PLA069's Phase 1 step 3 for the exact INSERT. After backfill, decide whether to run any of the seven deep-dive prompts (P1–P7 inside PLA069) — particularly P5 (does staging/production have the same drift?) and P6 (should there be a CLAUDE.md HARD RULE that mandates `schema_migrations` row + matching commit on every psql-applied migration?).

**P6 — A data-point that surfaces tech-debt count.** Speculative — the user might like a "TD: 47" cell that links to `/dev/reporting?type=tech_debt` (or wherever the TD register lives). Easy add once the picker is in place. Not committed-to; offer it when P3 is in flight.

---

## Known caveats

- **Bar height is locked at 28px.** User explicitly rejected the first 86px cut: *"thats not what i asked, i asjed for the same height as the image i gave you."* 28px = real VS Code statusbar height (the reference screenshot was 2x DPR). Don't bump this without an explicit ask.
- **`DevStatusFloat` is removed from the layout but the file is intact.** Don't delete the file outright — the env-indicator behaviour (D/S/P + pipeline health polling at `/status/pipeline`) is potentially the source for the future `db_status` data point. If you ever delete it, port the polling logic into the `db_status` branch of `StatusBarBottom` first.
- **Selection is GLOBAL, not workspace-scoped.** Unique index is on `users_statusbar_prefs_user_id` alone — no workspace column on the table. User said *"global, but some data output may be diff per workspace, thats fine for now, we will cover when we meet that issue."* If a future use-case demands per-workspace prefs, that's a schema change (add the column, drop the unique, recreate as composite) — not a quiet PUT-handler tweak.
- **The clamp-scope is read from `useSentinel()`, not from the URL.** Per the Sentinel HARD RULE in CLAUDE.md, `app/sentinel/` is the only owner of identity/tenant/scope on the frontend. The data hook must NOT read `?scope=` or `?meg=` from the URL directly — read the active node from `useSentinel()`. Server-side, `/work-items/summary` already does the right thing (handler reads `?meg=` from the request URL, then runs `topology.CanReadScope` — sentinel-clamped). The frontend's job is to pass the sentinel's active node value into the URL it asks for.
- **The summary endpoint is work-scope only.** `/_site/work-items/summary` returns work-scope items (mounted off `mountArtefactSite` with `workItemsV2H`, scoped to `work`). For portfolio-scope counts, hit `/_site/portfolio-items/summary` — same shape, different scope. If a single status bar cell ever wants to aggregate BOTH, that's a new aggregator endpoint (~30 lines) — not a frontend addition.
- **PLA069's deep-dive prompts are NOT stories.** They were filed deliberately as investigation prompts under "Proposed Stories" but the plan body explicitly says do not run `<scope> -a` on them. If a future agent asks the user "ready to add PLA069's proposals to Vector_Scope?" — the answer is no, unless the user revisits PLA069 and reframes them.
- **The blank `Vector_Scope.md` diff in `git status` is intentional.** A scope row for the StatusBarBottom theme was added by an earlier turn but the commit you see (`10475cca`) bundled the diff. The remaining `M Vector_Scope.md` is a pending add from the prior session, not from this work.
- **Don't rename the migration filename.** The renumber from `136` → `137` was forced by collision with `136_restore_padmin_pre_fold_nav.sql` (which was already in the tree but missed by the initial descending `ls`). The header inside the file references `137_users_statusbar_prefs.sql` consistently. Renaming requires editing both the migration file header AND the DOWN file header.

---

## How to verify

1. Run dev (`<npm>` skill — Next.js on 3000).
2. Log in (any user, any env — the bar mounts in `(user)` layout). The bottom of every authenticated page now shows a thin (28px) white strip with a top border, three labels left-aligned with 30px padding-left: `Blockers 0`, `Stories (clamp) 0`, `Tasks 0`.
3. The bottom-right "D" floating square should be GONE — no env indicator overlay anywhere.
4. Resize the browser. The status bar spans the full viewport width (rails on the left, content centre, no gap on the right).
5. Open DevTools → Inspect → Elements. The footer is `<footer class="rd-shell__statusbar" role="contentinfo" aria-label="Status bar">`, sitting after `<main class="rd-shell__main">` inside `<div class="rd-shell">`.
6. Verify mig 137 in dev DB (will FAIL until P5 lands):
   ```bash
   PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2) \
     /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
     -c "\d users_statusbar_prefs"
   ```
   Should show 4 columns + the unique index on `users_statusbar_prefs_user_id`. **As of session end this returns `Did not find any relation named "users_statusbar_prefs"`** — the migration file is on disk but never applied. Resolve P5 first.
7. Verify the runner's state. **Currently:** `go run ./cmd/migrate -dry-run -db vector_artefacts -env .env.dev` reports 40 pending entries (the 39-row drift + mig 137). **After P5 backfill + mig-137 apply:** should report `no pending migrations`.

---

## Commits in scope

- `10475cca` — `feat(redesign): StatusBarBottom shell component + users_statusbar_prefs migration 137`
- `e9507123` — `feat(db): mig 136 — restore padmin's pre-fold custom pages + nav profiles + bookmarks`

---

## Open design questions

- ~~**Is the 39-row `schema_migrations` backfill done or still pending?**~~ → Resolved by direct probe at session end: backfill NOT done; `users_statusbar_prefs` table NOT created. The auto-mode classifier blocked the INSERT and the user did not subsequently authorise it. P5 (in "Where to pick up next") is the unblock path.
- **Should `users_statusbar_prefs_data_points` carry ONLY the ordered list of keys, or also per-key config (refresh interval, label override, threshold for amber/red)?** Current shape (just an ordered key list) is the simplest thing that works. Per-key config can be folded into the same JSONB later by upgrading the shape from `["blockers", "tasks"]` to `[{ key: "blockers" }, { key: "tasks", refresh_ms: 5000 }]`. Backwards-compatible if the reader tolerates both shapes.
- **What's the right trigger for the picker UI?** Long-press, right-click, gear icon at the right of the bar, a `/preferences/status-bar` page somewhere — the user hasn't framed this. Defer until P2 lands and the wiring is testable.
- **Should the bar autohide when the page renders a fullscreen view (e.g. presentation mode, kiosk mode)?** Not a current need; flag for whenever fullscreen modes appear.
- **Does the env indicator (`db_status`) belong inside the bar as a data point, or as a separate persistent left/right-anchored chip?** Folding into the picker means the user can hide it — possibly wrong if env-awareness is non-optional in dev/staging. Two readings; revisit when P4 is in flight.

---

**Last updated:** 2026-05-28
**Authored:** 2026-05-28 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
