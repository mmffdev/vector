# MMFF Vector Launcher — Specification

**Status:** APPROVED for implementation
**Confidence:** 96% (synthesised from 10 named research agents, all ≥95%)
**Source agents:** Calliope, Boreas, Demeter, Eros, Fenrir, Gaia, Helios, Iris, Janus, Kratos

---

## 1. Mission & non-goals

**Mission.** A STABLE / DEPENDABLE / FUNCTIONAL macOS launcher that orchestrates the Vector dev stack (SSH tunnel → Go backend → Next.js frontend → DB env switching) from a single SwiftUI dashboard, exposes the same controls to the running web app over a localhost bridge, and keeps a structured JSONL audit log of every action.

**Non-goals (hard).**
1. **Never run a `git` command** — neither shells, nor sub-processes, nor agents.
2. Do not modify or replace `MMFF Vector Dev.app`, `MMFF Vector Dev.applescript`, `<server>`, `<services>`, `<npm>`, or the AppleScript bundle. Coexist.
3. No App Sandbox, no Hardened Runtime, no notarisation. This is an internal dev tool, ad-hoc-signed, distributed by repo checkout.
4. No XCUITest GUI tests — only CommandLineTools is installed, which cannot drive an XCTest UI bundle. Use agent-driven e2e + XCTest unit/integration only.
5. No driving of native AppKit windows by Selenium/Playwright (no driver). The localhost bridge surface IS browser-testable but that is optional.

---

## 2. High-level architecture

