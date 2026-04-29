---
name: Two Postgres instances — local Docker (5433) vs remote SSH tunnel (5434)
description: Backend uses remote Postgres via SSH tunnel on port 5434, not local Docker on 5433. Direct psql/docker commands hit the wrong DB.
type: project
originSessionId: f9e1df41-a67e-453d-9a5b-b23b674c9d40
---
The backend reads `DB_PORT` from `backend/.env.local`. In this environment:
- **Port 5433** — local Docker Postgres (used by `docker exec -i mmff-ops-postgres psql ...`). Used for local-only inspection; NOT what the backend queries.
- **Port 5434** — remote Postgres via SSH tunnel (`ssh -N -f mmffdev-pg`). This is what the running backend queries.

**Why:** The project runs against a remote shared Postgres on mmffdev.com. The local Docker instance is a dev convenience but the backend `.env.local` points to 5434.

**How to apply:**
- When verifying what the backend will actually see, always query port 5434 using `/opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops`.
- The password is in `backend/.env.local` under `DB_PASSWORD`.
- `docker exec -i mmff-ops-postgres psql ...` queries 5433 (local Docker) — results may diverge from what the API returns.
- Any insert/update that must be visible to the running backend must go to port 5434.
