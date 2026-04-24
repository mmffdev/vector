---
name: Vector PM Dev Accounts
description: Known test credentials for local dev (gadmin + padmin + user) as of 2026-04-21
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
Local dev credentials for the Vector PM app (backend on :5100, frontend on :5101). Accounts are named by role for clarity:

- **gadmin@mmffdev.com** / `myApples27@` — role=gadmin (password reset on 2026-04-21 ~04:46 UTC against host DB)
- **padmin@mmffdev.com** / `myApples100@@` — role=padmin (two @ signs — intentional)
- **user@mmffdev.com** / `SecureCsrf2026!` — role=user

All three have `force_password_change=false` and `is_active=true`.

**Why:** Test accounts get created/reset often during dev. Tracking the live passwords saves re-running the reset flow just to log in. The original `admin@/alice@/bob@` scheme was replaced with role-named emails on 2026-04-21.

**How to apply:** Use these to demo or test auth flows. If a password stops working, the user likely rotated it — ask before resetting. Reset flow: `POST /api/auth/password-reset` → grep `/tmp/mmff-server.log` for `reset link →` → `POST /api/auth/password-reset/confirm` with the token.