```
┌──────────────────────────────────────────────────────────┐
│  SwiftUI dashboard (in-process)                          │
│   • Start / Stop / Restart all                           │
│   • Per-component controls (tunnel / backend / frontend) │
│   • Env selector (D / S / P)                             │
│   • Live log tail                                        │
│   • Status pills + uptime                                │
└─────────────────┬────────────────────────────────────────┘
                  │ Combine + Swift actors
                  ▼
┌──────────────────────────────────────────────────────────┐
│  Orchestrator                                            │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│   │TunnelManager│ │BackendMgr   │ │FrontendMgr  │        │
│   │ (Boreas)    │ │ (Demeter)   │ │ (Demeter)   │        │
│   └─────────────┘ └─────────────┘ └─────────────┘        │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│   │EnvSelector  │ │HealthProbe  │ │RetryPolicy  │        │
│   │ (Kratos)    │ │ (Janus)     │ │ (Janus)     │        │
│   └─────────────┘ └─────────────┘ └─────────────┘        │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│   │JSONLLogger  │ │MarkerLock   │ │BridgeServer │        │
│   │ (Eros)      │ │ (Kratos)    │ │ (Fenrir)    │        │
│   └─────────────┘ └─────────────┘ └─────────────┘        │
└─────────────────┬────────────────────────────────────────┘
                  │ Foundation.Process via /bin/bash -lc
                  ▼
┌──────────────────────────────────────────────────────────┐
│  External services                                       │
│   ssh -fN <alias>   →  tunnel ports 5434/5435/5436       │
│   go run …          →  backend :5100   (/healthz)        │
│   npm run dev       →  frontend :5101                    │
└──────────────────────────────────────────────────────────┘
                  ▲
                  │ HTTPS (localhost) — bearer token
┌─────────────────┴────────────────────────────────────────┐
│  Vector web app (browser)                                │
│   EnvBadge + ControlPanel call Go backend, which proxies │
│   to launcher's localhost bridge.                        │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Build & packaging (Calliope)

### 3.1 Toolchain
- **Swift 6.2** (Apple Swift), target `arm64-apple-macosx26.0`
- **Swift Package Manager only** — no `.xcodeproj`, no full Xcode (CommandLineTools only)
- Hand-crafted `.app` bundle layout

### 3.2 Bundle layout (final)
```
MMFF Vector Launcher.app/
├── Contents/
│   ├── Info.plist                  # CFBundleIdentifier=dev.mmff.vector.launcher
│   ├── PkgInfo                     # "APPL????"
│   ├── MacOS/
│   │   └── MMFFVectorLauncher      # Mach-O arm64 executable
│   └── Resources/
│       ├── AppIcon.icns            # placeholder for v1
│       └── Assets/                 # SVG glyphs, theme JSON
```

### 3.3 Info.plist canonical fields
| Key | Value |
|---|---|
| `CFBundleIdentifier` | `dev.mmff.vector.launcher` |
| `CFBundleName` | `MMFF Vector Launcher` |
| `CFBundleExecutable` | `MMFFVectorLauncher` |
| `CFBundleShortVersionString` | `0.1.0` |
| `CFBundleVersion` | `1` |
| `LSMinimumSystemVersion` | `26.0` |
| `LSUIElement` | `false` (window-bearing dock app) |
| `NSPrincipalClass` | `NSApplication` |
| `LSApplicationCategoryType` | `public.app-category.developer-tools` |
| `NSHighResolutionCapable` | `true` |

### 3.4 Build script (`tools/launcher/build.sh`)
1. `swift build -c release --arch arm64`
2. `mkdir -p "<repo>/MMFF Vector Launcher.app/Contents/{MacOS,Resources}"`
3. Install binary → `Contents/MacOS/MMFFVectorLauncher`
4. Install `Info.plist`, `PkgInfo`
5. Copy `Resources/Assets/`
6. Generate placeholder `AppIcon.icns` if missing
7. **Ad-hoc codesign bottom-up** (no `--deep`):
   ```
   codesign -f -s - -o runtime --timestamp=none \
     "MMFF Vector Launcher.app/Contents/MacOS/MMFFVectorLauncher"
   codesign -f -s - -o runtime --timestamp=none \
     "MMFF Vector Launcher.app"
   ```
8. `codesign --verify --deep --strict --verbose=2 "MMFF Vector Launcher.app"`
9. `spctl --assess --type execute -vvv` — expected: rejected (unsigned dev), user opens via System Settings → Privacy & Security → Open Anyway.

### 3.5 Code structure (`Package.swift`)
- Single `executableTarget` named `MMFFVectorLauncher`
- Platforms `[.macOS(.v26)]`
- No dependencies (avoid swift-nio-ssh — Apple labels it non-production)

### 3.6 Theme (Theme.swift)
Maps `app/globals.css` Vector design tokens (`--success`, `--warning`, `--danger`, `--bg`, `--fg`, `--accent`) to `Color` constants used by SwiftUI views — same palette as the web app.

---

## 4. SSH tunnel orchestration (Boreas)

### 4.1 Approach
**Spawn `ssh -fN <alias>` via `Foundation.Process`.** Do not embed swift-nio-ssh — Apple says it's non-production. The existing AppleScript already uses `ssh -fN <alias>`; we match.

### 4.2 Aliases & ports (canonical)
| Env | Alias | Local port | Remote |
|---|---|---|---|
| dev | `vector-dev-pg` | 5435 | dev DB |
| staging | `vector-staging-pg` | 5436 | staging DB |
| production | `mmffdev-pg` | 5434 | prod DB |

`~/.ssh/config` entries are required — pre-existing.

### 4.3 Lifecycle
States: `down` → `starting` → `up(pid:owned:)` → `dropped` → `restarting` | `failed`

`owned: Bool` flag on `.up` — if we adopted a tunnel we did not spawn, `owned=false` and stop() refuses to kill it.

### 4.4 Adoption (cold start)
On launcher start: for each env's port, run `lsof -nP -iTCP:<port> -sTCP:LISTEN` — if a `ssh` PID is bound, mark state `.up(pid:owned:false)` and skip spawn.

### 4.5 Probe
`NWConnection(host: "127.0.0.1", port: <portForEnv>)`, `.tcp`, 1s timeout. Considered ready on first successful connect.

### 4.6 Retry / drop handling
- Spawn options: `ServerAliveInterval=30`, `ExitOnForwardFailure=yes`, `BatchMode=yes`
- 5-attempt full-jitter exponential backoff: 1s / 2s / 4s / 8s / 15s
- Drop confirmation window: 10s of consecutive failures before declaring `dropped`
- After 5 failed restarts: state `.failed`, surface to UI

### 4.7 Stop
- If `owned=true`: `kill(pid, SIGTERM)` → 3s wait → `SIGKILL` → final lsof sweep
- If `owned=false`: stop is a no-op, log warning

---

## 5. Process supervision (Demeter)

### 5.1 Backend
- Spawn: `Foundation.Process` running `/bin/bash -lc 'cd <repo>/backend && BACKEND_ENV=<env> go run ./cmd/server'`
- Environment file: `backend/.env.<env>` (read by backend internally)
- Probe: HTTP GET `http://127.0.0.1:5100/healthz`, JSON `{"status":"ok",...}`, 30s readiness budget
- Stale-binary detection: GET `/healthz.commit` and compare to `cat .git/HEAD` (read directly — no `git` command)

### 5.2 Frontend
- Spawn: `/bin/bash -lc 'cd <repo> && npm run dev -- -p 5101'`
- Probe: TCP `:5101` first (Next dev returns 404 on `/` until first compile), then HTML readiness once connected
- 60s readiness budget (Next cold-start)

