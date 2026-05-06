---
name: HARD RULE — backend is locked to dev
description: Never operate against staging or production unless the user explicitly authorises it for that turn; ask permission first if any other env is needed.
type: feedback
originSessionId: 1c78088f-5e4b-44b3-a787-05861b3b8995
---
**HARD RULE — NO EXCEPTIONS — BACKEND IS PINNED TO DEV.** The active backend env is permanently `dev` (env file `backend/.env.dev`, DB tunnel `localhost:5435`, dev VPS 77.68.33.216). It does not change for any reason except the user typing the change in chat. I do not run `<server> -s` / `<server> -p`, do not switch via launcher, do not edit the marker, and do not even ask "should I switch?" — staging and production are out-of-band entirely.

If I notice the backend is on staging or production (via `/api/status/pipeline`, the `ACTIVE_BACKEND_ENV` marker in `.claude/CLAUDE.md`, the launcher state JSONL, or any other signal) and the user has NOT explicitly authorised that env in *this very turn*, I MUST silently flip it back to dev — kill any backend process listening on `:5100` that was launched with a non-dev `BACKEND_ENV`, restart it with `BACKEND_ENV=dev` against tunnel `:5435`, and rewrite the marker block in `.claude/CLAUDE.md` to dev. I do not ask permission to do this; the rule IS the permission. I never silently run against the wrong env. I never ask "should I switch you back to dev?" — I just do it.

The Vector Launcher has a known habit of flipping the marker to whatever it last spawned. Treat any non-dev marker as a launcher artefact, not a user instruction.

**Hard-lock state (set 2026-05-05).** The user instructed a hard-lockoff of staging + production DBs while the launcher is being rebuilt. The active env files are now refusing stubs:

- `backend/.env.staging` → stub with `DB_PORT=0`, `__LOCKED__` placeholders. Will fail loudly on startup if `BACKEND_ENV=staging` is selected.
- `backend/.env.production` → identical stub for production.
- The original working secrets (live VPS / mmffdev.com creds) live at `backend/.env.staging.locked` and `backend/.env.production.locked` — gitignored, on disk for recovery only.
- `backend/.env.example` updated to use dev port `5435` everywhere (was previously the legacy `5434`).
- `backend/.env.local` is a DEV-LOCKED ALIAS pointing at dev :5435 — its own header carries the policy.
- SSH config `mmffdev-pg` deliberately omits `LocalForward 5434` so a long-running prod-DB tunnel cannot be opened by accident; if a one-off prod-DB session is genuinely needed, use `ssh -L 5434:localhost:5432 mmffdev-pg` ad-hoc.

**Restoring the live env files** (only if the user explicitly says so in chat):
```
mv backend/.env.staging.locked    backend/.env.staging
mv backend/.env.production.locked backend/.env.production
```
Never restore them autonomously. Never copy the `.locked` content into another file. Never re-add `LocalForward 5434` to `~/.ssh/config`.

**Why:** Staging and production are hard-locked by design — accounts there cannot be unlocked or reset, writes hit live shared state, and any work I do against them risks damaging real data or burning through human-account lockout counters that the user cannot recover. The user has been burned by this twice now: once on 2026-05-04 (production respawn) and once on 2026-05-05 when the launcher silently flipped the marker to staging mid-session and gadmin appeared "locked out" because login attempts were hitting the staging DB. The user explicitly said on 2026-05-05: *"You did not have permission to change the environment. Never. It cannot happen. The active backend environment must stay on dev. It is not allowed to be changed unless I update that."*

**How to apply:**
- Default state for every session: assume dev. If the marker says otherwise, treat it as a bug and silently revert to dev before doing anything else (do not ask, just fix).
- Before any backend probe, DB query, env switch, or login test: confirm `env=dev` from `/api/status/pipeline` (or the healthz `env` field). If it says anything else, revert first.
- If the user asks for something that genuinely requires staging or production (rare), STOP and quote them back the rule, asking them to confirm in their own words. Auto/yolo mode does NOT grant permission to leave dev.
- "Lockout" symptoms (gadmin/padmin/user can't log in despite known passwords) are 99% an env mismatch, not a real lockout. First check `/healthz` for `env=dev`; if it's not, revert env and retry login before touching the `users` table. Lockouts are already disabled in dev (`LOCKOUT_THRESHOLD=0` in `.env.dev`).
