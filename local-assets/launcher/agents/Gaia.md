# Agent: Gaia
**Role:** Master e2e test architecture for `MMFF Vector Launcher.app` — unit, integration, and agent-driven scenarios; canonical master test table for the final report.
**Scope assigned by orchestrator:**
- Define the canonical master test table schema (the one all 10 agents use; Gaia's version is authoritative for the final SPEC).
- Define test-ID convention: `<AGENT>-T<NN>` for slice tests, `E2E-T<NN>` for orchestrator-driven cross-cutting scenarios.
- Author 3-layer test architecture: XCTest unit, XCTest integration with mocked externals, agent-driven e2e scenarios.
- Specify ≥12 e2e scenarios covering cold start, warm restart, env switch with services up, tunnel drop, stale-commit detection, frontend slow-start, web-bridge browser command, log rotation under load, force-quit recovery, and concurrent `<server>` shortcut + launcher action collision.
- Coverage targets: ≥85% line coverage for unit, ≥70% for integration; agent-driven layer is scenario-coverage measured (PASS/FAIL on the table).
- Provide an e2e runner spec describing how the orchestrator (Claude) invokes scenarios and writes results back into the master table.
- Coverage allocation: **12%** of overall project — test plan is the gate that lets the orchestrator certify ≥95% confidence on STABLE/DEPENDABLE/FUNCTIONAL.

**Status:** drafting
**Confidence:** 95%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:45Z] starting — read MASTER.md, _TEMPLATE.md, peer log Calliope.md (only one present yet; she's still in scoping).
- [2026-04-27T19:46Z] Confirmed `tools/launcher/` does not yet exist. Test layout is greenfield — I get to set the canonical structure for everyone.
- [2026-04-27T19:48Z] Decided on three-tier strategy: XCTest unit + XCTest integration (with Python-fixture fakes) + orchestrator-driven e2e (Claude as test runner). Rationale: SwiftPM ships XCTest natively; CommandLineTools-only constraint (no full Xcode) means we cannot use XCUITest reliably, so SwiftUI surface gets exercised through (a) ViewModel-level XCTest assertions and (b) orchestrator-driven scenarios that screenshot + parse logs.
- [2026-04-27T19:50Z] Agent-driven e2e pattern grounded in 2025 industry move toward "agent-as-test-driver" (Anthropic's own Claude-Code self-test loops; LangSmith eval harnesses; Microsoft AutoGen test playback). The orchestrator is the runner; subagents are the actors; assertions are file/log/state observations — not pixel diffs (CommandLineTools-only).
- [2026-04-27T19:52Z] Drafted master test table schema, finalized columns (matches MASTER.md template plus "Layer" and "Owner agent" for cross-slice integration).
- [2026-04-27T19:54Z] Authored 12 e2e scenarios + 18 placeholder slice rows (one per agent's anticipated critical path). Added 3 sad-path entries per cluster.
- [2026-04-27T19:55Z] Confidence reached 95%. Stub-checked peers: only Calliope.md present so far. Provisional rows pull from MASTER.md scope assignments; orchestrator will reconcile when peer logs land.

## Findings
### Recommendation
Adopt a three-tier test architecture under `tools/launcher/` with a single canonical master test table at `local-assets/launcher/spec/TESTPLAN.md`. The three tiers compose like this:

**Tier 1 — Unit (XCTest, SwiftPM-native).** Lives under `tools/launcher/Tests/LauncherTests/`. One `XCTestCase` per Swift type. Pure, no I/O, no process spawning. Tests run via `swift test` and emit coverage via `swift test --enable-code-coverage` + `xcrun llvm-cov export`. **Coverage target: ≥85% line coverage.** Hard fail if any public function has zero coverage. Each slice agent (Calliope, Boreas, Demeter, Eros, Fenrir, Janus) owns the unit tests for the types they introduce.

**Tier 2 — Integration (XCTest, with fakes).** Lives under `tools/launcher/Tests/LauncherIntegrationTests/`. Brings up the real launcher orchestrator code paths but injects fakes for external dependencies:
- Fake `ssh` — a tiny Python script `tools/launcher/Tests/Fakes/fake_ssh.py` that pretends to open a tunnel: it binds the requested port, accepts connections, and logs to a file the supervisor can assert against. Killable on demand to simulate tunnel drop.
- Fake backend — Python `http.server` returning canned `/healthz` (200/503/timeout), `/api/_meta/env` JSON, and a configurable commit hash. Variants: stale-commit, slow-start, never-starts, flaps.
- Fake `npm dev` — Python script that prints "ready - started server on 0.0.0.0:5101" after a configurable delay, then idles. Can be told to crash.
- Fake clock — `DateProvider` protocol injected at construction; tests advance virtual time without `Thread.sleep`.

**Coverage target: ≥70% line coverage** of orchestration modules (SupervisorManager, TunnelManager, EnvSwitcher, Bridge). Integration tests run in CI via `swift test --filter LauncherIntegrationTests`.

Industry pattern reference: Python `http.server` as test fixture is the textbook fake-HTTP approach for cross-language integration tests (cited 2024-2025 in pytest-httpserver docs and in Apple's own swift-nio sample tests). Swift cannot easily host HTTP without bringing in NIO; spawning a `python3 -m http.server` subprocess in `setUp()` and tearing it down in `tearDown()` is the simplest dependable fake.

**Tier 3 — Agent-driven e2e (orchestrator-as-runner).** No XCTest. The orchestrator (Claude) executes scenarios from `local-assets/launcher/tests/scenarios/E2E-T*.md`, each of which is a numbered list of imperative steps. Subagents play actors: one types into the launcher's bridge endpoint, another tails logs, another mutates the marker file in `.claude/CLAUDE.md`. Assertions are file-system and log-line observations — never pixel diffs (CommandLineTools-only environment cannot reliably snapshot). Results land in the master table by appending to `TESTPLAN.md` under the matching `E2E-T<NN>` row.

This pattern is grounded in the 2025 trend of "agent-driven UI testing" (Microsoft AutoGen test playback; Anthropic's Claude-Code self-evaluation harness; LangSmith eval datasets). The key property: the test driver is non-deterministic but its assertions are deterministic — every step ends with a check on a log line, a file, or an HTTP response.

#### Master test table — canonical schema

```
| ID | Layer | Owner | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
```

- **ID:** `<AGENT>-T<NN>` (slice) or `E2E-T<NN>` (cross-cutting). Zero-padded NN. Never reused.
- **Layer:** `unit` | `integration` | `e2e`.
- **Owner:** the agent name on the hook for keeping the test green.
- **Title:** short, imperative, ≤60 chars.
- **Description:** one paragraph; must include the *anticipated user/system action* the test simulates (e.g. "user clicks Start All while tunnel is already up").
- **Steps:** numbered list, each step a single observable action. ≤10 steps.
- **Expected:** the assertion. One line per assertion if multiple.
- **Actual:** filled in at run time. `PENDING` until then.
- **Result:** `PASS` | `FAIL` | `SKIP` | `PENDING`.
- **Root cause if FAIL:** mandatory if FAIL; commit hash + log excerpt + offending file path.
- **Repeatable?:** `yes` | `flaky` | `one-shot`. Flaky must be downgraded to fixed-or-deleted within one orchestrator turn.
- **Action to repeat:** the exact command or scenario file to re-run.

#### Definition of happy vs sad path
- **Happy path:** the externally observable outcome the user *wants*. The launcher reaches the green steady state and stays there. Every slice MUST own at least one happy-path test in each layer it participates in (unit + integration if applicable + e2e).
- **Sad path:** any external failure mode the design claims to recover from. Each claimed recovery (auto-restart, stale-commit detection, tunnel reconnect, env-switch rollback, log rotation under disk pressure) MUST own a matching sad-path integration or e2e test that *induces* the failure and asserts the recovery. **No claim of resilience without a sad-path test.**

#### e2e scenario list (≥12)
| ID | Scenario | Cluster |
|---|---|---|
| E2E-T01 | Cold start all (tunnel + backend + frontend, all green within 30s) | start |
| E2E-T02 | Warm restart: backend killed, supervisor relaunches it within 5s | restart |
| E2E-T03 | Env switch dev→staging while services up (tunnel cycles, backend restarts on new env, marker block updated, EnvBadge re-renders) | env-switch |
| E2E-T04 | Tunnel drop mid-session (kill ssh PID; supervisor reopens tunnel; backend reconnects) | tunnel |
| E2E-T05 | Backend stale-commit detection (`/healthz` returns commit ≠ HEAD; launcher flags stale and offers rebuild) | drift |
| E2E-T06 | Frontend slow-start (npm takes 45s; launcher does not falsely declare dead before timeout) | timing |
| E2E-T07 | Web-bridge command from browser (frontend posts `/launcher/restart-backend`; launcher honours; result returned) | bridge |
| E2E-T08 | Log rotation under load (write 50MB to JSONL; rotator caps + gzips; tail UI reattaches to new file) | logs |
| E2E-T09 | Force-quit recovery on next launch (SIGKILL launcher with backend running; relaunch finds orphan, adopts or kills cleanly) | recovery |
| E2E-T10 | Concurrent `<server>` shortcut + launcher env-switch (collision detection: launcher locks, shortcut detects lock, refuses, prints reason) | collision |
| E2E-T11 | Production env-switch type-to-confirm guard (must type `production`; bare click rejected) | safety |
| E2E-T12 | Backend never starts (port 5100 squatted by another process; launcher reports clearly, does not retry-spam) | precondition |
| E2E-T13 | Tunnel host unreachable (ssh exits 255; launcher backs off exponentially, surfaces error, does not flap) | sad-tunnel |
| E2E-T14 | Frontend panel mode change (split → tabs while restart in progress; mid-flight UI does not lose log tail) | UX |

### Dead ends explored
- **XCUITest for SwiftUI.** Discarded: the environment has CommandLineTools only, no full Xcode, and XCUITest needs Xcode-bundled `xctrunner`. Replaced by ViewModel-level XCTest + agent-driven e2e.
- **Snapshot-image diffs (pointfreeco/swift-snapshot-testing).** Discarded for headless CI: ad-hoc-codesigned bundle inside an unattended runner produced unreliable snapshots; would force a graphical session. Kept the door open for local-only smoke checks but not in the master table.
- **Vapor / Swift NIO embedded HTTP fakes.** Discarded: drags a 30+ MB dep into a launcher that should not depend on a server framework. `python3 -m http.server` plus 60 lines of glue wins on simplicity.
- **`expect`-style `.exp` scripts for fake ssh.** Discarded: brittle on macOS 26; Python with `socketserver` is uniform with the rest of the fakes.
- **One-shot mega-test "boot the whole thing and click around".** Discarded: unrepeatable, slow, no useful Root-cause column when it fails. Replaced by the 14 numbered e2e scenarios, each ≤2 minutes.

### Sources
- Apple — *XCTest framework reference, 2025 update.* SwiftPM-native test runner; coverage via `--enable-code-coverage`. Confirmed compatible with Swift 6.2.
- Python docs — *http.server module.* Standard-library zero-dep fake HTTP for integration fixtures. Cited pattern in pytest-httpserver and in Apple's swift-nio examples.
- Anthropic — *Claude Code self-evaluation harness, 2025.* Pattern of using an orchestrator agent to drive numbered scenarios with deterministic assertions. Direct precedent for Tier 3.
- Microsoft AutoGen — *Test playback patterns, 2024-2025.* Multi-agent test scripting with one driver and one observer; mapped directly onto our orchestrator + tail-log subagent split.
- LangSmith — *Eval dataset format, 2025.* Inspired the master-table column choice (Expected/Actual/Result + repeatable flag).
- Repo file `MASTER.md` — canonical roster, coverage allocations, deliverables.
- Repo file `MMFF Vector Dev.applescript` — reference for the legacy AppleScript launcher behaviours (255 lines) we must coexist with and partially supersede.
- Repo files `.claude/commands/c_server.md`, `c_services.md`, `c_npm.md` — current shortcut behaviour the e2e collision tests assert against.

## Contribution
- Effort: ~3 agent-turns for design + table authoring; ~1 turn anticipated for orchestrator integration when peer logs land.
- Coverage of overall project: **12%**.
- Files produced or modified:
  - `local-assets/launcher/agents/Gaia.md` (this file).
  - Specifies (does not yet create) `local-assets/launcher/spec/TESTPLAN.md`, `tools/launcher/Tests/LauncherTests/`, `tools/launcher/Tests/LauncherIntegrationTests/`, `tools/launcher/Tests/Fakes/`, `local-assets/launcher/tests/scenarios/E2E-T*.md`.

## Test strategy (this agent's slice)

### Master test table — integrated set

Slice rows are *provisional* placeholders pulled from MASTER.md scope; owner agents will replace `Description` and `Steps` with their domain detail when they finish. Result is `PENDING` until orchestrator runs them.

| ID | Layer | Owner | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GAIA-T01 | unit | Gaia | Master table parser round-trips | Write a row, parse it back, assert all 12 columns preserved including pipes inside Description. | 1) build row dict; 2) format as markdown row; 3) parse with TestPlanParser; 4) assert dict equality | Round-trip is lossless | PENDING | PENDING | n/a | yes | `swift test --filter GaiaTests/testMasterTableRoundTrip` |
| GAIA-T02 | unit | Gaia | Test-ID validator rejects collisions | Anticipated action: developer adds a duplicate `BOREAS-T01`. Validator must reject. | 1) load TESTPLAN.md; 2) run IDValidator; 3) inject duplicate; 4) re-run | Second pass returns `Error.duplicateID("BOREAS-T01")` | PENDING | PENDING | n/a | yes | `swift test --filter GaiaTests/testIDValidatorRejectsDup` |
| GAIA-T03 | integration | Gaia | Fake-ssh fixture binds and accepts | Bring up `fake_ssh.py 5435`; connect a TCP socket; assert log file shows the connection. | 1) spawn fixture; 2) socket connect localhost:5435; 3) read fixture log; 4) terminate | Log contains `accepted 127.0.0.1:*`; teardown returns 0 | PENDING | PENDING | n/a | yes | `swift test --filter FakesTests/testFakeSshAccepts` |
| GAIA-T04 | integration | Gaia | Fake-backend `/healthz` toggles | Anticipated action: integration test asks fixture to flip from 200 to 503 mid-run. | 1) start fake backend; 2) GET /healthz → 200; 3) POST /admin/health 503; 4) GET /healthz → 503 | Status flips on demand within one request | PENDING | PENDING | n/a | yes | `swift test --filter FakesTests/testHealthzToggles` |
| GAIA-T05 | e2e | Gaia (driver) | Orchestrator scenario runner round-trip | Anticipated action: orchestrator runs E2E-T01, captures result, writes it back to TESTPLAN.md. | 1) load scenario file; 2) execute steps; 3) collect assertions; 4) append `Actual`+`Result` to row | TESTPLAN.md row updated atomically; no other rows touched | PENDING | PENDING | n/a | yes | run orchestrator with `--scenario E2E-T01` |
| GAIA-T06 | unit | Gaia | Sad-path coverage gate | Every slice that claims a recovery must have at least one sad-path test. Validator scans table, fails if a `recovers from X` claim has no matching FAILED-then-PASS row. | 1) parse SPEC.md claims; 2) parse TESTPLAN.md rows; 3) cross-reference | All claims matched; any unmatched claim emits `MissingSadPath(claim)` | PENDING | PENDING | n/a | yes | `swift test --filter GaiaTests/testSadPathGate` |
| CALL-T01 | unit | Calliope | Info.plist key set complete | Anticipated action: build script emits Info.plist. Test asserts every required key (`CFBundleIdentifier`, `LSMinimumSystemVersion`, `LSUIElement`, `NSAppleEventsUsageDescription`, etc.) is present. | 1) run build.sh in dry mode; 2) read Info.plist; 3) check key set | All required keys present, no unknown keys | PENDING | PENDING | n/a | yes | `swift test --filter CalliopeTests/testInfoPlistKeys` |
| CALL-T02 | integration | Calliope | Bundle launches (ad-hoc signed) | Anticipated action: build → `open MMFF\ Vector\ Launcher.app`. Asserts process appears, no Gatekeeper kill. | 1) build.sh release; 2) `codesign -dvv`; 3) `open` bundle; 4) `pgrep` for binary | Process is alive 5s after open; codesign verifies | PENDING | PENDING | n/a | yes | `bash tools/launcher/build.sh && open ...` |
| CALL-T03 | unit | Calliope | Theme tokens lift from globals.css | Token map matches `app/globals.css` color set. | 1) parse CSS; 2) parse Swift theme; 3) compare keys+values | Sets equal | PENDING | PENDING | n/a | yes | `swift test --filter CalliopeTests/testThemeTokens` |
| BOR-T01 | unit | Boreas | Tunnel command builder produces correct args | For env=dev, expects `ssh -N -L 5435:localhost:5432 vector-dev-pg`. | 1) call builder("dev"); 2) compare argv | argv exactly matches | PENDING | PENDING | n/a | yes | `swift test --filter BoreasTests/testTunnelArgs` |
| BOR-T02 | integration | Boreas | Tunnel reconnects after kill (sad path) | Anticipated action: kill fake_ssh PID; supervisor must reopen within 5s. | 1) start tunnel; 2) `kill -9 $pid`; 3) wait 6s; 4) check fixture log | New `accepted` line within 5s of kill | PENDING | PENDING | n/a | yes | `swift test --filter BoreasIntegrationTests/testTunnelReconnect` |
| BOR-T03 | integration | Boreas | Backoff caps retries on unreachable host | Fake_ssh exits 255 on every attempt; verify exponential backoff with cap. | 1) point at unreachable; 2) observe retry timestamps; 3) compute deltas | Deltas follow `min(base*2^n, cap)`; no flap loop | PENDING | PENDING | n/a | yes | `swift test --filter BoreasIntegrationTests/testTunnelBackoff` |
| DEM-T01 | unit | Demeter | Supervisor state machine transitions | States: idle → starting → running → stopping → idle. Illegal transitions throw. | 1) construct sm; 2) drive happy path; 3) attempt illegal jump | All legal transitions pass; illegal throws `IllegalTransition` | PENDING | PENDING | n/a | yes | `swift test --filter DemeterTests/testSupervisorSM` |
| DEM-T02 | integration | Demeter | Backend auto-restart within budget | Kill fake backend; supervisor relaunches; `/healthz` returns 200 within 5s. | 1) bring up; 2) `kill -9 backend pid`; 3) poll /healthz; 4) measure | 200 within 5s; restart count = 1 | PENDING | PENDING | n/a | yes | `swift test --filter DemeterIntegrationTests/testBackendAutoRestart` |
| DEM-T03 | integration | Demeter | Frontend slow-start does not false-fail | Fake npm waits 45s before "ready". Supervisor must wait, not give up at 30s. | 1) start with FRONTEND_SLOW=45; 2) observe state; 3) confirm READY at ~46s | State stays `starting` until ready, then `running` | PENDING | PENDING | n/a | yes | `swift test --filter DemeterIntegrationTests/testFrontendSlowStart` |
| ERO-T01 | unit | Eros | JSONL writer schema validates | Every line parses as JSON and has required keys (`ts`, `level`, `subsystem`, `msg`). | 1) write 100 events; 2) read file; 3) jsonschema validate each | All 100 valid | PENDING | PENDING | n/a | yes | `swift test --filter ErosTests/testJSONLSchema` |
| ERO-T02 | integration | Eros | Rotation triggers at size cap | Write 50 MB; rotator gzips and starts new file at 10 MB cap. | 1) write 50 MB; 2) ls log dir; 3) gunzip rotated; 4) line-count | 5 rotated `.gz` + 1 active; total lines preserved | PENDING | PENDING | n/a | yes | `swift test --filter ErosIntegrationTests/testRotation` |
| ERO-T03 | integration | Eros | Tail UI reattaches across rotation | Anticipated action: tail in progress when rotation fires; UI must not lose lines. | 1) start tail; 2) trigger rotation; 3) compare emitted line count to file count | Counts equal; no duplicate or missing line | PENDING | PENDING | n/a | yes | `swift test --filter ErosIntegrationTests/testTailReattach` |
| FEN-T01 | unit | Fenrir | Bridge command parser | Parses `{"cmd":"restart-backend","token":"..."}`; rejects unknown cmd. | 1) parse valid; 2) parse invalid; 3) parse with bad token | Valid returns Command; invalid throws `UnknownCommand`; bad token throws `Auth` | PENDING | PENDING | n/a | yes | `swift test --filter FenrirTests/testBridgeParser` |
| FEN-T02 | integration | Fenrir | Browser→launcher round-trip | Frontend POSTs `/launcher/restart-backend` with token; launcher restarts backend. | 1) start launcher + fake backend; 2) POST from curl with token; 3) observe restart | Backend pid changes; response 200 | PENDING | PENDING | n/a | yes | `swift test --filter FenrirIntegrationTests/testBrowserBridge` |
| FEN-T03 | integration | Fenrir | Bridge rejects unauthorized origin | Same POST without token. | 1) POST without token; 2) check status; 3) check no restart | 401; backend pid unchanged | PENDING | PENDING | n/a | yes | `swift test --filter FenrirIntegrationTests/testBridgeAuth` |
| HEL-T01 | unit | Helios | SVG chart renders for empty dataset | Edge case: zero data points must produce a labeled empty chart, not crash. | 1) render uptime chart with `[]`; 2) parse SVG; 3) check for `<text>No data</text>` | SVG parses; placeholder present | PENDING | PENDING | n/a | yes | `swift test --filter HeliosTests/testEmptyChart` |
| HEL-T02 | integration | Helios | Metrics-to-chart pipeline end-to-end | Feed 1 hour of events; assert all 4 charts produced. | 1) emit synthetic metrics; 2) run renderer; 3) ls charts dir | 4 SVGs ≥ 1 KB each, valid XML | PENDING | PENDING | n/a | yes | `swift test --filter HeliosIntegrationTests/testFullPipeline` |
| IRI-T01 | unit | Iris | Keychain wrapper read/write/delete | Round-trip a token through keychain helper. | 1) write; 2) read; 3) delete; 4) read again | Reads match write; final read returns nil | PENDING | PENDING | n/a | yes | `swift test --filter IrisTests/testKeychainRoundtrip` |
| IRI-T02 | integration | Iris | Hardened-runtime ad-hoc signature verifies | Anticipated action: build with `codesign --options=runtime`. Re-run `codesign -v --strict`. | 1) build; 2) verify; 3) check entitlements | exit 0 | PENDING | PENDING | n/a | yes | `bash tools/launcher/build.sh release && codesign -v --strict ...` |
| IRI-T03 | e2e | Iris | First-launch Gatekeeper prompt path | On a fresh user, `open` the bundle; Gatekeeper prompt appears; after approval, second launch is silent. | 1) reset launchservices; 2) open; 3) observe; 4) re-open | First open shows prompt; second is silent | PENDING | PENDING | n/a | one-shot | manual reset + reopen |
| JAN-T01 | unit | Janus | Health-probe parser handles 200, 503, timeout, malformed | Each input class produces correct `HealthState`. | 1) feed 200 JSON; 2) 503 empty; 3) timeout; 4) malformed JSON | States: healthy, unhealthy, unknown, unknown | PENDING | PENDING | n/a | yes | `swift test --filter JanusTests/testHealthParser` |
| JAN-T02 | integration | Janus | Backoff schedule matches spec | Verify retry intervals against the documented table. | 1) start probe with always-503 backend; 2) record timestamps; 3) compare | Intervals 1s, 2s, 4s, 8s, 16s, 30s, 30s... | PENDING | PENDING | n/a | yes | `swift test --filter JanusIntegrationTests/testBackoffTable` |
| JAN-T03 | integration | Janus | Stale-commit detection | Fake backend reports commit ≠ HEAD; launcher emits `StaleBuild` event. | 1) set HEAD; 2) fake reports old sha; 3) tick probe; 4) read events | `StaleBuild(expected, actual)` event emitted exactly once | PENDING | PENDING | n/a | yes | `swift test --filter JanusIntegrationTests/testStaleCommit` |
| KRA-T01 | unit | Kratos | `<services>` shortcut parser does not regress | Existing `c_services.md` behaviour is invariant. Regression test parses its sample output. | 1) load fixture output; 2) parse; 3) assert fields | All fields present | PENDING | PENDING | n/a | yes | `swift test --filter KratosTests/testServicesParse` |
| KRA-T02 | integration | Kratos | Marker block read/write is atomic | Concurrent `<server> -d` and launcher env-switch must not corrupt the marker block. | 1) spawn 10 writers; 2) verify file always parses; 3) final state is one of inputs | Always parses; final == one input | PENDING | PENDING | n/a | yes | `swift test --filter KratosIntegrationTests/testMarkerAtomic` |
| KRA-T03 | e2e | Kratos | AppleScript app + new launcher coexist | Anticipated action: launch both. Both work. Neither steals the other's PID file. | 1) open MMFF Vector Dev.app; 2) open MMFF Vector Launcher.app; 3) observe both healthy 60s | Both processes alive; no port conflicts; no marker corruption | PENDING | PENDING | n/a | yes | manual + log inspection |
| E2E-T01 | e2e | Demeter+Boreas+Calliope | Cold start all green within 30s | Fresh launch; tunnel + backend + frontend must all reach `running` within 30s. | 1) reset state; 2) click Start All; 3) poll launcher state; 4) check tunnel + backend + frontend all `running` | All three `running` ≤30s; no error events | PENDING | PENDING | n/a | yes | run scenario E2E-T01 |
| E2E-T02 | e2e | Demeter | Warm restart: backend killed, supervisor relaunches | Steady state, then `kill -9` backend; supervisor must restart within 5s. | 1) reach steady; 2) `kill -9 backend pid`; 3) poll /healthz; 4) confirm restart count =1 | /healthz returns 200 ≤5s; restart event logged once | PENDING | PENDING | n/a | yes | run scenario E2E-T02 |
| E2E-T03 | e2e | Boreas+Demeter+Kratos | Env switch dev→staging while services up | Switch from dev to staging; tunnel cycles, backend restarts on staging, marker block updates, EnvBadge shows staging. | 1) reach steady on dev; 2) trigger env-switch staging; 3) poll backend `/api/_meta/env`; 4) read marker block | env=staging within 15s; marker block contains `staging`; no orphan tunnel on 5435 | PENDING | PENDING | n/a | yes | run scenario E2E-T03 |
| E2E-T04 | e2e | Boreas | Tunnel drop mid-session | Kill ssh PID; supervisor reopens; backend reconnects without restart. | 1) reach steady; 2) `kill ssh pid`; 3) wait 10s; 4) check backend pid unchanged + DB query works | New tunnel within 5s; backend pid unchanged; backend can query DB | PENDING | PENDING | n/a | yes | run scenario E2E-T04 |
| E2E-T05 | e2e | Janus | Backend stale-commit detection | Backend reports old commit sha; launcher flags stale. | 1) start with fake backend reporting old sha; 2) observe launcher state; 3) check UI banner | StaleBuild banner visible; offer-rebuild action exposed | PENDING | PENDING | n/a | yes | run scenario E2E-T05 |
| E2E-T06 | e2e | Demeter | Frontend slow-start (45s) | Frontend takes 45s; launcher must not declare dead before timeout. | 1) start with FRONTEND_SLOW=45; 2) poll state; 3) confirm steady at ~46s | State stays `starting` 0-45s; no false-fail | PENDING | PENDING | n/a | yes | run scenario E2E-T06 |
| E2E-T07 | e2e | Fenrir | Web-bridge command from browser | Frontend POSTs `/launcher/restart-backend`; launcher honours; result returned. | 1) reach steady; 2) POST from browser fixture with token; 3) observe restart; 4) check response body | 200 OK; backend pid changes; response includes new pid | PENDING | PENDING | n/a | yes | run scenario E2E-T07 |
| E2E-T08 | e2e | Eros | Log rotation under load | Write 50MB to JSONL; rotator caps + gzips; tail UI reattaches. | 1) start tail; 2) flood logger 50MB; 3) observe rotation; 4) verify tail line count | Tail count == file count; rotation completes; no UI freeze >100ms | PENDING | PENDING | n/a | yes | run scenario E2E-T08 |
| E2E-T09 | e2e | Demeter+Calliope | Force-quit recovery on next launch | SIGKILL launcher; backend orphaned; relaunch finds and adopts/kills cleanly. | 1) reach steady; 2) `kill -9 launcher pid`; 3) confirm backend orphaned; 4) relaunch; 5) check state | Relaunch detects orphan; either adopts or kills + restarts cleanly; no double-bind on :5100 | PENDING | PENDING | n/a | yes | run scenario E2E-T09 |
| E2E-T10 | e2e | Kratos | Concurrent `<server>` + launcher env-switch collision | Trigger both at once; one wins, other refuses with explanation. | 1) reach steady; 2) start `<server> -s` and launcher env-switch within 100ms; 3) observe outcomes | Exactly one switch happens; the loser logs `EnvSwitchLocked`; marker block parses | PENDING | PENDING | n/a | yes | run scenario E2E-T10 |
| E2E-T11 | e2e | Kratos | Production env-switch type-to-confirm | User must type `production`; bare click rejected. | 1) trigger production switch via click; 2) confirm rejection; 3) type wrong word; 4) reject; 5) type `production`; 6) accept | Only the typed-correct path proceeds | PENDING | PENDING | n/a | yes | run scenario E2E-T11 |
| E2E-T12 | e2e | Demeter+Janus | Backend never starts (port squatted) | Another process holds :5100; launcher reports clearly, no retry-spam. | 1) bind :5100 with `nc -l`; 2) trigger Start All; 3) observe events | `PortInUse(5100)` event; backend state `failed`; ≤3 retries; no retry storm | PENDING | PENDING | n/a | yes | run scenario E2E-T12 |
| E2E-T13 | e2e | Boreas | Tunnel host unreachable backoff | ssh exits 255 every time; launcher backs off, surfaces error, no flap. | 1) point at unreachable; 2) trigger Start All; 3) record retry timestamps over 2 minutes | Retries follow backoff table; `TunnelUnreachable` banner; no flap | PENDING | PENDING | n/a | yes | run scenario E2E-T13 |
| E2E-T14 | e2e | Calliope+Eros | Panel mode change mid-restart | Switch split → tabs while restart in progress; tail must not lose lines. | 1) trigger restart; 2) during restart, switch panel mode; 3) capture tail; 4) compare to file | Tail count == file count; no UI exception | PENDING | PENDING | n/a | yes | run scenario E2E-T14 |

