# Feature Request — Global Alerts & Messages System

> Created: 2026-04-23
> Status: deferred — park until after nav registry split ships
> Raised from: plan_nav_registry_split.md (need a non-raw-403 flow for role-ceiling violations)

---

## Why

No unified surface for telling the user things right now. Every page rolls its own inline error states; there's nothing for transient success toasts, nothing for cross-page banners ("you were redirected because…"), nothing for nudge-style admin notices.

The role-ceiling rule (see memory `feedback_role_ceiling.md`) needs this: when a padmin hits something gadmin-only, we want to redirect them to `/dashboard` with an explanation banner — not render a bare 403 page. Same need will recur for every "you don't have access", "session expired", "saved OK", "something went wrong".

## Shape (sketch, not committed)

- **Toasts** — transient, auto-dismiss, stacked top-right or bottom-right. Success / info / warning / error. Used for "Saved", "Deleted", "Copied link".
- **Banners** — persistent until dismissed, page-level or app-level. Used for "You were redirected because your role doesn't permit X — contact your padmin".
- **Modals (existing Modal primitive)** — stays as-is for anything that needs explicit acknowledgement.
- **Contact-admin helper** — small reusable snippet that renders the right contact hint based on the failure type (role ceiling → your padmin or gadmin; tenant config → your gadmin; etc). Reads from future org-structure data.

## Where it slots in

- React context provider (`AlertsProvider`) at app root, exposing `useAlerts()` with `toast(...)`, `banner(...)`, `dismiss(...)`.
- Global axios/fetch interceptor that catches 401/403/5xx and surfaces via the alerts system — centralises "what to show when the API says no".
- CSS tokens for alert levels, respecting light/dark theme.

## Dependencies / touches

- `app/lib/api.ts` — extend `ApiError` handling to route through the alerts context.
- All existing inline error paths — migrate to `useAlerts()` once the system lands, not before.
- Role-ceiling redirect behaviour (nav registry plan) — switches from "inline error for now" to "redirect + banner" when this ships.

## Open questions (for when we pick this up)

- Toast stack limit? Auto-dismiss duration?
- Do banners persist across navigation or reset per-route?
- Should errors bubble up through React error boundaries too, or only through the API layer?
- Accessibility — aria-live regions for toasts, focus management for banners.

## Not in scope

- In-app notifications / inbox (separate feature — read/unread state, historical record).
- Email notifications.
- Real-time pushes.
