---
name: Dev backend uses `go run`, not a pre-built binary
description: How the backend process actually starts on the dev machine, and the staleness trap it creates.
type: project
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
The backend is launched via `go run ./cmd/server` (by `<server>`, by `MMFF Vector Launcher.app`, or by hand). Form:

```
cd backend && nohup bash -lc 'go run ./cmd/server' </dev/null >/tmp/mmff-server.log 2>&1 &
```

So the running backend process is the binary `go run` produces and immediately executes — not `./backend/server` on disk. There is no pre-built artifact in the launcher's flow (and `backend/server` is gitignored).

**Why this matters / how to apply:**
- A `./backend/server` file on disk (e.g., from `go build`, or from a sub-agent's verification step) is **NOT** what's serving traffic. Comparing its mtime to anything is misleading.
- The running process is "frozen" at whatever the source tree looked like the moment it was started. Source edits after that point do not take effect until the process is restarted.
- Restart path: `<server> -d` (or `-s`/`-p`) cleanly stops the old process and re-launches with the right env. Or kill + manual `cd backend && nohup bash -lc 'go run ./cmd/server' …` if you want to bypass the env switch.
- Drift detection: `/healthz` returns `{commit, build_time, started_at}` (added 2026-04-25). The `<services>` check compares `commit` to `git rev-parse HEAD` and prints `STALE — restart` on mismatch. If `/healthz` returns plain `ok` instead of JSON, the running process predates that endpoint and definitely needs a restart.
- The `Commit`/`BuildTime` ldflags are not wired into the `go run` command (no easy way to inject ldflags into `go run`); for a `go run`-started process, `commit` will read `"dev"` and the staleness check falls back to "if /healthz is plaintext, restart". For binaries built explicitly with `go build -ldflags`, the commit hash is real and the comparison is precise.
