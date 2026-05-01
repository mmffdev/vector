---
name: Dev app login credentials
description: Browser/Playwright login for the dev backend — known passwords for the three seeded accounts.
type: reference
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
Dev environment app login (when active backend env is `dev`). Use these in the browser or Playwright when you need to actually inspect rendered DOM, computed styles, or interact with the app.

| Email | Role | Password |
|---|---|---|
| `padmin@mmffdev.com` | padmin | `TestPass1!` |
| `user@mmffdev.com` | user | `TestPass1!` (assumed — same convention) |
| `gadmin@mmffdev.com` | gadmin | `TestPass1!` (assumed — same convention) |

Login URL (frontend): `http://localhost:5101/login`
Backend auth endpoint: `http://localhost:5100/api/auth/login` — POST `{email, password}`.

Hard rule still applies: never change `users.password_hash` in DB. If a password stops working, ask Rick — do not reset it.
