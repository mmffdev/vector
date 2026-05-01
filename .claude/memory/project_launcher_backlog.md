---
name: MMFF Vector Launcher — backlog
description: Launcher app status — reorganised 2026-05-01 to flat `MMFF Vector Launcher/` folder; Xcode project lives outside the repo on the dev machines.
type: project
originSessionId: 43139e10-f5f1-4a48-bb00-5f2c887dc814
---
# MMFF Vector Launcher — backlog

**Status as of 2026-05-01:** Source reorganised from SwiftPM (`Sources/MMFFVectorLauncher/`, `Package.swift`, `tools/launcher/`, hand-crafted `.app`) to a flat `MMFF Vector Launcher/` folder containing 19 `.swift` files. The Xcode project (`.xcodeproj`) lives **outside the repo** on each dev machine and references those files in place. Earlier history of v0.1 work, agents, and test results is preserved in `local-assets/launcher/MASTER.md` and `dev/research/R003.json`.

**Why:** User wanted a single dashboard with start/stop/restart-all + per-component controls, structured JSONL logging, retry loops, and DB env selection — replacing the older `MMFF Vector Dev.app` AppleScript launcher (now removed).

**How to apply:**
- Build by opening the Xcode project (kept outside the repo) and Product → Run / Product → Archive. Drop the resulting `.app` wherever you want.
- If the `.xcodeproj` is missing on a fresh clone, recreate via Xcode → File → New → Project → macOS → App, then drag the `MMFF Vector Launcher/` folder in as a group. Bundle id: `dev.mmff.vector.launcher`.
- Resume work by reading `local-assets/launcher/MASTER.md` and the agent logs under `local-assets/launcher/agents/`.
- Hard rule: do not modify `<server>`, `<services>`, `<npm>` without re-running their integration tests.

## Critical decisions (resolved)
- **App bundling:** moved to Xcode project (kept outside the repo) — simpler than the previous SwiftPM + hand-crafted `.app` route. Source lives in repo at `MMFF Vector Launcher/` and is referenced in place.
- **SSH tunnel transport:** spawn `ssh -fN` (Foundation.Process). Adopts already-running tunnels by PID lookup.
- **Web bridge transport:** localhost HTTP (NWListener) on a random high port, bearer token + idempotency-key, constant-time compare.
- **Code signing:** ad-hoc, no notarisation. Internal dev tool; first-run Gatekeeper requires right-click → Open.
- **Health-probe contract:** `/healthz` JSON shape from backend; `commit` field compared to `git rev-parse HEAD`. Terminal failures: BAD_SHAPE, STALE. Transient: TIMEOUT, REFUSED, NETWORK_DOWN. Full-jitter exponential backoff.
- **Marker-file write coordination:** POSIX `flock` + `mkstemp`+rename (atomic). Same lock used by `<server>` shortcut.

## Files produced (canonical)
- Source: `MMFF Vector Launcher/{App,AppState,DashboardView,LogViewerView,PortCheckView,EnvSelector,Theme,Models,Paths,JSONLLogger,RetryPolicy,HealthProbe,MarkerLock,ProcessSupervisor,TunnelManager,BackendManager,FrontendManager,BridgeServer,Orchestrator}.swift` (19 files)
- Spec/test plan: `local-assets/launcher/spec/{SPEC,TESTPLAN}.md`
- Charts: `local-assets/launcher/charts/{startup_latency_p50_p95,uptime_24h,retries_stacked_area,error_rate_per_tag,env_switch_frequency,time_to_first_healthy,test_results_summary}.svg`
- Agent logs: `local-assets/launcher/agents/{Calliope,Boreas,Demeter,Eros,Fenrir,Gaia,Helios,Iris,Janus,Kratos}.md`
- Master orchestrator log: `local-assets/launcher/MASTER.md`
- Final report: `dev/research/R003.json`
- CLAUDE.md pointer: `<launcher>` → `.claude/commands/c_launcher.md`
