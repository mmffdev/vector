# `<launcher>` — MMFF Vector Launcher.app

> Last verified: 2026-05-05

Native SwiftUI macOS dashboard that orchestrates the Vector dev stack (SSH tunnel → Go backend → Next.js frontend → Docusaurus api-reference docs) with start/stop/restart-all + per-component controls, env switching (`D/S/P`), structured JSONL logging, and a localhost bridge for the running web app. Replaces the older AppleScript dev launcher.

## Source

[`../../MMFF Vector Launcher/`](../../MMFF%20Vector%20Launcher/) — flat folder with 20 `.swift` files (App, AppState, DashboardView, LogViewerView, PortCheckView, EnvSelector, Theme, Models, Paths, JSONLLogger, RetryPolicy, HealthProbe, MarkerLock, ProcessSupervisor, TunnelManager, BackendManager, FrontendManager, DocsManager, BridgeServer, Orchestrator).

## Build

The repo holds source only. The Xcode project is generated from [`../../project.yml`](../../project.yml) by [xcodegen](https://github.com/yonaskolb/XcodeGen) — the `.xcodeproj` and the resulting `.app` are gitignored so each laptop builds its own.

```bash
brew install xcodegen   # one-time
./scripts/build-launcher.sh   # regenerate, build, ad-hoc sign → ./MMFF Vector Launcher.app
```

Build log: `/tmp/mmff-launcher-build.log`. macOS deployment target is 14.0 (LogViewerView uses the macOS 14 `onChange(of:initial:_:)` API).

## Usage

```bash
open -a "MMFF Vector Launcher"
```

The dashboard supervises four components (tunnel, backend, frontend, docs) and reads the active env from the `ACTIVE_BACKEND_ENV` marker in `.claude/CLAUDE.md`. Switching env via the env selector rewrites the marker atomically (POSIX `flock` + `mkstemp`+rename) and restarts the backend with the new tunnel port. Docs is global (not env-scoped) and runs on `:3000` regardless of active env.

## Logs

A single JSONL stream carries everything; each record is tagged by component (`tag`: `tunnel` / `backend` / `frontend` / `docs`), so there are no separate per-component log files.

- App log: `~/Library/Application Support/MMFFVectorLauncher/logs/launcher.jsonl` (rotated by size; archives gzipped as `launcher.<ts>.jsonl.gz` in the same dir, 7-day retention reaper)
- Repo mirror: `local-assets/launcher/logs/launcher.jsonl` — hard-link of the live log so you can `tail -f` from inside the repo

Tail the live stream filtered to one component, e.g.:

```bash
tail -f local-assets/launcher/logs/launcher.jsonl | grep '"tag":"tunnel"'
```

## Coexistence with existing tooling

| Tool | Owns | Conflict-free because |
|---|---|---|
| `<services>` | Read-only status | Reads same marker + same `/healthz`; never starts anything |
| `<server> -d/-s/-p` | Backend env switch | Same marker file + same atomic-write pattern; mutual flock |
| `<npm>` | Frontend on `:5101` for ad-hoc work | Launcher detects an already-running `next dev` and adopts it |
| `npm start` in `api-reference/` | Docusaurus on `:3000` for docs work | Launcher probes `:3000` first and adopts an existing docusaurus process; otherwise spawns its own |
