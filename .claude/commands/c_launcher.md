# `<launcher>` — MMFF Vector Launcher.app

> Last verified: 2026-04-27

Native SwiftUI macOS dashboard that orchestrates the Vector dev stack (SSH tunnel → Go backend → Next.js frontend) with start/stop/restart-all + per-component controls, env switching (`D/S/P`), structured JSONL logging, and a localhost bridge for the running web app. Coexists with `MMFF Vector Dev.app` (AppleScript) — does not replace it.

## Bundle

[`../../MMFF Vector Launcher.app`](../../MMFF%20Vector%20Launcher.app) — repo-root `.app`, ad-hoc signed (`Identifier=dev.mmff.vector.launcher`, arm64, runtime+adhoc flags). First launch may be Gatekeeper-blocked; right-click → Open once to whitelist.

## Source

- Swift package: [`../../Sources/MMFFVectorLauncher/`](../../Sources/MMFFVectorLauncher/) (17 files)
- Tests: [`../../Tests/MMFFVectorLauncherTests/`](../../Tests/MMFFVectorLauncherTests/) (22 XCTest cases, 0 failures)
- Spec: [`../../local-assets/launcher/spec/SPEC.md`](../../local-assets/launcher/spec/SPEC.md)
- Test plan: [`../../local-assets/launcher/spec/TESTPLAN.md`](../../local-assets/launcher/spec/TESTPLAN.md)
- Charts: [`../../local-assets/launcher/charts/`](../../local-assets/launcher/charts/) (7 SVGs)
- Build report: [`../../dev/research/R003.json`](../../dev/research/R003.json) — viewable in Dev → Research tab.

## Usage

```bash
open -a "MMFF Vector Launcher"
```

The dashboard supervises three components and reads the active env from the `ACTIVE_BACKEND_ENV` marker in `.claude/CLAUDE.md`. Switching env via the env selector rewrites the marker atomically (POSIX `flock` + `mkstemp`+rename) and restarts the backend with the new tunnel port.

## Build (no full Xcode required)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" \
  && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build -c release \
  && ./tools/launcher/package.sh
```

`package.sh` re-creates `MMFF Vector Launcher.app/Contents/{MacOS,Info.plist,Resources}`, copies the release binary, and runs `codesign -s - --force` (ad-hoc).

## Tests

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
```

22 XCTest cases across JSONLLogger, RetryPolicy, HealthProbe, HTTPRequest, BackendEnv, MarkerLock. Run log appended to TESTPLAN.md §7. Integration (51 cases) and e2e (14 scenarios) tiers gated on fixture work — see TESTPLAN.md §2.

## Logs

- App log: `~/Library/Logs/MMFFVectorLauncher/launcher.jsonl` (10 MB rotation, 7-day retention)
- Tunnel: `/tmp/mmff-tunnel.log`
- Backend: `/tmp/mmff-server.log`
- Frontend: `/tmp/mmff-next.log`

## Coexistence with existing tooling

| Tool | Owns | Conflict-free because |
|---|---|---|
| `MMFF Vector Dev.app` (AppleScript) | One-shot bring-up | Detects already-running services and adopts; does not double-spawn |
| `<services>` | Read-only status | Reads same marker + same `/healthz`; never starts anything |
| `<server> -d/-s/-p` | Backend env switch | Same marker file + same atomic-write pattern; mutual flock |
| `<npm>` | Frontend on `:3000` for ad-hoc work | Launcher uses `:5101` — distinct port |
