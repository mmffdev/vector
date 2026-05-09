# Agent: Demeter
**Role:** Process supervision in Swift for the Go backend (`:5100`) and Next.js frontend (`:5101`) — start, stop, restart, probe, stale-binary detection.
**Scope assigned by orchestrator:**
- `Process` vs `posix_spawn` vs `bash -lc` — pick one and justify (Homebrew PATH matters).
- Capture stdout/stderr to JSONL log files (hand off to Eros).
- Health-probe loops: `/healthz` for backend, `:5101` listening for frontend.
- Retry policy — exponential vs linear, max 5 attempts.
- Stale-binary detection: backend `/healthz.commit` vs `git rev-parse HEAD` (read-only).
- Graceful stop: SIGTERM → 3s → SIGKILL, including `go run`'s child binary.
- Restart-all semantics: stop reverse (frontend → backend → tunnel), start forward.
- Coexistence: do not modify `MMFF Vector Dev.app`, `<server>`, `<services>`, `<npm>`.

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:43Z] starting — read MASTER, _TEMPLATE, c_server, c_services, AppleScript launcher, backend `/healthz`.
- [2026-04-27T19:46Z] mapped existing-tooling truths: AppleScript uses `/bin/bash -lc 'go run ./cmd/server'` (login bash → Homebrew PATH); kills compiled child via `lsof -t :PORT` because `go run` spawns the binary as a child of bash; `<services>` already does stale-commit by comparing `/healthz.commit` to `git rev-parse HEAD` and treats `commit:"dev"` as "go run, can't verify".
- [2026-04-27T19:48Z] researching — Swift Subprocess + `POSIX_SPAWN_SETSID`, `swift-retry`, `swift-async-algorithms` retry pitch.
- [2026-04-27T19:52Z] decided: `Foundation.Process` with `launchPath = /bin/bash`, `arguments = ["-lc", "<cmd>"]`, plus a **process-group capture** trick (read child's PGID via `getpgid(pid)` immediately after launch and store it). Kill with `kill(-pgid, SIGTERM)` to nuke the entire group — this beats `pkill -P` because it catches grandchildren, not just direct children.
- [2026-04-27T19:54Z] drafting code skeletons + test slice.
- [2026-04-27T19:55Z] complete.

## Findings

### Recommendation

**Spawning model: `Process` invoking `/bin/bash -lc "<cmd>"`.**
Three options were on the table:

| Option | Verdict | Why |
|---|---|---|
| `Foundation.Process` with `bash -lc` | ✅ chosen | Login bash sources `~/.zprofile`/`~/.bashrc` → Homebrew (`/opt/homebrew/bin`), `nvm`, and `go` PATH all populate. Mirrors what `MMFF Vector Dev.app` already does, so behavioural parity is free. `Process` gives us native `Pipe` for stdout/stderr capture — no manual fd plumbing. |
| Raw `posix_spawn` with `POSIX_SPAWN_SETSID` | ❌ | Cleaner kill semantics (child is its own session leader → `kill(-pid)` reaches everything), but you lose `Pipe` ergonomics, you have to import `Darwin` and reach into C. Worse: child does not inherit a login shell environment, so `go` is missing from PATH unless we manually rebuild the env, which is a re-implementation of bash's startup. STABLE > clever. |
| `swift-subprocess` (Apple's new package) | ❌ for now | API still in flux as of 2026-04 (`swiftlang/swift-subprocess`). Adds an SPM dep for a launcher that wants zero surprises. Revisit at 1.0. |

**Killing `go run`'s grandchild — the regression that bit `<services>` in 2026-04-25.**
`go run` compiles to `$GOTMPDIR/<hash>/<exe>` and exec's it as a **child of bash**, which is itself a child of our `Process`. `Process.terminate()` sends SIGTERM only to the immediate child (bash). Bash exits, the compiled binary keeps running and keeps the TCP listener on `:5100`. The AppleScript launcher works around this by using `lsof -t :PORT` to find the listening pid and killing that too.

We do better. Right after `Process.run()`, capture the child's process-group ID via `getpgid(process.processIdentifier)` and store it. Because we launch through `bash -lc`, bash inherits its own PGID at fork; the compiled Go binary is `exec`'d inside that group; signaling `kill(-pgid, …)` reaches **bash + go + the compiled binary + any orphaned helpers** in one syscall. No `pkill -P` polling, no `lsof` race.

Belt-and-braces: after the SIGKILL window expires, sweep the listener port via `lsof -t -iTCP:<port> -sTCP:LISTEN` and kill anything still squatting it. This is the same fallback `<services>`/the AppleScript already uses — keeps us interoperable when the user has used those tools first.

**Logging.** `process.standardOutput = Pipe()` and `process.standardError = Pipe()`. Read from each pipe's `fileHandleForReading.readabilityHandler` line-by-line, wrap each line as a JSONL record `{ts, stream:"stdout"|"stderr", pid, line}`, and append to `~/Library/Logs/MMFFVectorLauncher/backend.jsonl` / `frontend.jsonl`. Hand the rotation/tail-rendering off to **Eros** — Demeter only writes raw lines. Coordination contract: filename per process, one JSON object per line, no batching, fsync optional.

**Health-probe loop.**
- Backend: `GET http://127.0.0.1:5100/healthz` until response is HTTP 200 **and** body parses as JSON with a `"status":"ok"` field. Polling cadence 250ms for first 2 s (catches a hot start), then 1 s thereafter, ceiling 30 s wall-clock.
- Frontend: TCP probe — open a connection to `127.0.0.1:5101`. If `connect()` succeeds, declare up. Don't HTTP-probe Next.js: its dev server returns 404 on `/` until the route compiles, which would fool us. Cadence: 1 s, ceiling 60 s (Next dev's first-compile is genuinely slow).

**Retry policy.** Exponential backoff with full jitter, **5 attempts max** per the user spec.
```
delay(n) = min(MAX_DELAY, BASE * 2^n) * Double.random(in: 0.5...1.0)
BASE = 0.5s, MAX_DELAY = 8s, attempts = 5
```
Total worst-case wait ≈ 0.25 + 0.5 + 1 + 2 + 4 = **~7.75 s** of sleep + ≤30 s probe windows. Linear was rejected: a flapping backend that fails because of a slow DB tunnel benefits from exponentially spacing-out retries; linear pummels it.

**Stale-binary detection (re-implemented from `<services>`).**
1. Read repo HEAD: `Process` runs `/usr/bin/git -C "<repoRoot>" rev-parse HEAD`, capture stdout, trim. **Read-only.** Never invoke any other git verb.
2. After backend is up, fetch `/healthz`. Three cases:
   - `commit == "dev"` → backend was launched via `go run`; we cannot verify. Render badge "go run · started=<ts>" in yellow.
   - `commit` is a prefix-match of HEAD → green "build=<short> started=<ts>".
   - else → red "STALE — restart". UI offers a single-click restart.
3. Plaintext `/healthz` (no JSON) → red "pre-2026-04-25 binary, RESTART".

This matches `<services>` byte-for-byte so dual-tool users see identical signals.

**Graceful stop.** `kill(-pgid, SIGTERM)` → `wait` up to 3 s with 100 ms poll on `kill(-pgid, 0)` returning ESRCH → `kill(-pgid, SIGKILL)` if still alive → final port-listener sweep. Total worst-case ≤ 3.2 s per service.

**Restart-all semantics.**
- **Stop order** (reverse dependency): frontend → backend → tunnel. Frontend can call backend during shutdown handlers; backend can call DB during graceful drain; tunnel must outlive both.
- **Start order** (forward dependency): tunnel → backend → frontend. Health-gate each: do not start the next until the previous reports up. If tunnel fails, abort the whole sequence — don't bring up a backend that will hang on its first DB query.

### Dead ends explored
- **Direct `posix_spawn` with `POSIX_SPAWN_SETSID`** — discarded. Loses login-bash PATH; reimplementing PATH inside Swift duplicates fragile shell-startup logic. The PGID-capture trick achieves the same kill semantics with `bash -lc`.
- **`pkill -P <pid>`** (what AppleScript does) — works but only one level deep. A grandchild orphaned to init survives. PGID kill is one syscall and recursive by definition.
- **HTTP probe of frontend `/`** — Next dev returns 404 until first compile, which we'd treat as alive-but-broken. TCP probe is the unambiguous signal.
- **DispatchSource process-exit watcher** — promising for "did the child die unexpectedly?" but adds a second concurrency primitive next to async/await. Stick with `process.terminationHandler` which is enough for a launcher.
- **Polling `git status` to invalidate cached commit** — overkill. Re-read HEAD on every restart and on every `<services>`-equivalent UI refresh.

### Sources
- [swiftlang/swift-subprocess on GitHub](https://github.com/swiftlang/swift-subprocess) — Apple's emerging package; documents `PlatformOptions.preSpawnProcessConfigurator` for setting `POSIX_SPAWN_SETSID`. Confirmed our PGID approach is the same idea via the older `Process` API.
- [Killing a process and all of its descendants — Igor Šarčević (morningcoffee.io)](https://morningcoffee.io/killing-a-process-and-all-of-its-descendants) — canonical write-up of the process-group / `setsid` / `kill(-pgid)` pattern. Validates the "negative PID kills the whole group" approach we use.
- [setsid(2) — Linux manual page (man7.org)](https://man7.org/linux/man-pages/man2/setsid.2.html) — semantics of session-leader + process-group leadership; confirms `kill(-pgid)` reaches grandchildren.
- [posix_spawn(3) — man7.org](https://man7.org/linux/man-pages/man3/posix_spawn.3.html) — `POSIX_SPAWN_SETSID` flag definition; documented the trade-off we rejected.
- [Pitch: Retry & Backoff — Swift Forums (forums.swift.org/t/82483)](https://forums.swift.org/t/pitch-retry-backoff/82483) — current state of the official retry proposal in `swift-async-algorithms`; we rolled our own to avoid a moving-target dep.
- [Introducing the swift-retry package — Swift Forums (t/69153)](https://forums.swift.org/t/introducing-the-swift-retry-package/69153) — exponential-backoff-with-jitter parameters cross-checked.
- [Automatically retrying an asynchronous Swift Task — Swift by Sundell](https://www.swiftbysundell.com/articles/retrying-an-async-swift-task/) — async/await retry idiom we adapted.
- Repo path `MMFF Vector Dev.applescript` lines 64–86, 132–142 — existing kill-by-port-listener pattern; we preserve compatibility.
- Repo path `.claude/commands/c_services.md` lines 32–48 — stale-commit comparison logic we reproduce in Swift.
- Repo path `backend/cmd/server/main.go` lines 181–191 — `/healthz` JSON shape (`status`, `commit`, `build_time`, `started_at`, `env`).

## Contribution
- Effort: ~1 agent-turn of research + drafting.
- Coverage of overall project: 12% (per orchestrator allocation).
- Files produced or modified: `local-assets/launcher/agents/Demeter.md` (this file).

## Code skeleton

```swift
// BackendManager.swift
import Foundation

actor BackendManager: ServiceManager {
    enum State { case stopped, starting, up(commit: String, startedAt: String, stale: Bool), failed(String) }

    private let repoRoot = URL(fileURLWithPath: "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM")
    private let port = 5100
    private let logURL: URL  // injected by Eros
    private var process: Process?
    private var pgid: pid_t = 0
    private(set) var state: State = .stopped

    init(logURL: URL) { self.logURL = logURL }

    // MARK: lifecycle
    func start(env: BackendEnv) async throws {
        guard case .stopped = state else { return }
        state = .starting

        let cmd = "cd \(repoRoot.path.shellQuoted)/backend && BACKEND_ENV=\(env.rawValue) go run ./cmd/server"
        let p = Process()
        p.launchPath = "/bin/bash"
        p.arguments  = ["-lc", cmd]
        p.standardOutput = Pipe()
        p.standardError  = Pipe()
        attachJSONLLogger(p, file: logURL, pidProvider: { p.processIdentifier })
        p.terminationHandler = { [weak self] proc in
            Task { await self?.handleTermination(proc) }
        }
        try p.run()
        self.process = p
        self.pgid = getpgid(p.processIdentifier)   // capture immediately

        // Probe with exponential backoff + jitter, attempts=5, then continuous probe to 30s ceiling.
        try await probeUntilHealthy(deadline: 30)

        let h = try await fetchHealthz()
        let stale = await isStale(reportedCommit: h.commit)
        state = .up(commit: h.commit, startedAt: h.startedAt, stale: stale)
    }

    func stop() async {
        guard let p = process, p.isRunning, pgid > 0 else { state = .stopped; return }
        // SIGTERM the whole process group → 3s wait → SIGKILL → port-listener sweep.
        _ = kill(-pgid, SIGTERM)
        let killed = await waitForExit(pgid: pgid, timeout: .seconds(3))
        if !killed { _ = kill(-pgid, SIGKILL) }
        await sweepPortListener(port)
        process = nil; pgid = 0; state = .stopped
    }

    func restart(env: BackendEnv) async throws { await stop(); try await start(env: env) }

    // MARK: probe
    private func probeUntilHealthy(deadline: TimeInterval) async throws {
        let start = Date()
        var attempt = 0
        while Date().timeIntervalSince(start) < deadline {
            if (try? await fetchHealthz()) != nil { return }
            attempt += 1
            if attempt >= 5 { try await Task.sleep(nanoseconds: 1_000_000_000); continue }
            let base = 0.5, cap = 8.0
            let delay = min(cap, base * pow(2, Double(attempt))) * Double.random(in: 0.5...1.0)
            try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        throw LauncherError.healthzTimeout
    }

    private func fetchHealthz() async throws -> HealthzResponse {
        let url = URL(string: "http://127.0.0.1:\(port)/healthz")!
        var req = URLRequest(url: url); req.timeoutInterval = 1
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { throw LauncherError.badStatus }
        return try JSONDecoder().decode(HealthzResponse.self, from: data)
    }

    // MARK: stale-binary
    private func isStale(reportedCommit: String) async -> Bool {
        if reportedCommit == "dev" { return false }                     // unverifiable, render yellow
        guard let head = try? await readGitHead() else { return false } // can't read git → don't false-positive
        return !head.hasPrefix(reportedCommit)
    }

    private func readGitHead() async throws -> String {
        let p = Process()
        p.launchPath = "/usr/bin/git"
        p.arguments  = ["-C", repoRoot.path, "rev-parse", "HEAD"]    // READ ONLY
        let pipe = Pipe(); p.standardOutput = pipe
        try p.run(); p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw LauncherError.gitReadFailed }
        return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func handleTermination(_ proc: Process) async {
        if case .up = state {
            state = .failed("backend exited unexpectedly (status=\(proc.terminationStatus))")
        }
    }
}

struct HealthzResponse: Decodable {
    let status: String
    let commit: String
    let started_at: String   // matches backend JSON exactly
    var startedAt: String { started_at }
}
```

```swift
// FrontendManager.swift — same actor shape, TCP probe instead of HTTP.
actor FrontendManager: ServiceManager {
    enum State { case stopped, starting, up, failed(String) }
    private let repoRoot = URL(fileURLWithPath: "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM")
    private let port = 5101
    private let logURL: URL
    private var process: Process?
    private var pgid: pid_t = 0
    private(set) var state: State = .stopped
    init(logURL: URL) { self.logURL = logURL }

    func start() async throws {
        guard case .stopped = state else { return }
        state = .starting
        let cmd = "cd \(repoRoot.path.shellQuoted) && npm run dev -- -p \(port)"
        let p = Process()
        p.launchPath = "/bin/bash"
        p.arguments  = ["-lc", cmd]
        p.standardOutput = Pipe()
        p.standardError  = Pipe()
        attachJSONLLogger(p, file: logURL, pidProvider: { p.processIdentifier })
        p.terminationHandler = { [weak self] proc in Task { await self?.onExit(proc) } }
        try p.run()
        self.process = p
        self.pgid = getpgid(p.processIdentifier)
        try await probePortListening(port: port, deadline: 60)   // Next dev first-compile is slow
        state = .up
    }

    func stop() async { /* identical pattern: kill(-pgid), wait 3s, SIGKILL, port sweep */ }
    func restart() async throws { await stop(); try await start() }

    private func probePortListening(port: Int, deadline: TimeInterval) async throws {
        let start = Date()
        var attempt = 0
        while Date().timeIntervalSince(start) < deadline {
            if tcpProbe(host: "127.0.0.1", port: port) { return }
            attempt += 1
            let delay = attempt < 5
                ? min(8.0, 0.5 * pow(2, Double(attempt))) * Double.random(in: 0.5...1.0)
                : 1.0
            try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        throw LauncherError.frontendTimeout
    }

    private func onExit(_ proc: Process) async {
        if case .up = state { state = .failed("frontend exited (status=\(proc.terminationStatus))") }
    }
}

// Shared helpers (sketch):
//   tcpProbe(host:port:)        — connect + immediate close, returns Bool
//   waitForExit(pgid:timeout:)  — polls kill(-pgid, 0) at 100ms cadence
//   sweepPortListener(_:)       — runs `lsof -t -iTCP:<port> -sTCP:LISTEN`, kills survivors
//   attachJSONLLogger(_:file:pidProvider:) — Pipe.readabilityHandler → JSONL append
```

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action |
|---|---|---|---|---|---|---|---|---|---|
| DEM-T01 | Happy backend start | Start with valid env, /healthz returns ok within 30s | 1. `BackendManager.start(env: .dev)` 2. await state | `.up(commit, startedAt, stale: false)` within 30s, log file has stdout lines | _spec_ | _spec_ | n/a | yes | unit test with stub HTTP server on :5100 |
| DEM-T02 | Port-in-use sad | Pre-bind :5100 with a TCP listener, attempt start | 1. open TCP listener on 5100 2. `start(env: .dev)` | `.failed("…")` within 30s, no stale child process group | _spec_ | _spec_ | n/a | yes | spin a dummy listener in test setUp |
| DEM-T03 | /healthz timeout | Backend launches but never serves /healthz | 1. swap cmd for `sleep 60` 2. `start` | timeout error after 30s, `kill(-pgid)` issued during cleanup, port free | _spec_ | _spec_ | n/a | yes | inject mock cmd via test seam |
| DEM-T04 | Child binary survives parent kill (regression) | Kill bash parent only, confirm grandchild dies via PGID kill | 1. start backend 2. directly `kill(pid_of_bash, SIGKILL)` 3. wait 3s 4. assert :5100 not listening | After cleanup pass, no listener on :5100 (PGID kill caught grandchild even if we mis-killed parent) | _spec_ | _spec_ | n/a | yes | manual integration; assert via lsof |
| DEM-T05 | Restart in flight | Call restart() while a previous start() is still probing | 1. start (don't await) 2. restart immediately | Final state is single up backend, no zombie processes, only one listener on :5100 | _spec_ | _spec_ | n/a | yes | actor serializes calls — verify with concurrent task pair |
| DEM-T06 | Stop while starting | Call stop() before /healthz reports ok | 1. start (don't await) 2. stop after 200ms | State becomes `.stopped`, port free, no listener leaks, no unhandled error in log | _spec_ | _spec_ | n/a | yes | concurrent task pair |
| DEM-T07 | Stale-commit detection | Backend reports commit X, repo HEAD is Y | 1. mock /healthz commit="abc1234" 2. mock git HEAD="def5678…" | `state = .up(_, _, stale: true)` | _spec_ | _spec_ | n/a | yes | inject git-read + healthz seams |
| DEM-T08 | go-run unverifiable | /healthz returns commit="dev" | 1. start dev mode 2. inspect state | `stale: false` (treated as unverifiable, not stale) | _spec_ | _spec_ | n/a | yes | matches `<services>` semantics |
| DEM-T09 | Frontend port probe ignores 404 | Next dev returns 404 on / before first compile | 1. start frontend 2. probe | TCP probe declares up; HTTP probe (counterfactual) would have returned false | _spec_ | _spec_ | n/a | yes | run real `next dev`, time the difference |
| DEM-T10 | Restart-all order | Stop reverse, start forward | 1. all up 2. restartAll() | Stop log: frontend < backend < tunnel (timestamps); start log: tunnel < backend < frontend; no service starts before its dependency reports up | _spec_ | _spec_ | n/a | yes | inspect Eros JSONL with timestamps |

## Overall test-coverage understanding

Demeter owns the **process-supervision contract** for two of the launcher's three long-running children (Boreas owns the SSH tunnel — same PGID-kill pattern applies there). Integration with neighbouring agents:

- **Eros** consumes Demeter's JSONL files; the per-line schema (`{ts, stream, pid, line}`) is Demeter's contract.
- **Janus** owns the formal probe schema (`/healthz` field list, frontend probe spec); Demeter implements against whatever Janus finalises.
- **Calliope** wires `BackendManager` and `FrontendManager` into the SwiftUI view-model layer.
- **Gaia** absorbs DEM-T01..T10 into the master TESTPLAN.

The regression test DEM-T04 is the most important entry in the slice — it directly proves the launcher does not repeat the 2026-04-25 stale-binary trap that motivated `<services>` adding commit comparison.

## Handover note to orchestrator

**Solid:**
- `bash -lc` + PGID-capture-on-launch + `kill(-pgid, …)` is the right pattern. It coexists with the existing AppleScript launcher (which uses `pkill -P` + port-listener kill) without conflict, and it's strictly stronger for grandchildren.
- Stale-commit detection is a byte-for-byte port of `<services>`, so dual-tool users get one truth.
- Retry policy (exp + jitter, 5 attempts) bounds worst-case failure detection at ~38 s for backend, ~68 s for frontend.

**Still uncertain (handover asks):**
1. **Janus** — confirm `/healthz` will stay JSON-shaped through the Phase 3 release work. If the schema gains a top-level wrapper, Demeter's `HealthzResponse` decoder breaks.
2. **Eros** — confirm log-file paths (`~/Library/Logs/MMFFVectorLauncher/{backend,frontend}.jsonl`). Demeter writes raw lines; rotation/tailing is Eros's concern.
3. **Boreas** — agree on the dependency order at startup. Demeter assumes the tunnel actor exposes `await tunnel.up` as a precondition; if Boreas chooses a different surface, BackendManager.start needs the matching await call inserted.
4. **Iris** — confirm hardened-runtime + sandbox entitlements permit `Process` spawning bash and writing to `~/Library/Logs/`. If sandboxed, we need an entitlement exception or move to a launch-agent helper, which would invalidate this design.

**Integrate next:** Calliope (architecture) should consume `BackendManager` + `FrontendManager` actor surfaces; the manager protocol I left as `ServiceManager` is intentionally minimal (`start / stop / restart / state`) so Boreas's `TunnelManager` can conform to the same protocol and the orchestration view-model treats all three uniformly.
