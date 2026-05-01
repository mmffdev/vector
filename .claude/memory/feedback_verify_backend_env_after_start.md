---
name: Verify backend env after every start
description: After starting/restarting backend, curl /api/env and read out db_host + backend_env BEFORE any other action — never assume the env flag took effect
type: feedback
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
After any backend start or restart, the very next action is `curl -sS http://localhost:5100/api/env` and I must read out `db_host` and `backend_env` to confirm they match the intended env file. No tool call between start and verify.

**Why:** On 2026-05-01 I started the backend with `ENV_FILE=.env.dev`, which the binary silently ignores (the actual var is `BACKEND_ENV`). The process loaded `.env.local` defaults and bound to local DB `:5434`, while I'd just applied migrations to dev VPS `:5435` via psql directly. I declared the stack "up against dev" without verifying. When login failed, I jumped to a "the password hash changed" theory and almost recommended resetting a password that was never wrong. The real fault was a misconfigured backend pretending to be dev. This was a 10-second check I skipped.

**How to apply:**
- Backend env vars are project-specific — never assume `ENV_FILE`/`APP_ENV`/`BACKEND_ENV` without reading `cmd/server/main.go`. In this repo it's `BACKEND_ENV=<env>` (loads `.env.<env>`).
- Sequence: start backend → `curl /api/env` → confirm `{backend_env, db_host}` match the file → then everything else.
- Prefer the `<server> -d|-s|-p` shortcut and `<services>` for env switches; they verify automatically.
- When login/auth fails on a freshly-started stack, the first hypothesis is "wrong DB", not "wrong password". Check `/api/env` before going near `users.password_hash`.
- Per `feedback_never_change_passwords.md`: never edit `password_hash` regardless. This memory complements that one — it stops me from even *suggesting* a password issue when the real fault is env routing.