### 5.3 PGID-based kill (CRITICAL — fixes 2026-04-25 regression)
`pkill -P` is too weak for grandchildren (e.g. `go run` spawning the actual server binary).

```swift
let pgid = getpgid(process.processIdentifier)
kill(-pgid, SIGTERM)        // negative = whole process group
// 3s wait
if stillAlive { kill(-pgid, SIGKILL) }
// final lsof sweep on the bound port; SIGKILL anything still there
```

### 5.4 Retry policy
Full-jitter exponential backoff:
```
delay(n) = min(8, 0.5 * 2^n) * Double.random(in: 0.5...1.0)
```
5 attempts, then `.failed`.

---

## 6. Structured logging (Eros)

### 6.1 Schema (JSON Schema Draft 2020-12)
```json
{
  "ts": "2026-04-27T18:30:00.123Z",
  "level": "info|warn|error|debug",
  "tag":   "tunnel|backend|frontend|env|bridge|app|test",
  "action":"start|stop|probe|restart|switch|spawn|drop|...",
  "result":"ok|err|timeout|skipped",
  "extra": { ...freeform... }
}
```
Required: `ts`, `level`, `tag`, `action`, `result`.

### 6.2 Storage
- Primary: `~/Library/Application Support/MMFFVectorLauncher/logs/launcher.jsonl`
- Mirror (hard-linked): `<repo>/local-assets/launcher/logs/launcher.jsonl` for dev tail

### 6.3 Rotation
- 10MB rolling file, gzip on rotate, 7-day retention
- Filename: `launcher.YYYYMMDD-HHMMSS.jsonl.gz`

### 6.4 Implementation
`actor JSONLLogger { func log(_ entry: LogEntry) async }` — Swift 6 actor for thread-safe writes.

### 6.5 UI tail
`DispatchSource.makeFileSystemObjectSource(fileDescriptor:eventMask:[.extend,.delete,.rename])` — push new bytes into a SwiftUI `@Published` list. Render as:
```
HH:mm:ss.SSS  LEVEL  TAG     ACTION    RESULT  k=v k=v
18:30:00.123  INFO   tunnel  spawn     ok      env=dev pid=4421
```

---

## 7. Web ↔ native bridge (Fenrir)

### 7.1 Transport
**Localhost HTTP via `Network.NWListener`** — proxied by Go backend so the browser never holds the bearer token directly.

`NWParameters`:
- `acceptLocalOnly = true`
- `requiredInterfaceType = .loopback`
- Bind: `127.0.0.1:7787` (registered, not in use elsewhere in repo)

### 7.2 Auth
- Bearer token, 256-bit, written to `~/Library/Application Support/MMFFVectorLauncher/bridge.token` mode `0600`
- Constant-time compare (`Data.constantTimeEquals`)
- Host header check (must be `127.0.0.1:7787`)
- 256-entry / 60s LRU cache for replay protection

### 7.3 Endpoints (v1)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/v1/state` | – | Snapshot of all 3 services |
| GET | `/v1/health` | – | Aggregate health + per-service |
| POST | `/v1/services/{tunnel\|backend\|frontend}/start` | `{}` | Idempotency-Key required |
| POST | `/v1/services/{tunnel\|backend\|frontend}/stop` | `{}` | Idempotency-Key required |
| POST | `/v1/services/{tunnel\|backend\|frontend}/restart` | `{}` | Idempotency-Key required |
| POST | `/v1/env/switch` | `{"env":"dev\|staging\|production"}` | Idempotency-Key required |
| GET | `/v1/logs?since=&limit=&service=` | – | JSONL replay |
| GET | `/v1/actions/{id}` | – | Action status by Idempotency-Key |
| POST | `/v1/auth/rotate` | `{}` | Rotate token, write new token to bridge.token |

### 7.4 Backend proxy
Backend Go service exposes `/api/_meta/launcher/*` which forwards to `127.0.0.1:7787/v1/*`, injecting the bearer from a server-side read of `bridge.token`. Browser never sees the token.

---

## 8. Health probes & retries (Janus)

### 8.1 Three probe primitives
| Primitive | Use |
|---|---|
| `portListen(host,port,timeout)` | NWConnection TCP probe — tunnel readiness |
| `httpHealthz(url,expectedShape,timeout)` | URLSession + JSON shape check + commit verify |
| `htmlReady(url,timeout)` | Status 200 + `Content-Type: text/html` |

### 8.2 Per-phase budgets
| Phase | Initial delay | Max wait | Attempts |
|---|---|---|---|
| Tunnel | 0.5s | 4s | 5 |
| Backend | 1s | 8s | 5 |
| Frontend | 2s | 15s | 5 |

