# MMFF Vector Launcher — Handover (v0.1)

**Date:** 2026-04-27
**Author:** Claude Opus 4.7 (orchestrator) + 10 named sub-agents
**Confidence:** 96% (orchestrator) / all sub-agents ≥95%
**Hard rules honoured:** NO GIT (no commits, branches, resets, pushes); coexistence with `MMFF Vector Dev.app`, `<server>`, `<services>`, `<npm>` preserved.

---

## What you're getting

A native macOS launcher that orchestrates the full Vector dev stack from one window:

- Per-component **Start / Stop / Restart** for SSH tunnel, Go backend, Next.js frontend.
- **Restart-all** with the correct dependency order (tunnel → backend → frontend).
- **Env selector** (D/S/P) — atomically rewrites the `ACTIVE_BACKEND_ENV` marker in `.claude/CLAUDE.md` (POSIX `flock` + `mkstemp`+rename) and restarts the backend on the right tunnel port.
- **Live JSONL log tail** in the dashboard, persistent log at `~/Library/Logs/MMFFVectorLauncher/launcher.jsonl` (10 MB rotation, 7-day retention).
- **Localhost bridge** (random high port, bearer token + idempotency-key, constant-time compare) so the running web app can call the launcher (e.g. EnvBadge can drive an env switch) without inventing a parallel control plane.
- **Process supervision** with PGID-based kills, full-jitter exponential backoff on retries, and adoption of already-running services (so it does not double-spawn the AppleScript launcher's tunnel).

---

## How to run

```bash
open -a "MMFF Vector Launcher"
```

First launch will be Gatekeeper-blocked (ad-hoc signed, no notarisation). **Right-click → Open once** to whitelist. Subsequent launches work normally.

`<launcher>` is wired into `.claude/CLAUDE.md` and resolves to [`../../.claude/commands/c_launcher.md`](../../.claude/commands/c_launcher.md).

---

## Where everything lives

| What | Path |
|---|---|
| App bundle | `MMFF Vector Launcher.app/` (repo root) |
| Swift sources | `Sources/MMFFVectorLauncher/` (17 files) |
| XCTest cases | `Tests/MMFFVectorLauncherTests/` (22 cases, 0 failures) |
| Package manifest | `Package.swift` |
| Build/package script | `tools/launcher/package.sh` |
| Spec | `local-assets/launcher/spec/SPEC.md` |
| Test plan + run log | `local-assets/launcher/spec/TESTPLAN.md` |
| Charts (7 SVGs) | `local-assets/launcher/charts/` |
| 10 agent logs | `local-assets/launcher/agents/` |
| Master orchestrator log | `local-assets/launcher/MASTER.md` |
| **Build report** | `dev/research/R003.json` (Dev → Research tab) |
| Shortcut doc | `.claude/commands/c_launcher.md` |
| Memory entry | `project_launcher_backlog.md` |

---

## Multi-agent research — what each agent contributed

All 10 agents completed at ≥95% confidence and recorded their slice tests, dead ends, sources, and effort %.

| # | Agent | Slice | Coverage | Status |
|---|---|---|---|---|
| 1 | Calliope | SwiftUI app + no-Xcode `.app` bundling | 15% | complete @ 96% |
| 2 | Boreas | SSH tunnel orchestration | 10% | complete @ 95% |
| 3 | Demeter | Process supervision (backend + frontend) | 12% | complete @ 96% |
| 4 | Eros | JSONL logging + rotation + tail | 8% | complete @ 97% |
| 5 | Fenrir | Web ↔ native bridge | 10% | complete @ 95% |
| 6 | Gaia | Test architecture (3 tiers) | 12% | complete @ 96% |
| 7 | Helios | Charts/graphs spec + SVG | 6% | complete @ 97% |
| 8 | Iris | macOS 26 security (codesign, gatekeeper) | 9% | complete @ 95% |
| 9 | Janus | Health-probe contract + retry/backoff | 8% | complete @ 96% |
| 10 | Kratos | Existing-tooling integration & coexistence map | 10% | complete @ 95% |

Their per-slice test tables (with steps, expected, actual, root cause if FAIL, repeatability) are in each `local-assets/launcher/agents/<Name>.md`.

---

## Test results

**Unit slice — RUN, all PASS.** 22 XCTest cases plus 6 bundle/codesign/launch checks = **28 cases, 0 failures, 0 errors, 11.24 s build time.**

| Module | Cases | Result |
|---|---|---|
| JSONLLogger | 3 | PASS |
| RetryPolicy | 3 | PASS |
| HealthProbe | 4 | PASS |
| HTTPRequest (bridge parser) | 5 | PASS |
| BackendEnv (canonical constants) | 5 | PASS |
| MarkerLock | 2 | PASS |
| Bundle / codesign / smoke launch | 6 | PASS |

Run with:
```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
```

(`DEVELOPER_DIR` is required because `xcode-select` points at CommandLineTools, which doesn't ship XCTest. Per-invocation override — no `sudo xcode-select -s` needed.)

**Integration tier — pending.** 51 cases ready in TESTPLAN.md but blocked on building `tools/launcher/fixtures/{fake_ssh, fake_backend, fake_frontend}` (Python+bash). Slated for the next phase.

**E2E tier — pending.** 14 orchestrator-driven scenarios (E2E-T01..T14) covering cold-start, env switch, drop+recover, adoption, security. Will run after handover with real services up.

Full breakdown including the 95% confidence threshold visualisation: `local-assets/launcher/charts/test_results_summary.svg`.

---

## Key findings & decisions

1. **CommandLineTools doesn't ship XCTest** → `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per-invocation override (no global change). Recorded as a build-system gotcha.
2. **No Xcode → SwiftPM + hand-crafted `.app` bundle.** `package.sh` constructs `Contents/{MacOS,Info.plist,Resources,_CodeSignature}` and ad-hoc signs.
3. **Ad-hoc signing → spctl assess rejects** (expected for an internal dev tool). Recorded as IRI-T06 PASS — Gatekeeper "right-click Open" is the documented first-launch path.
4. **`@main` conflict with `main.swift`** → renamed entry file to `App.swift`; `@main struct LauncherApp: App` drives launch.
5. **Local funcs aren't `@Sendable`** → cross-actor closures wrapped explicitly.
6. **`String(cString:)` deprecated under strict concurrency** → switched to `String(decoding:as:UTF8.self)`.

## Dead ends explored (and discarded)

- **Swift Testing module** — unavailable on CommandLineTools and via `swift -e`. Reverted to XCTest.
- **Keychain-backed bridge token** — deferred to v0.2; v0.1 uses an in-memory ephemeral token rotated on every launch.
- **XCUITest UI driving** — CLT cannot drive UI bundles; covered by e2e tier through observable side-effects (marker file, log file, port state).
- **Global `xcode-select -s`** — unnecessary and would have required `sudo`. The `DEVELOPER_DIR` env-var override is per-invocation and reversible.

---

## Charts (all xmllint-clean, dashed 95% confidence threshold where applicable)

1. `startup_latency_p50_p95.svg` — p50/p95 startup time per component
2. `uptime_24h.svg` — uptime across the three services
3. `retries_stacked_area.svg` — retries by tag, stacked
4. `error_rate_per_tag.svg` — error rate per JSONL tag
5. `env_switch_frequency.svg` — env switch events per day (D/S/P)
6. `time_to_first_healthy.svg` — wall-clock time from launch to first `/healthz` 200
7. `test_results_summary.svg` — 28 PASS / 64 PENDING bar chart with 95% threshold

---

## Coexistence map

| Tool | Role | Conflict resolved by |
|---|---|---|
| `MMFF Vector Dev.app` (AppleScript) | Original one-shot bring-up | Launcher detects already-running services and adopts; no double-spawn |
| `<services>` | Read-only status | Both read the same `ACTIVE_BACKEND_ENV` marker and same `/healthz` shape |
| `<server> -d/-s/-p` | Backend env switch (CLI) | Both use the same atomic-write pattern under the same `flock` |
| `<npm>` | Ad-hoc Next.js on `:3000` | Launcher uses `:5101` — distinct port |

---

## What's NOT in v0.1 (recorded for v0.2)

- Keychain-backed bridge token (currently ephemeral in-memory).
- AppIcon from the Vector Design System (currently the SwiftUI default placeholder).
- Sparkle (or equivalent) update channel — distribution today is "checkout the repo".
- Full integration + e2e test runs (gated on `fake_ssh`/`fake_backend`/`fake_frontend` fixtures).
- Coverage report via `xcrun llvm-cov merge` (gated on integration tier).

---

## Next steps (when you want to resume)

1. Build the three fake fixtures (`tools/launcher/fixtures/{fake_ssh,fake_backend,fake_frontend}`) so the 51 integration cases run unattended.
2. Run the 14 e2e scenarios with real backend + tunnel up; record results in TESTPLAN.md §7.
3. Optional v0.2: keychain token, AppIcon, Sparkle.

The full canonical state of this work is in [`MASTER.md`](MASTER.md) and [`../../dev/research/R003.json`](../../dev/research/R003.json) — both are up-to-date as of handover.
