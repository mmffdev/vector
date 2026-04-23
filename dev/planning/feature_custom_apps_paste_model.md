# Feature — Custom apps (Rally-style paste-in-a-box)

Status: **proposal / not started.** Captures the design discussion from the 2026-04-23 session so it's recoverable later.

Reference model: Rally's "Custom HTML App" — admin opens a page, picks "Custom HTML App," pastes a self-contained HTML/JS document into a text box, saves. The paste becomes the app, rendered in an iframe on that page. No external hosting, no build step, no marketplace.

The schema slot `pages.kind = 'user_custom'` is now in use: migration `016_user_custom_pages.sql` (PR #4) introduced `user_custom_pages` + `user_custom_page_views` tables and the backend service `backend/internal/custompages/`. Those custom pages are currently plain label + view-kind containers (timeline/board/list). This proposal would extend that foundation so a page can contain a paste-in HTML/JS app as one of its view kinds.

## Why this shape

Three competing models were considered:

| Model | Trust boundary | Author cost | Vector cost |
|---|---|---|---|
| Iframe-embedded **external** apps | Browser process | Author hosts JS | Public API + SDK |
| **Paste-in-a-box** (this proposal) | Iframe sandbox | Paste & save | API + SDK + editor + storage |
| In-tree code modules | None (same origin) | Author writes Vector code | Trust every author |
| Module federation | None (same origin) | Author publishes ESM bundle | SDK + federation runtime |

Paste-in-a-box wins for v1 because it has the lightest author cost (no infrastructure) and the strongest sandbox boundary (no `allow-same-origin`). External-hosted apps are a logical second door later — they reuse the same SDK and auth bridge.

## Architecture pieces

Five additions, each modest:

1. **Custom-app page kind.** New table `page_custom_apps` (`page_id` FK, `source_html`, `version`, `updated_at`). Reuses the existing `pages.kind='user_custom'` slot.
2. **Iframe renderer.** Route `/apps/<page-id>/frame` serves the user's pasted HTML inside a sandboxed iframe. Strict CSP. No same-origin.
3. **Vector App SDK** at a stable URL (e.g. `/sdk/v1.js`). Exposes `Vector.api`, `Vector.context`, `Vector.ui`, `Vector.events`. Once published, every change must be backward-compatible within v1.
4. **Auth bridge.** Two options — pick during Phase 0:
   - *Token in URL hash:* short-lived (≤5 min) signed token; SDK uses as bearer. Simpler.
   - *postMessage proxy:* iframe never sees a token; parent does the fetch. More secure.
5. **Editor UI.** Textarea (Monaco optional) + "Save" + "Reload preview" button.

## Six-layer guardrail model

Each layer is independent. Defeating one doesn't defeat the others.

| Layer | What it stops | Where it lives |
|---|---|---|
| 1 — creator gate | Random users from creating apps | Tenant flag + role + per-user opt-in |
| 2 — identity | Apps from acting as anyone but their author | Existing auth/tenant/role middleware |
| 3 — scopes | Apps from doing more than they need | Token scopes + endpoint allowlist |
| 4 — quotas | Apps from hammering the platform | httprate + size/count caps |
| 5 — sandbox | Apps from attacking the browser | Iframe `sandbox=` + CSP + postMessage allowlist |
| 6 — audit | Platform from being blind | Per-app logging + kill switches |

### Layer detail

- **Creator gate.** Default off per tenant. Even when on, only `gadmin`/`padmin` can author; per-user "developer mode" toggle adds final friction.
- **Identity.** App runs as the user. Token is user + tenant + page scoped, ≤5-minute TTL. Every API call goes through existing `requireAuth`/`requireRole`/tenant-row filter — the custom-app surface adds **zero** new privilege paths.
- **Scopes.** Author selects from `read:portfolios`, `read:items`, `write:items`, etc. Default new apps to `read:*` only; `write:*` requires admin upgrade. No `/api/admin/...` endpoints in v1 surface.
- **Quotas.** Per-token rate limit (e.g. 100 req/min vs the user's normal 600). Per-tenant daily call quota. Pasted-script size cap (~100 KB). Per-user app count cap (~20).
- **Sandbox.** `sandbox="allow-scripts"` and *nothing else* — no `allow-same-origin`, no `allow-top-navigation`, no `allow-popups`, no `allow-forms`. CSP: `script-src 'self'`, `connect-src 'self' /api/v1/`, `frame-ancestors 'self'`. postMessage allowlist on the parent.
- **Audit.** Every API call logs both user ID and app ID. Three kill switches: per-app disable, per-tenant kill, global kill. Token revocation distinct from app disable.

## Author experience: language/framework

Paste-in-a-box constrains what's possible. **Next.js does not fit** (it's a build system + server, not a library). React fits naturally because it's a browser library.

Three coexisting modes, layered by SDK opt-in:

1. **Vanilla JS + Vector SDK.** Default. Smallest payload. Fits dashboard-style apps (table, chart, card).
2. **React without JSX** via `Vector.React`. Lazy-loaded — only apps that touch `Vector.React` pay the cost. Real components, hooks, state; no build.
3. **React with JSX** via `@babel/standalone`. Opt-in via header comment (`// @vector-jsx`). Adds ~3 MB transpile cost per app instance — only loaded when requested.

Apps that want the full Next.js experience belong in the **external-hosted door** (deferred to a later phase) — same SDK, same auth, but the source comes from a registered URL instead of a textarea.

## Phasing

- **Phase 0 — auth model decision.** Token-in-hash vs postMessage proxy. The one fork that's hard to undo. Pick before any code.
- **Phase 1 — read-only MVP.** Custom-app page kind, iframe renderer, SDK with `Vector.api.get(...)` only, no editor (load HTML from a `dev/` file). Goal: prove a pasted script can fetch and display Vector data.
- **Phase 2 — make it real.** Editor page, save endpoint, three or four UI primitives, theme integration, CSP hardening, audit logging.
- **Phase 3 — opening the door.** Documentation, example app gallery, "developer mode" flag, per-tenant enable.
- **Phase 4 (optional) — external apps.** Add the URL-registered app type using the same SDK + auth bridge.

Two to three weeks per phase if focused, longer in the background. Phases 0–1 are reversible spikes; Phase 2 commits to the SDK contract.

## Open decisions

- **Auth model:** token-in-hash vs postMessage proxy (Phase 0).
- **URL space:** `/apps/<page-id>` as a top-level route, or full-page entries in the existing `pages` registry alongside the static catalogue. Latter is more consistent with `pages.kind='user_custom'`.
- **Editor:** plain `<textarea>` for v1, Monaco later — or Monaco from the start?
- **Marketplace / sharing:** explicitly out of scope for v1. Apps are per-tenant only.

## Risk register

- **S1 — sandbox misconfiguration.** Adding `allow-same-origin` "to make a feature work" collapses the entire model. Lock the iframe attribute in code; write an automated test that asserts `sandbox` is present and minimal.
  - *Trigger:* any PR that touches the iframe renderer.
- **S2 — scope-check drift.** A new endpoint added without a scope declaration silently allows apps to call it. Mitigation: route v1 traffic through middleware that requires every endpoint to declare its scope explicitly; endpoints with no declaration return 403.
  - *Trigger:* any new `/api/v1/...` endpoint.
- **S2 — SDK contract churn.** Once `/sdk/v1.js` is published, every breaking change forces every author to rewrite. Mitigation: deliberately small v1 surface; add to it, never break it; v2 is a new file alongside v1.
  - *Trigger:* any change to SDK exports.
- **S3 — audit log noise.** "Per-app activity" logs are useless without a viewer. Build the activity view with the feature, not after.
  - *Trigger:* Phase 2.

## Honest caveats

- Custom apps don't make Vector more permissive — they give the user another way to express what they're already allowed to do. A `gadmin` who writes a destructive app didn't exceed their scope; the gadmin did. This is correct behaviour but worth being explicit about with customers.
- The SDK is a contract you can't break casually. That's an ongoing tax on every refactor: "does this break v1?" becomes a permanent question. Acceptable cost; worth being deliberate about.

## Pointers

- Schema foundation: `db/schema/016_user_custom_pages.sql` — `user_custom_pages` + `user_custom_page_views` (shipped PR #4). Backend: `backend/internal/custompages/`. Frontend route: `app/(user)/p/[id]/page.tsx`.
- Existing UI-app scaffolding (internal, not the same thing): `app/store/ui_apps/` via `<makeapp>` shortcut — see `docs/c_make-app.md`.
- Reference for Rally's model: https://rally1.rallydev.com/docs/en-us/saas/apps/2.1/doc/index.html#!/guide/getting_started