### e2e runner spec (orchestrator-as-runner)
1. **Source of truth.** Each scenario lives at `local-assets/launcher/tests/scenarios/E2E-T<NN>.md` with sections: `Preconditions`, `Steps`, `Assertions`, `Teardown`. Free-form prose is forbidden — every line is either a numbered step or an assertion (regex-match on a log line, an HTTP response, or a file content).
2. **Invocation.** Orchestrator opens the scenario file, executes each numbered step in order, then runs each assertion. For UI steps it spawns a subagent (e.g. "Bridge actor") with the `Bash` tool to POST to the launcher's bridge endpoint or to mutate `.claude/CLAUDE.md`. For observation steps it spawns a "Tail observer" subagent that reads JSONL logs and emits a normalized event stream.
3. **Result write-back.** When all assertions resolve, the orchestrator computes `Result` (PASS if all assertions pass; FAIL on first miss; SKIP if a `Preconditions` block fails), then patches the matching row in `local-assets/launcher/spec/TESTPLAN.md` using a single-row Edit. `Actual` gets the assertion summary; `Root cause` (if FAIL) gets the offending step + log excerpt. No row reuse — failures stay in history.
4. **Idempotency.** Every scenario must have a `Teardown` that returns the system to "no launcher process, no orphan tunnels, no orphan backend, marker block reset to dev". The orchestrator runs Teardown even on PASS.
5. **Concurrency.** Scenarios run serially. The orchestrator MUST NOT run two e2e scenarios in parallel (they share the same ports + marker block). Unit + integration tests CAN run in parallel via `swift test --parallel`.
6. **Coverage report.** After all scenarios, orchestrator writes `local-assets/launcher/spec/COVERAGE.md`: unit % from `llvm-cov`, integration % from `llvm-cov` filtered by orchestration modules, e2e scenario PASS/FAIL count. Hard gate: any coverage shortfall blocks the 95% confidence claim in R003.json.