### 8.3 Failure classes
| Class | Terminal? | Notes |
|---|---|---|
| TIMEOUT | no | retry |
| REFUSED | no | retry |
| BAD_SHAPE | **yes** | `/healthz` returned but wrong JSON — likely wrong binary |
| STALE | **yes** | binary commit ≠ `.git/HEAD` |
| NETWORK_DOWN | no | retry; surface to UI |

### 8.4 Stale-binary detection
Read `.git/HEAD` directly (no `git` command). If line is `ref: <ref>`, follow it to `.git/<ref>` for SHA. Compare to `/healthz.commit`. Mismatch ⇒ STALE ⇒ surface "Backend stale — restart" prompt.

---

## 9. Env selection & coexistence (Kratos)

### 9.1 Marker file
`<!-- ACTIVE_BACKEND_ENV:start -->` … `<!-- ACTIVE_BACKEND_ENV:end -->` block in `.claude/CLAUDE.md`. Authoritative.

### 9.2 Marker write coordination
Three concurrent writers: `<server>` script, EnvBadge web UI, this launcher.

**POSIX flock** on `~/Library/Application Support/MMFFVectorLauncher/env.lock` (sibling, not the marker file itself). Atomic write via `mkstemp` + `rename(2)`.

### 9.3 Env switch flow
1. Acquire flock on env.lock (5s timeout)
2. Stop backend (PGID kill)
3. Stop tunnel (only if owned)
4. Update marker file in `.claude/CLAUDE.md` (atomic)
5. Start tunnel for new env (or adopt running)
6. Probe tunnel
7. Start backend with `BACKEND_ENV=<new>`
8. Probe backend `/healthz`
9. Release flock
10. EnvBadge fsnotify-watches CLAUDE.md → SSE on `/api/_meta/env/stream` → web UI updates

### 9.4 Coexistence matrix (rows: action × cols: tooling)
| Action | `<server>` | `<services>` | `<npm>` | `MMFF Vector Dev.app` | This launcher |
|---|---|---|---|---|---|
| read marker | ✓ | ✓ | – | – | ✓ |
| write marker | ✓ | – | – | – | ✓ (flock) |
| spawn tunnel | – | – | – | ✓ | ✓ (skip if `lsof` shows ssh) |
| kill tunnel | – | – | – | – | ✓ (only if owned) |
| spawn backend | ✓ | – | – | ✓ | ✓ |
| spawn frontend | – | – | ✓ | ✓ | ✓ |

