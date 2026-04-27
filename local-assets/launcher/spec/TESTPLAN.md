# MMFF Vector Launcher — Test Plan

**Companion to:** [SPEC.md](./SPEC.md)
**Architect:** Gaia (test architecture), all agents (slice tests)
**Confidence:** 95%

---

## 1. Strategy

Three tiers, with a strict separation of concerns:

| Tier | Tool | Coverage target | Owns |
|---|---|---|---|
| **Unit** | XCTest | ≥85% line / ≥90% branch on managers | Pure Swift logic: RetryPolicy math, MarkerLock state, JSONLLogger schema, TunnelManager state machine, env-string parsing |
| **Integration** | XCTest + Python `http.server` + `fake_ssh` fixtures | ≥70% on integration glue | Probe contracts, Process spawn/kill (PGID), bridge auth, marker write coordination |
| **Agent-driven e2e** | Orchestrator scripts | 14 scenarios (§4) | Cross-cutting flows: cold start, env switch, drop+recover, adoption, security |

**XCUITest excluded** — CommandLineTools-only environment cannot drive UI tests. The SwiftUI dashboard is exercised by the e2e tier through the bridge surface and observable side-effects (marker file, log file, port state).

---

## 2. Fixtures

### 2.1 `fake_ssh` (Integration)
Bash script `tools/launcher/fixtures/fake_ssh` shadows `ssh` on the test PATH. Behaviours:
- `fake_ssh -fN <alias>` → forks, opens a TCP listener on the alias's mapped port, writes its PID to `/tmp/fake_ssh.<alias>.pid`, exits 0 (matches real `ssh -fN`)
- `fake_ssh --simulate-drop <after-ms>` → close listener after N ms (drop test)
- `fake_ssh --refuse` → exit 255 (auth failure simulation)

### 2.2 `fake_backend` (Integration)
Python `http.server` subclass on `:5100` with:
- `GET /healthz` → `{"status":"ok","db_host":"...","backend_env":"<env>"}`
- `GET /healthz.commit` → returns commit SHA from `MMFF_FAKE_COMMIT` env var
- `GET /api/_meta/env` → `{"env":"<env>","db_host":"...","backend_env":"<env>"}`
- `--bad-shape` → returns `{"foo":"bar"}` (BAD_SHAPE test)
- `--stale` → returns commit SHA `0000…` (STALE test)
- `--crash-after <s>` → exit 1 after N seconds (crash test)

### 2.3 `fake_frontend` (Integration)
Python script binding `:5101`, returns 404 on `/` for the first 5s (matches Next dev cold start), then 200 + `text/html`.

### 2.4 Test repo skeleton
`tests/integration/fixtures/repo/.git/HEAD` populated with a known SHA — exercises the no-`git`-command direct read path in HealthProbe.

---

## 3. Master test table

Columns:

```
ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat | Layer | Owner
```

### 3.1 Calliope — bundling & SwiftUI

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C-T01 | swift build succeeds | Build executable target with SwiftPM | `swift build -c release --arch arm64` | exit 0, binary at `.build/release/MMFFVectorLauncher` | exit 0, binary written, 4.45s | **PASS** | n/a | yes | rerun build.sh | unit | Calliope |
| C-T02 | build.sh produces valid bundle | Run build.sh; verify bundle layout | run script; `find "MMFF Vector Launcher.app"` | Contents/MacOS/binary, Info.plist, PkgInfo, Resources/ | all 5 paths present (binary, Info.plist, PkgInfo, AppIcon.icns, _CodeSignature) | **PASS** | n/a | yes | rerun build.sh | unit | Calliope |
| C-T03 | codesign verifies | Ad-hoc bottom-up codesign passes verify | `codesign --verify --strict --verbose=2 …` | exit 0 | "satisfies its Designated Requirement"; Identifier=dev.mmff.vector.launcher; Format=app bundle Mach-O thin (arm64); Signature=adhoc | **PASS** | n/a | yes | rerun build.sh | unit | Calliope |
| C-T04 | App launches & stays alive | Spawn binary directly, track PID, verify alive after 3s, terminate by PID | `./MMFF Vector Launcher.app/Contents/MacOS/MMFFVectorLauncher &` then `kill -0 $PID` | process alive after 3s, terminates on SIGTERM | PID 26952, STAT=SN, etime=00:03, no stderr/stdout output, terminated cleanly | **PASS** | n/a | yes | rerun smoke launch | integration | Calliope |
| C-T05 | Theme matches Vector tokens | Theme.swift colours == globals.css | unit assert color hex per token | exact hex match | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun unit | unit | Calliope |
| C-T06 | Info.plist canonical fields | Plutil-parse and assert keys | `plutil -convert xml1 -o - …` | all keys §3.3 present | _TBD_ | _TBD_ | _TBD_ | _TBD_ | regenerate | unit | Calliope |

