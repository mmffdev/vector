---
name: Keep services and servers running
description: User expects Claude to monitor and keep dev services (backend, frontend, SSH tunnel) alive across sessions, not let them die with the session
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
Claude must keep development services up — backend (`go run ./cmd/server` on :8080), frontend (`next dev`), SSH tunnel (`mmffdev-pg` → localhost:5434) — and monitor them, not just start-and-forget.

**Why:** Repeatedly letting the Go backend die between sessions (because `go run` was tethered to the Claude session's process group) caused visible symptoms for the user (CORS errors, broken login) that looked like fresh bugs each time. Starting services in-session only defers the failure.

**How to apply:**
- Start long-running dev services **detached from the Claude session** — use `launchd` plist, `nohup` with full disown, `tmux`/`screen`, or a separately-started terminal — so SIGTERM on session end doesn't cascade.
- At session start (or when the user mentions server/frontend/tunnel), proactively check status with `lsof -iTCP:<port> -sTCP:LISTEN` and `pgrep -f <name>`; if something's down, offer to restart it before the user notices.
- When restarting a service, verify it's actually listening before reporting "up" — don't trust the `&` backgrounding, grep the port.
- Treat a dying service as a setup defect (fix persistence), not a one-off (restart it again).
