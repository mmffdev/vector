---
name: Launcher backend stale-binary trap
description: After a Go source edit, the launcher-managed backend keeps running the OLD code even though /tmp/vector-backend on disk has been overwritten with the new build — symptoms include new routes returning 400/404 with "auth ok"
type: project
originSessionId: 1c78088f-5e4b-44b3-a787-05861b3b8995
---
The Vector Launcher spawns the backend via `go build -o /tmp/vector-backend ./cmd/server && /tmp/vector-backend`. Once the binary is exec'd, macOS keeps the running process's mapped pages independent of the on-disk file. A subsequent `go build` overwrites `/tmp/vector-backend` on disk but the running PID continues serving the old code.

**Why:** Air (the file-watcher rebuilder) is also running, but it cannot bind port 5100 because the launcher's backend already has it. Air's rebuilds silently fail with `exit status 1` to `/tmp/air-vector-backend/build-errors.log`. So neither path delivers fresh code to the running port.

**How to apply:** When a freshly added Go route returns 400/404 (or hits `/{id}` despite being registered before it as a static path), AND `shasum /tmp/vector-backend` matches a fresh `go build` output, the running process is stale. Fix by SIGKILL'ing the launcher-spawned backend PID — the launcher's `ProcessSupervisor` will respawn it, which re-runs `go build && exec`. SIGTERM may be ignored. To verify the new code works without disturbing the live server, build to an alternate path and run on `SERVER_PORT=5199` with `.env.dev` sourced.