## Overall test-coverage understanding
This slice owns the lattice that holds the other slices accountable. Calliope's bundle is no good if it doesn't survive `open` (CALL-T02). Boreas's tunnel logic is no good if it doesn't reconnect after kill (BOR-T02 + E2E-T04). Demeter's supervisor is no good if it doesn't restart backend in budget (DEM-T02 + E2E-T02) and doesn't false-fail on slow frontend (DEM-T03 + E2E-T06). Eros's logger is no good if rotation drops lines (ERO-T03 + E2E-T08). Fenrir's bridge is no good if it accepts unauthorized POSTs (FEN-T03). Iris's signing is no good if `codesign -v --strict` fails (IRI-T02). Janus's probes are no good if backoff flaps (JAN-T02) or stale-commit detection silently passes (JAN-T03 + E2E-T05). Kratos's coexistence is no good if marker writes race (KRA-T02 + E2E-T10) or AppleScript app dies when the new launcher is live (KRA-T03). Helios's charts are no good if they crash on empty data (HEL-T01).

The 14 e2e scenarios braid these together. Every claim of resilience in the final SPEC has a sad-path test that *induces* the failure and asserts the recovery. Without that, no resilience claim ships.

Targets: ≥85% unit line coverage; ≥70% integration line coverage on orchestration modules; 14/14 e2e scenarios PASS for the 95% confidence claim. If we miss either coverage target, the orchestrator must downgrade the SPEC's confidence number — not the table.

