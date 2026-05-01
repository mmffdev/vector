# `<launcher>` — MMFF Vector Launcher.app

> Last verified: 2026-05-01

Native SwiftUI macOS dashboard that orchestrates the Vector dev stack (SSH tunnel → Go backend → Next.js frontend) with start/stop/restart-all + per-component controls, env switching (`D/S/P`), structured JSONL logging, and a localhost bridge for the running web app. Replaces the older AppleScript dev launcher.

## Source

[`../../MMFF Vector Launcher/`](../../MMFF%20Vector%20Launcher/) — flat folder with 19 `.swift` files (App, AppState, DashboardView, LogViewerView, PortCheckView, EnvSelector, Theme, Models, Paths, JSONLLogger, RetryPolicy, HealthProbe, MarkerLock, ProcessSupervisor, TunnelManager, BackendManager, FrontendManager, BridgeServer, Orchestrator).

## Build

The repo holds source only — the Xcode project (`.xcodeproj`) lives outside the repo and references these files in place. Open the project in Xcode, **Product → Archive** (or **Run** for debug), then drop the resulting `MMFF Vector Launcher.app` wherever you want (e.g. `/Applications`).

If the project file is missing on a fresh clone, recreate it: in Xcode, **File → New → Project → macOS → App**, set product name `MMFF Vector Launcher`, bundle id `dev.mmff.vector.launcher`, then drag the `MMFF Vector Launcher/` folder in as a group.

## Usage

```bash
open -a "MMFF Vector Launcher"
```

The dashboard supervises three components and reads the active env from the `ACTIVE_BACKEND_ENV` marker in `.claude/CLAUDE.md`. Switching env via the env selector rewrites the marker atomically (POSIX `flock` + `mkstemp`+rename) and restarts the backend with the new tunnel port.

## Logs

- App log: `~/Library/Logs/MMFFVectorLauncher/launcher.jsonl` (10 MB rotation, 7-day retention)
- Tunnel: `/tmp/mmff-tunnel.log`
- Backend: `/tmp/mmff-server.log`
- Frontend: `/tmp/mmff-next.log`

## Coexistence with existing tooling

| Tool | Owns | Conflict-free because |
|---|---|---|
| `<services>` | Read-only status | Reads same marker + same `/healthz`; never starts anything |
| `<server> -d/-s/-p` | Backend env switch | Same marker file + same atomic-write pattern; mutual flock |
| `<npm>` | Frontend on `:5101` for ad-hoc work | Launcher detects an already-running `next dev` and adopts it |