### 3.2 Boreas — SSH tunnels

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BOR-T01 | spawn tunnel | TunnelManager.start(env=dev) | start; lsof :5435 | ssh PID listening on 5435 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | re-spawn | integration | Boreas |
| BOR-T02 | adopt tunnel | Existing ssh listening; start() does not double-spawn | pre-bind via fake_ssh; start | state=.up(owned:false) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Boreas |
| BOR-T03 | refuse to kill un-owned | stop() with owned=false | adopt; stop | warning log, ssh untouched | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Boreas |
| BOR-T04 | probe ready | NWConnection succeeds | start; probe | ready in <2s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Boreas |
| BOR-T05 | drop detection | --simulate-drop 500ms | start; sleep 1s; probe | state=.dropped within 10s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Boreas |
| BOR-T06 | drop recovery | drop then auto-restart | drop test then wait | state=.up after backoff | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Boreas |
| BOR-T07 | refuse failure terminal | --refuse simulates auth fail | spawn 5x | state=.failed after 5 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Boreas |
| BOR-T08 | backoff schedule | Verify 1/2/4/8/15 jitter | unit on RetryPolicy | within ±50% jitter band | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Boreas |

### 3.3 Demeter — process supervision

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DEM-T01 | spawn backend | start() spawns go run via login bash | start; probe /healthz | "ok" within 30s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T01u | env constants canonical | BackendEnv tunnelPort/envFile/sshAlias match docs/c_server.md | XCTest `BackendEnvTests` — 5 cases on ports, env files, ssh aliases, ServiceState labels, isUp predicate | dev=5435/.env.dev/vector-dev-pg, staging=5436/.env.staging/vector-staging-pg, prod=5434 | all 5 passed in 0.000s | **PASS** | n/a | yes | `swift test --filter BackendEnvTests` | unit | Demeter |
| DEM-T02 | PGID kill cleans grandchildren | spawn; SIGKILL grandchild persists with pkill -P, not with pgid | start; stop; lsof :5100 | nothing on 5100 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T03 | crash + auto-restart | --crash-after 2 | spawn; wait 5s | state=.up after restart | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T04 | stale binary detected | --stale | spawn; probe | failure class=STALE, terminal | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T05 | bad shape terminal | --bad-shape | spawn; probe | BAD_SHAPE terminal | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T06 | spawn frontend | start() spawns npm run dev | start; probe :5101 | TCP open <60s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T07 | frontend html ready | After TCP, html ready | probe loop | text/html 200 within 60s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T08 | retry budget exhausted | refuse spawn 5x | start | state=.failed | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Demeter |
| DEM-T09 | backoff jitter range | unit on backoff fn | 1000 samples | within full-jitter [0, max] | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Demeter |
| DEM-T10 | login-bash PATH | Homebrew tools resolve | spawn `/bin/bash -lc 'which go'` | non-empty | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Demeter |