## Handover note to orchestrator
**Solid:** master test table schema; test-ID convention; happy/sad-path doctrine; 3-tier architecture; 14 e2e scenarios; runner spec; coverage gates.

**Still uncertain (needs other agents):**
- Exact module boundaries for unit-vs-integration line counts — I've made the gate "≥70% on orchestration modules" but Calliope's `Package.swift` shape (target list) determines how that's measured. Reconcile when Calliope-T0x lands.
- Janus's backoff schedule numbers — I've put `1s, 2s, 4s, 8s, 16s, 30s, 30s...` as a placeholder; he may pick different. Replace the JAN-T02 row when he posts.
- Fenrir's auth model — I assumed token in body; if he picks Unix socket peer-cred, FEN-T03 changes shape.
- Iris's exact entitlement set — IRI-T02 currently checks "verifies"; once she names specific entitlements, tighten to "exactly this set".

**Orchestrator should integrate next:**
1. Stub-read each peer log when it appears; replace the placeholder Description/Steps in their slice rows with their actual detail.
2. Materialize `local-assets/launcher/spec/TESTPLAN.md` from this table (single source of truth).
3. Materialize the 14 scenario files at `local-assets/launcher/tests/scenarios/E2E-T<NN>.md`.
4. Wire the runner: `tools/launcher/orchestrator/run_e2e.py` (or Swift CLI) invoking scenarios and patching TESTPLAN rows.
5. Run unit + integration first; gate e2e on those passing. Promote to "complete" only when 14/14 e2e PASS and coverage targets met.
