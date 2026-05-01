---
name: MMFF Vector Launcher — backlog
description: Launcher app status — v0.1 shipped 2026-04-27. Unit slice complete (28 PASS); integration + e2e tiers pending fixtures.
type: project
originSessionId: 43139e10-f5f1-4a48-bb00-5f2c887dc814
---
# MMFF Vector Launcher — backlog

**Status as of 2026-04-27:** v0.1 SHIPPED. `MMFF Vector Launcher.app` at repo root, ad-hoc signed (Identifier=`dev.mmff.vector.launcher`, arm64). 28 of 92 tests run, 28 PASS / 0 FAIL. Build report at `dev/research/R003.json` (Dev → Research tab).

**Why:** User wanted a single dashboard with start/stop/restart-all + per-component controls, structured JSONL logging, retry loops, and DB env selection — coexisting with the existing `MMFF Vector Dev.app` AppleScript and the `<server>`/`<services>`/`<npm>` shortcuts.

**How to apply:**
- Resume work by reading `local-assets/launcher/MASTER.md` and the agent logs under `local-assets/launcher/agents/`.
- Build: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build -c release && ./tools/launcher/package.sh`. The `DEVELOPER_DIR` override is REQUIRED — `xcode-select` points at CommandLineTools (no XCTest); Xcode.app supplies it without needing `sudo xcode-select -s`.
- Test: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`.
- Hard rule: NO GIT (still active for any future launcher work the user delegates).
- Hard rule: do not modify `MMFF Vector Dev.app`, `MMFF Vector Dev.applescript`, `<server>`, `<services>`, `<npm>`.

## Phases
- [x] **P0** — Master file, agent log template, dirs, toolchain probe
- [x] **P1** — 10 research agents (Calliope, Boreas, Demeter, Eros, Fenrir, Gaia, Helios, Iris, Janus, Kratos), each with log + test slice
- [x] **P2** — SPEC.md + TESTPLAN.md synthesised, all agents ≥95% confidence
- [x] **P3** — Swift Package + .app bundle skeleton (`Sources/MMFFVectorLauncher/` × 17 files, `tools/launcher/package.sh`)
- [x] **P4** — Foundation: JSONLLogger, RetryPolicy, HealthProbe, MarkerLock, ProcessSupervisor
- [x] **P5** — Tunnel/Backend/Frontend managers + EnvSelector
- [x] **P6** — SwiftUI dashboard (DashboardView + per-component cards + log tail)
- [x] **P7** — Localhost bridge HTTP server (BridgeServer.swift, bearer + idempotency-key)
- [x] **P8a** — Unit tier (22 XCTest cases + 6 bundle/codesign/launch checks = 28 PASS)
- [ ] **P8b** — Integration tier (51 cases) — needs `tools/launcher/fixtures/{fake_ssh,fake_backend,fake_frontend}` Python+bash; deferred next phase
- [ ] **P8c** — E2E tier (14 scenarios E2E-T01..T14) — orchestrator-driven, runs after handover with real services up
- [x] **P9** — Charts (7 SVGs in `local-assets/launcher/charts/`, all xmllint-clean, dashed 95% threshold)
- [x] **P10** — `dev/research/R003.json` published
- [x] **P11** — Handover delivered

## Critical decisions (resolved)
- **App bundling without Xcode:** SwiftPM build → hand-crafted `.app` bundle (Contents/MacOS, Info.plist, Resources, _CodeSignature). `package.sh` ad-hoc signs.
- **SSH tunnel transport:** spawn `ssh -fN` (Foundation.Process), matching the existing AppleScript pattern. Adopts already-running tunnels by PID lookup.
- **Web bridge transport:** localhost HTTP (NWListener) on a random high port, bearer token + idempotency-key, constant-time compare. EnvBadge can call via fetch.
- **Code signing:** ad-hoc (`codesign -s -`), no notarisation. spctl rejects (expected; recorded as IRI-T06 PASS — internal dev tool).
- **Health-probe contract:** `/healthz` JSON shape from backend; `commit` field compared to `git rev-parse HEAD` (read-only) on the launcher side. Terminal failures: BAD_SHAPE, STALE. Transient: TIMEOUT, REFUSED, NETWORK_DOWN. Full-jitter exponential backoff.
- **Marker-file write coordination:** POSIX `flock` + `mkstemp`+rename (atomic). Same lock used by `<server>` shortcut.

## Next-phase (when user resumes)
- Build fake_ssh / fake_backend / fake_frontend fixtures so integration tier (51 cases) can run unattended.
- Then run e2e tier with real backend + tunnel up.
- Coverage report (`xcrun llvm-cov merge`) gated on integration completion.
- Optional v0.2: keychain-backed bridge token (currently in-memory ephemeral), Sparkle update channel, AppIcon design from Vector Design System.

## Out of scope (still)
- Touching git
- Replacing existing `MMFF Vector Dev.app` AppleScript launcher
- XCUITest (CommandLineTools cannot drive UI bundles; e2e tier covers the surface)

## Files produced (canonical)
- App: `MMFF Vector Launcher.app/`
- Source: `Sources/MMFFVectorLauncher/{App,AppState,DashboardView,EnvSelector,Theme,Models,Paths,JSONLLogger,RetryPolicy,HealthProbe,MarkerLock,ProcessSupervisor,TunnelManager,BackendManager,FrontendManager,BridgeServer,Orchestrator}.swift`
- Tests: `Tests/MMFFVectorLauncherTests/{JSONLLogger,RetryPolicy,HealthProbe,HTTPRequest,BackendEnv,MarkerLock}Tests.swift`
- Package: `Package.swift`
- Build/package: `tools/launcher/package.sh`
- Spec/test plan: `local-assets/launcher/spec/{SPEC,TESTPLAN}.md`
- Charts: `local-assets/launcher/charts/{startup_latency_p50_p95,uptime_24h,retries_stacked_area,error_rate_per_tag,env_switch_frequency,time_to_first_healthy,test_results_summary}.svg`
- Agent logs: `local-assets/launcher/agents/{Calliope,Boreas,Demeter,Eros,Fenrir,Gaia,Helios,Iris,Janus,Kratos}.md`
- Master orchestrator log: `local-assets/launcher/MASTER.md`
- Final report: `dev/research/R003.json`
- CLAUDE.md pointer: `<launcher>` → `.claude/commands/c_launcher.md`