### 9.5 Adopt-running-services
For each port (5434/5435/5436/5100/5101) run `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Classify origin via `ps -o command= -p <pid>`:
- `ssh -fN`: tunnel — adopt unowned
- `go run ./cmd/server` or `go-build*server`: backend — adopt unowned
- `next dev` or `node`: frontend — adopt unowned
- anything else: ignore, log warn

### 9.6 Pre-existing latent bug (flagged, not fixed by us)
`MMFF Vector Dev.applescript` hard-codes `mmffdev-pg` regardless of `ACTIVE_BACKEND_ENV`. This means the AppleScript launcher always brings up the prod tunnel, even when CLAUDE.md says dev. NOT a regression — pre-existing. Documented for orchestrator. We do not modify the AppleScript.

---

## 10. Security posture (Iris)

| Concern | Decision |
|---|---|
| App Sandbox | OFF — internal dev tool needs unconstrained Process spawn |
| Hardened Runtime | OFF — required for ad-hoc dev distribution without notarisation |
| Codesign | Ad-hoc (`codesign -s -`), bottom-up, no `--deep` flag |
| Notarisation | Not pursued |
| Gatekeeper (Tahoe 26) | First-launch path: System Settings → Privacy & Security → Open Anyway. **Right-click → Open is removed in Tahoe.** |
| Keychain | Bridge token mirrored into Keychain via `SecItemAdd` with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, service `com.mmffdev.vector.launcher` |
| TCC prompts | None expected — cwd inside repo, `/tmp`, `~/Library/Application Support/<bundle>` |
| Bridge token file mode | `0600` |

**Stale doc:** `c_dev-launcher.md` line 42 currently says "right-click → Open" — that path is removed in Tahoe 26. Flagged for the c_launcher.md update (see §13).

---

## 11. Test architecture (Gaia)

### 11.1 Three tiers
| Tier | Tool | Coverage target |
|---|---|---|
| Unit | XCTest | ≥85% |
| Integration | XCTest + Python `http.server` + `fake_ssh` fixtures | ≥70% |
| Agent-driven e2e | Scripted scenarios run by orchestrator | All happy + sad paths in §11.3 |

XCUITest is **excluded** — only CommandLineTools is installed; XCUITest needs full Xcode.

### 11.2 Test ID conventions
- Slice tests: `<AGENT>-T<NN>` (e.g. `BOR-T03`, `DEM-T07`)
- E2E: `E2E-T<NN>`

### 11.3 E2E scenarios (canonical 14)
Each scenario lives at `local-assets/launcher/tests/scenarios/E2E-T<NN>.md`.

| ID | Title | Path |
|---|---|---|
| E2E-T01 | Cold start happy path (all 3 services) | happy |
| E2E-T02 | Cold start with tunnel already running | happy (adopt) |
| E2E-T03 | Cold start with backend stale binary | sad (STALE) |
| E2E-T04 | Stop all from idle | happy |
| E2E-T05 | Restart all | happy |
| E2E-T06 | Switch env dev → staging | happy |
| E2E-T07 | Switch env dev → production (typed-confirm) | happy + auth |
| E2E-T08 | Tunnel drops mid-session | sad (drop+recover) |
| E2E-T09 | Backend crashes mid-session | sad (crash+restart) |
| E2E-T10 | Bridge auth — bad token rejected | sad (security) |
| E2E-T11 | Bridge auth — replay rejected | sad (security) |
| E2E-T12 | Concurrent marker write (`<server>` vs UI) | sad (race) |
| E2E-T13 | Adopt running tunnel + backend, owned=false | happy |
| E2E-T14 | Refuse to kill un-owned services | happy (safety) |

### 11.4 Per-test result columns (master table)
`ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action to repeat | Layer | Owner`

See [TESTPLAN.md](./TESTPLAN.md) for the full table.

---

## 12. Charts (Helios)

Six inline SVG charts saved to `local-assets/launcher/charts/`:

| File | Decision question answered |
|---|---|
| `uptime_24h.svg` | Is the stack stable enough to keep running unattended? |
| `startup_latency_p50_p95.svg` | How long does cold-start take, today vs yesterday? |
| `retries_stacked_area.svg` | Where are we burning retries? |
| `error_rate_per_tag.svg` | Which subsystem fails most? |
| `env_switch_frequency.svg` | How often do devs switch DB env? Worth investing in? |
| `time_to_first_healthy.svg` | When does each service hit ready, and is the tail long? |

All charts: `role="img"`, `aria-labelledby`, severity-only colour from Vector tokens (`--success`, `--warning`, `--danger`), SLO/threshold lines dashed.

---

## 13. Documentation deliverables

1. `local-assets/launcher/spec/SPEC.md` — this document.
2. `local-assets/launcher/spec/TESTPLAN.md` — master test table + per-tier strategy.
3. `local-assets/launcher/agents/<Name>.md` × 10 — agent running logs.
4. `local-assets/launcher/charts/*.svg` — 6 charts.
5. `dev/research/R003.json` — final professional report → Dev → Research panel.
6. `.claude/commands/c_launcher.md` — shortcut doc (Kratos sketch).
7. Memory backlog: `~/.claude/projects/.../memory/project_launcher_backlog.md` — kept current.

---

## 14. Implementation order (phases P3–P11)

| Phase | Deliverable | Source agent |
|---|---|---|
| P3 | Swift Package + Info.plist + build.sh | Calliope |
| P4a | JSONLLogger | Eros |
| P4b | RetryPolicy + HealthProbe | Janus |
| P4c | MarkerLock (flock + atomic rename) | Kratos |
| P5a | TunnelManager | Boreas |
| P5b | BackendManager + FrontendManager | Demeter |
| P5c | EnvSelector | Kratos |
| P6 | SwiftUI dashboard | Calliope |
| P7 | BridgeServer (localhost HTTP, bearer auth) | Fenrir |
| P8a | XCTest unit + integration | Gaia |
| P8b | Agent-driven e2e (E2E-T01..14) | Gaia |
| P9 | Inline-SVG charts wired to live data | Helios |
| P10 | dev/research/R003.json compiled | orchestrator |
| P11 | c_launcher.md + memory backlog + handover | orchestrator |

---

## 15. Open questions (none blocking)

All blocking questions resolved. Two notes for the orchestrator:
1. **AppleScript hard-coded `mmffdev-pg`** — pre-existing latent bug (Kratos). Not in scope.
2. **`c_dev-launcher.md` line 42** — stale Gatekeeper instruction. Will be corrected in `c_launcher.md` only (we don't touch existing doc).

---

**End of SPEC.md** — implementation begins from §14.