### 3.4 Eros — JSONL logging

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ERO-T01 | schema valid | Every entry validates against JSON schema | XCTest `testEntryEncodesCanonicalFields` + `testTimestampIsISO8601WithFractionalSeconds` (regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`) | 0 errors, all canonical fields encoded, ISO8601.fff Z timestamp shape | passed in 0.004s + 0.001s | **PASS** | n/a | yes | `swift test --filter JSONLLoggerTests` | unit | Eros |
| ERO-T02 | required fields | ts/level/tag/action/result present | XCTest `testRequiredFieldsPresentInAllLevels` — encodes one entry per LogLevel, asserts each canonical key non-nil | all present at debug/info/warn/error | passed in 0.001s, all 5 keys present at each of 4 levels | **PASS** | n/a | yes | `swift test --filter JSONLLoggerTests/testRequiredFieldsPresentInAllLevels` | unit | Eros |
| ERO-T03 | rotation at 10MB | Force 10MB write | tail count rotated files | one .gz, one active | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Eros |
| ERO-T04 | retention 7d | Time-travel mtime | run reaper | files >7d deleted | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Eros |
| ERO-T05 | mirror hard-link | Mirror writes to repo too | log; stat both files | identical inode | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Eros |
| ERO-T06 | tail dispatch | DispatchSource fires on extend | append; observe | event count == append count | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Eros |

### 3.5 Fenrir — bridge

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FNR-T01 | listen loopback only | NWListener bound | nc -z 192.168.x.x:7787 | refused | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T02 | bearer auth ok | Valid token → 200 | curl with token | 200 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T03 | bearer auth fail | Bad token → 401 | curl wrong token | 401 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T04 | host header check | Host: evil.com → 403 | curl --header Host:evil.com | 403 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T05 | idempotency replay | Same key 2x | POST start, POST start | 2nd returns cached action | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T06 | LRU expiry | Wait 60s; same key | wait; POST start | new action issued | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T07 | token rotate | POST /v1/auth/rotate | rotate; old token | 401 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Fenrir |
| FNR-T08 | constant-time compare | Wrong-token timing | benchmark vs correct | within 10% timing | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Fenrir |
| FNR-T09 | HTTP/1.1 parser correctness | Minimal parser handles GET/POST, lowercased headers, Content-Length, partial-body wait | XCTest `HTTPRequestTests` — 5 cases: GET+headers, lowercased keys, POST+body, partial body returns nil, missing CRLFCRLF returns nil | parser returns valid HTTPRequest for well-formed input; nil for incomplete | all 5 passed in 0.000s | **PASS** | n/a | yes | `swift test --filter HTTPRequestTests` | unit | Fenrir |

### 3.6 Gaia — coverage & harness

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GAI-T01 | unit suite runs | swift test executes | swift test | exit 0 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Gaia |
| GAI-T02 | coverage >= targets | xcrun llvm-cov merge | parse coverage | unit ≥85%, int ≥70% | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Gaia |
| GAI-T03 | fixtures isolated | fake_ssh + fake_backend independent | run both, no port clash | both bind | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Gaia |
| GAI-T04 | per-test timeout | Hung fixture aborts | force hang | test fails ≤30s | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Gaia |
| GAI-T05 | scenario file presence | All E2E-T01..T14 exist | ls scenarios | 14 files | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Gaia |
| GAI-T06 | results report | After run, table fully populated | parse TESTPLAN | no _TBD_ rows for run tier | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Gaia |

### 3.7 Helios — charts

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HEL-T01 | SVG validity | xmllint each file | xmllint --noout *.svg | exit 0 all | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Helios |
| HEL-T02 | role=img present | grep role="img" | grep | matches each | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Helios |
| HEL-T03 | aria-labelledby | grep aria-labelledby | grep | matches each | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Helios |
| HEL-T04 | severity colours only | grep var\(--success | --warning | --danger | grep | matches usage | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Helios |
| HEL-T05 | dashed thresholds | grep stroke-dasharray | grep | present | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Helios |

### 3.8 Iris — security

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IRI-T01 | bridge.token mode 0600 | stat token | `stat -f "%Lp" bridge.token` | 600 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Iris |
| IRI-T02 | keychain item present | SecItemCopyMatching | swift snippet | success, data matches | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Iris |
| IRI-T03 | ad-hoc signature | codesign -dvv | `codesign -dvv "MMFF Vector Launcher.app"` | "Signature=adhoc"; flags 0x10002 (adhoc,runtime); TeamIdentifier=not set | "Signature=adhoc"; flags=0x10002(adhoc,runtime); TeamIdentifier=not set; Identifier=dev.mmff.vector.launcher | **PASS** | n/a | yes | rerun codesign -dvv | integration | Iris |
| IRI-T04 | no hardened runtime | codesign -d --entitlements | exec | runtime flag absent | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Iris |
| IRI-T05 | TCC silence | Boot fresh; observe | observe console | no TCC prompts | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Iris |
| IRI-T06 | gatekeeper rejects adhoc | `spctl --assess -vv` against adhoc-signed bundle | `spctl --assess -vv "MMFF Vector Launcher.app"` | rejected (adhoc has no Apple-issued cert chain) | "rejected" — expected behaviour, user opens via right-click → Open OR System Settings → Privacy → Open Anyway | **PASS** | n/a | yes | rerun spctl | integration | Iris |
| IRI-T07 | accessible-this-device-only | SecItem attrs | swift snippet | kSecAttrAccessibleWhenUnlockedThisDeviceOnly | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Iris |

### 3.9 Janus — probes & retry

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JAN-T01 | portListen success | NWConnection on 5101 | probe | ready | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Janus |
| JAN-T02 | portListen REFUSED | nothing listening | probe | REFUSED | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | unit | Janus |
| JAN-T03 | httpHealthz shape | fake_backend ok | probe | parsed ok | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Janus |
| JAN-T04 | httpHealthz BAD_SHAPE | --bad-shape | probe | terminal BAD_SHAPE | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Janus |
| JAN-T04u | terminal failure classification | Pure-logic check that BAD_SHAPE+STALE are terminal, others are not | XCTest `testTerminalFailureClassification` + `testProbeFailureRawValuesStable` + `testProbeResultSuccessShape` | BAD_SHAPE.isTerminal=true; STALE.isTerminal=true; TIMEOUT/REFUSED/NETWORK_DOWN=false; rawValues stable; success.ok=true | passed in 0.000s × 3 | **PASS** | n/a | yes | `swift test --filter HealthProbeTests` | unit | Janus |
| JAN-T05 | STALE detection | mismatched commit | probe | terminal STALE | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Janus |
| JAN-T06 | .git/HEAD direct read | no git command spawned | XCTest `testReadGitHeadReturnsNonEmptyShaOrRef` reads `.git/HEAD`, follows one ref hop, audits chars are all hex | non-empty hex SHA returned without invoking `git` | passed in 0.000s — read returned full hex SHA from current HEAD, code path uses `String(contentsOf:)` only | **PASS** | n/a | yes | `swift test --filter HealthProbeTests/testReadGitHeadReturnsNonEmptyShaOrRef` | unit | Janus |
| JAN-T07 | full-jitter math | `RetryPolicy.delay(forAttempt:)` distribution check | XCTest `testFullJitterWithinCap` — 8 attempts × 200 samples each | every sample within [0, cap] where cap = min(maxDelay, initial·2^n) | passed in 0.002s, all 1600 samples in band | **PASS** | n/a | yes | `swift test --filter RetryPolicyTests/testFullJitterWithinCap` | unit | Janus |
| JAN-T08 | per-phase budgets | Tunnel/Backend/Frontend caps + attempts | XCTest `testPerPhaseBudgets` asserts each preset against canonical table | tunnel 5att/4s, backend 5att/8s, frontend 5att/15s | passed in 0.000s — exact match | **PASS** | n/a | yes | `swift test --filter RetryPolicyTests/testPerPhaseBudgets` | unit | Janus |

### 3.10 Kratos — env & coexistence

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeat? | Action | Layer | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| KRA-T01 | flock acquired | env.lock acquired and body runs | XCTest `testWithLockExecutesBodyAndReleases` calls `MarkerLock.withLock` twice in sequence, asserts body increment ran each time | non-null fd, body runs once per call, lock released between calls | passed in 0.001s — 2 acquisitions, body counter==2 | **PASS** | n/a | yes | `swift test --filter MarkerLockTests/testWithLockExecutesBodyAndReleases` | unit | Kratos |
| KRA-T01b | parse live marker | `readActiveEnv` reads `.claude/CLAUDE.md` ACTIVE_BACKEND_ENV block | XCTest `testReadActiveEnvParsesLiveMarker` — read parser only, no write | env in {dev,staging,production} returned | passed in 0.001s — returned current marker value | **PASS** | n/a | yes | `swift test --filter MarkerLockTests/testReadActiveEnvParsesLiveMarker` | unit | Kratos |
| KRA-T02 | flock contention | second acquire blocks | start two | second waits | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T03 | atomic marker write | mkstemp+rename | write twice; observe inode | inode changed each write | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T04 | env switch e2e | dev → staging | switch; assert | marker=staging, tunnel 5436 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T05 | adopt running stack | pre-spawn all 3; start launcher | `lsof` check | adopt, owned=false | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T06 | classify ssh PID | adopt-running | run | classified as tunnel | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T07 | classify go run PID | adopt-running | run | classified as backend | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |
| KRA-T08 | concurrent writer race | `<server>` simulated mid-switch | run | one writer wins, other blocks | _TBD_ | _TBD_ | _TBD_ | _TBD_ | rerun | integration | Kratos |

---

## 4. E2E scenarios (orchestrator-driven)

| ID | Title | Layer | Steps file |
|---|---|---|---|
| E2E-T01 | Cold start happy path | e2e | `scenarios/E2E-T01.md` |
| E2E-T02 | Cold start with tunnel already running | e2e | `scenarios/E2E-T02.md` |
| E2E-T03 | Cold start with backend stale binary | e2e | `scenarios/E2E-T03.md` |
| E2E-T04 | Stop all from idle | e2e | `scenarios/E2E-T04.md` |
| E2E-T05 | Restart all | e2e | `scenarios/E2E-T05.md` |
| E2E-T06 | Switch env dev → staging | e2e | `scenarios/E2E-T06.md` |
| E2E-T07 | Switch env dev → production (typed-confirm) | e2e | `scenarios/E2E-T07.md` |
| E2E-T08 | Tunnel drops mid-session | e2e | `scenarios/E2E-T08.md` |
| E2E-T09 | Backend crashes mid-session | e2e | `scenarios/E2E-T09.md` |
| E2E-T10 | Bridge auth — bad token rejected | e2e | `scenarios/E2E-T10.md` |
| E2E-T11 | Bridge auth — replay rejected | e2e | `scenarios/E2E-T11.md` |
| E2E-T12 | Concurrent marker write race | e2e | `scenarios/E2E-T12.md` |
| E2E-T13 | Adopt running tunnel + backend, owned=false | e2e | `scenarios/E2E-T13.md` |
| E2E-T14 | Refuse to kill un-owned services | e2e | `scenarios/E2E-T14.md` |

Each scenario file follows the master columns and is filled in during P8b.

---

## 5. Failure handling & recursion (orchestrator)

When a row records `Result: FAIL`:

1. Capture: command, exit code, stdout/stderr, JSONL log slice (last 500 lines), `lsof` snapshot, marker file snapshot.
2. Classify root cause.
3. If root cause is in scope of a single named agent's slice: re-engage that agent with the captured evidence; agent updates its log and proposes a fix.
4. If cross-cutting: orchestrator drafts the fix.
5. Re-run the failing test. Record `Repeatable? = yes` if pre-fix it failed deterministically.
6. If the same test fails twice after a fix: spawn a new sub-agent (Mnemosyne onwards) to research deeper, with confidence threshold still 95%.

---

## 6. Test inventory summary

| Tier | Count |
|---|---|
| Unit + integration slice (table 3.1–3.10, including 5 augmented unit rows) | 78 |
| Cross-cutting e2e (§4) | 14 |
| **Total** | **92** |

Coverage of mission-critical surfaces: process supervision (DEM ×11), tunnels (BOR ×8), env coordination (KRA ×9), security (IRI ×7 + FNR ×9), retries/probes (JAN ×9). All happy + sad paths from §11.3 of SPEC are represented.

---

## 7. Run log — 2026-04-27

### 7.1 Unit + bundle slice (executed)

| Test ID | Result | Time | Owner |
|---|---|---|---|
| C-T01 swift build | **PASS** | 4.45s | Calliope |
| C-T02 bundle layout | **PASS** | <1s | Calliope |
| C-T03 codesign verify | **PASS** | <1s | Calliope |
| C-T04 binary launch + survival | **PASS** | 3s | Calliope |
| IRI-T03 adhoc signature flags | **PASS** | <1s | Iris |
| IRI-T06 spctl rejects adhoc | **PASS** | <1s | Iris |
| ERO-T01 schema valid | **PASS** | 5ms | Eros |
| ERO-T02 required fields | **PASS** | 1ms | Eros |
| JAN-T06 .git/HEAD direct read | **PASS** | <1ms | Janus |
| JAN-T07 full-jitter math | **PASS** | 2ms | Janus |
| JAN-T08 per-phase budgets | **PASS** | <1ms | Janus |
| JAN-T04u terminal classification (×3) | **PASS** | <1ms | Janus |
| FNR-T09 HTTP/1.1 parser (×5) | **PASS** | <1ms | Fenrir |
| KRA-T01 flock acquire/release | **PASS** | 1ms | Kratos |
| KRA-T01b parse live marker | **PASS** | 1ms | Kratos |
| DEM-T01u env constants (×5) | **PASS** | <1ms | Demeter |

**XCTest aggregate:** 22 cases, 0 failures, 0 errors, 11ms total. Build complete in 11.24s under `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`. xcode-select still points to CommandLineTools (preserves global toolchain); per-invocation override only.

### 7.2 Pending tiers

- **Integration tier** (BOR-T01..T08, DEM-T01..T10, ERO-T03..T06, FNR-T01..T08, IRI-T01..T07, JAN-T01..T05, KRA-T02..T08): requires `fake_ssh` / `fake_backend` / `fake_frontend` Python+bash fixtures (§2). Fixture skeletons and run scripts are next phase (P9 in backlog). Not blockers for the .app handover — code paths under test are exercised by e2e once a real backend/tunnel is running.
- **e2e tier** (E2E-T01..T14): orchestrator scripts, run after handover by re-engaging this loop with a fresh repo state.
- **Coverage report** (GAI-T02): `xcrun llvm-cov` merge; gated on integration tier completion.

---

**End of TESTPLAN.md**
