# Error codes (cross-cutting system)

Stable, MMFF-authored catalogue of error codes mapped to severity + paired user/dev messages. Lives in `mmff_library.error_codes` (read-only, global). Per-occurrence events are appended to `mmff_vector.error_events` via `reportError(code, context)`.

## Schema

`mmff_library.error_codes` (read-only at runtime; MMFF authors via migration):

- `code` TEXT PK — stable, human-meaningful identifier (treat as API contract; never repurpose or rename).
- `severity` TEXT — `info | warning | error | critical` (CHECK).
- `category` TEXT — `adoption | library | auth | validation` (CHECK).
- `user_message` TEXT — short, no-jargon, surfaced verbatim in UI.
- `dev_message` TEXT — long, dev-facing; logged but never shown to end users.
- `created_at` TIMESTAMPTZ.

`mmff_vector.error_events` — per-occurrence append-only log; UPDATE/DELETE rejected by trigger. Carries `subscription_id`, `user_id`, `code` (cross-DB FK by value; LEFT JOIN at read-time), `context` JSONB, `occurred_at`, `request_id`. Full column reference: [`c_schema.md` → `error_events`](c_schema.md#error_events).

## Adding a new error code

1. **Append a new migration** in `db/library_schema/` named `009_<short_purpose>.sql` (or the next free slot). **Do not edit `008_error_codes.sql`** — the seed file is shipped and must not change retroactively. Obsolete codes are removed or superseded by a follow-up migration too.
2. **Inside the migration** open a `BEGIN;` block, `INSERT INTO error_codes (code, severity, category, user_message, dev_message) VALUES (...);`, then `COMMIT;`. No grants needed (the table grants from 008 already cover new rows).
3. **Naming convention** — uppercase snake-case, prefix-by-category, verb-or-failure-mode suffix:
   - `ADOPT_PRECONDITION_NO_BUNDLE`, `ADOPT_BUNDLE_NOT_FOUND`, `ADOPT_STEP_FAIL_LAYERS`, `ADOPT_TERMINOLOGY_CONFLICT`, `ADOPT_ROLLBACK_REQUIRED`, `ADOPT_INTERNAL` (from the 008 seed).
   - Future categories follow the same shape: `AUTH_MFA_REJECTED`, `LIB_FETCH_TIMEOUT`, `VALIDATION_FIELD_REQUIRED`. Prefix matches the `category` column value.
   - Treat the prefix as part of the contract — once a code ships, the category cannot change without a rename, which is forbidden.
4. **Severity** picks the user-visible treatment (see below). Use `critical` only when the system is in a degraded state (gadmin attention required); use `error` for normal failed-operation cases the user can retry.
5. **Run** the migration via `docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 009_*.sql` (see [`c_postgresql.md`](c_postgresql.md)). Migrations are idempotent only by virtue of `INSERT ... ON CONFLICT DO NOTHING` — write the conflict clause if you might re-run.

> Example only (do NOT add as part of card 00020 — the card is doc-only):
>
> ```sql
> INSERT INTO error_codes (code, severity, category, user_message, dev_message) VALUES
>   ('ADOPT_TIMEOUT',
>    'error', 'adoption',
>    'The model setup took too long. Please try again.',
>    'Adoption pipeline exceeded the per-step deadline. Check downstream library reachability and inspect request id in structured log.')
> ON CONFLICT (code) DO NOTHING;
> ```

## Reporting from the backend

Backend handlers report an event via `POST /api/errors/report` (the route is owned by card 00007; reference the route, not the file path). The handler resolves the active subscription + user from session and inserts into `mmff_vector.error_events`. Body shape: `{ "code": "ADOPT_BUNDLE_NOT_FOUND", "context": { "handler": "...", "detail": "..." } }`. Keep `context` small (< ~4 KB); link out to logs/traces via `request_id` for blobs. Reporting is fire-and-forget — never let a failed `reportError` mask the original error path.

## Reporting from the frontend

Use the shipped utility at `app/lib/reportError.ts`:

```ts
import { reportError } from "@/app/lib/reportError";
await reportError("ADOPT_BUNDLE_NOT_FOUND", { route: pathname, detail: err.message });
```

Signature: `reportError(code: string, context?: Record<string, unknown>): Promise<void>`. POSTs to `/api/errors/report`; errors are intentionally swallowed (the report path must never throw into the original failure flow). Shipped in card 00011.

## Severity → UI rendering

> TODO — no shared frontend mapping currently exists. Card pending: a future story should ship a `lookupErrorCode(code)` hook + a CSS modifier set (e.g. `error-banner--{info,warning,error,critical}` mirroring the pattern in [`c_c_library_release_channel.md`](c_c_library_release_channel.md) §"Severity rendering"). Until then, callers handle severity ad-hoc and the `severity` column on `error_codes` is consumed only by future dashboards.

When the future hook lands it should:

1. Fetch the row from `mmff_library.error_codes` by code (cached; library catalogue is read-only).
2. Render `user_message` to the user; never render `dev_message`.
3. Map `severity` → CSS modifier on the surrounding banner/toast/inline component. Suggested mapping (parity with release-channel):

| Severity | UI treatment |
|---|---|
| `info` | neutral inline / toast |
| `warning` | yellow accent banner |
| `error` | red inline + retry CTA |
| `critical` | red banner with gadmin-contact CTA, non-dismissable |

Flag for human: the placeholder above is intentional — do not invent the mapping in client code without a tracking card.

## Decision tree — "an error just happened in code path X"

1. **Is the failure user-facing** (the user is going to see a banner/toast/inline message, OR the failure changes a workflow's outcome)?
   - **No, internal/dev-only noise** → log via the structured logger; **do not** call `reportError`. `error_events` is for events you want to count + dashboard, not every caught exception.
   - **Yes** → continue.
2. **Is there an existing code that precisely names this failure mode?** (Check `db/library_schema/008_error_codes.sql` and any later `009+` migrations.)
   - **Yes** → reuse it. Pass the call-site specifics in `context`, not in a new code.
   - **Almost-but-not-quite** → reuse anyway and surface the nuance in `context`. Do not fork a code over wording.
   - **No** → add a new code (see "Adding a new error code" above). Default to a more-specific code over a generic one; `*_INTERNAL` codes (e.g. `ADOPT_INTERNAL`) are last-resort buckets, not the first reach.
3. **After resolving the code**: backend handler fires `reportError` server-side OR returns the code in the response body for the frontend to fire. Pick one per handler — do not double-report the same occurrence from both sides.

## Related debt

- **TD-LIB-007 / TD-LIB-008** ([`c_tech_debt.md`](c_tech_debt.md)) — `error_events.code` is an app-enforced cross-DB FK. Readers must `LEFT JOIN` across DBs and tolerate missing labels (rename/removal in `mmff_library` does not break the vector-side log). A nightly reconciler comparing `DISTINCT error_events.code` against `mmff_library.error_codes.code` is the planned pay-down.
- **Severity rendering placeholder** — see TODO above.
