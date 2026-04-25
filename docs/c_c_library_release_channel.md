# Library release channel (Phase 3)

Outstanding-release notifications from `mmff_library` to gadmins, with per-subscription acknowledgement. Plan: `dev/planning/feature_library_db_and_portfolio_presets_v3.md` §12.

## Tables

`mmff_library` (read-only at runtime; written by `mmff_library_publish`):

- `library_releases` — `id`, `library_version`, `title`, `summary_md`, `body_md`, `severity`, `affects_model_family_id` (NULL = global), `released_at`, `expires_at`, `tier_min` (NULL = all tiers), `archived_at`.
- `library_release_actions` — `release_id` → release, `action_key` ∈ {`upgrade_model`,`review_terminology`,`enable_flag`,`dismissed`}, `label`, `payload` jsonb, `sort_order`.
- `library_release_log` — append-only audit of publishes/edits (`mmff_library_publish` INSERT-only).

`mmff_vector`:

- `library_acknowledgements` — pk `(subscription_id, release_id)`. App-enforced cross-DB ref to `library_releases.id`; no Postgres FK. Carries `acknowledged_by` (user id) + `action_taken` + `acknowledged_at`. Migration `db/schema/021_library_acknowledgements.sql`.

Page row: `db/schema/022_library_releases_page.sql` adds `pages.key_enum='library-releases'` (gadmin-only via `page_roles`).

## Severity rendering

| Severity | UI | Actions |
|---|---|---|
| `info` | neutral release card | single Acknowledge button |
| `action` | yellow accent | primary CTA + dismiss |
| `breaking` | red accent | primary CTA only (no dismiss — gadmin must act) |

Driven entirely by CSS modifiers `release-card--{info,action,breaking}` in `app/globals.css`.

## Audience filter

`ListReleasesSinceAck` filters by:
1. `archived_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
2. `tier_min IS NULL OR tier_rank(sub.tier) >= tier_rank(tier_min)` (free<pro<enterprise)
3. Release id NOT IN the subscription's acks

Cross-DB: pass 1 hits `libRO`, pass 2 hits `vectorPool`. No transaction wraps both — acks are idempotent so a race just means a re-read drops the row on the next poll.

## Reconciler

In-process Go ticker at `backend/internal/libraryreleases/reconciler.go`. Default interval 15 min via `LIBRARY_RECONCILER_INTERVAL` env; per-subscription cache TTL 5 min. Cold subscriptions are warmed by:
- `OnLogin` hook on `auth.Service` — `main.go` registers a closure that calls `Reconciler.Touch(ctx, subID, tier)` after each successful login.
- First `/api/library/releases/count` poll for that sub (handler falls back to inline compute when cache is cold/nil).

Tick `refreshAll` only refreshes already-warm entries; never blind-scans `subscriptions`. `Reconciler.Invalidate(subID)` is called by the ack handler so the badge updates without waiting for the next tick.

## Ack flow

`POST /api/library/releases/{id}/ack` (gadmin only):
1. Decode `{action_taken: "..."}`; reject unknown actions with 400.
2. `librarydb.FindRelease(libRO, id)` — 404 if missing (this is the cross-DB FK substitute).
3. `librarydb.AckRelease(vectorPool, sub, id, user, action)` — `ON CONFLICT DO NOTHING`.
4. If `created==true`: write `audit.Entry{Action:"library.ack", Resource:"library_release", ResourceID:id}` and `Reconciler.Invalidate(sub)`. Return 201.
5. If `created==false`: return 200 (idempotent re-ack; no audit, no invalidate).

## Frontend

- `app/components/LibraryReleaseBadge.tsx` — gadmin-only poll of `/count` every 5 min; bell icon + numeric badge (max `9+`); non-gadmins see the bell with no badge and no link (visual parity).
- `app/(user)/library-releases/page.tsx` — gadmin-only list page; redirects others to `/dashboard`. Renders one `ReleaseCard` per outstanding release with severity-colored buttons; optimistically removes the row on successful ack.

## Tests

- `backend/internal/librarydb/releases_test.go` — sentinels + live happy-path (skip-on-unreachable).
- `backend/internal/libraryreleases/handler_test.go` — list / bad action 400 / unknown id 404 / ack-then-idempotent (201 then 200) using `auth.WithUserForTest` to inject a gadmin.
- `backend/internal/librarydb/grants_test.go` — extended matrix asserts publish/ack/ro/admin grants on the 3 new library tables (pays down TD-LIB-005).
