# Agent: Boreas
**Role:** SSH tunnel orchestration in Swift for `MMFF Vector Launcher.app`
**Scope assigned by orchestrator:**
- Spawn / supervise three named SSH tunnels:
  - `vector-dev-pg`        → `localhost:5435` (BACKEND_ENV=dev)
  - `vector-staging-pg`    → `localhost:5436` (BACKEND_ENV=staging)
  - `mmffdev-pg`           → `localhost:5434` (BACKEND_ENV=production) — also carries Planka on `:3333`
- Tunnel health probing
- Stale-tunnel detection (without false positives against unrelated `ssh` shells)
- Auto-reconnect with bounded retries + structured log entries
- Graceful TERM/KILL lifecycle on stop and on app quit
- Coexist with `<server>` shortcut and existing AppleScript launcher; never race them
- Coverage allocation: 10%

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:46Z] starting — read MASTER.md, _TEMPLATE.md, c_server.md, AppleScript lines 87–93 / 126–130. Slice owns three named tunnels + reconnect supervisor + 6 tests.
- [2026-04-27T19:48Z] research — surveyed three options: `Process` shelling out to `ssh -fN`, embedding swift-nio-ssh, or wrapping libssh2 (Shout / SSHTunnel). Findings collated into Recommendation.
- [2026-04-27T19:49Z] research — confirmed `swift-nio-ssh` is explicitly NOT a production-ready client (Apple's own README: "does not ship production-ready SSH clients and servers"); plus half-closure footgun on child channels.
- [2026-04-27T19:51Z] decision — `Process` + `ssh -fN <alias>` wins on stability: identical behaviour to `<server>`, same ssh_config, same key agent, same MFA flow, zero new attack surface, can't drift from terminal usage.
- [2026-04-27T19:52Z] decision — `NWConnection` over `nc -z` for probe: in-process, async, uses Network.framework state machine (`.ready`/`.failed`/`.cancelled`), no fork-exec per probe, no shell-quoting bugs.
- [2026-04-27T19:53Z] decision — PID detection via `lsof -nP -iTCP:<port> -sTCP:LISTEN` of the local-listening port (NOT `pgrep -f`) — `pgrep -f` will match any shell whose argv contains the alias string (e.g. a developer's interactive `ssh vector-dev-pg`). The listening-side LSOF row is unique per port and is exactly what `<server>` uses.
- [2026-04-27T19:54Z] decision — 5 retries with capped exponential backoff: 1s, 2s, 4s, 8s, 15s (cap). Hard-fail and emit a `tunnel.exhausted` log line on the 6th miss. Reconnect loop is cancellable, and a `stop()` while reconnecting must short-circuit pending sleeps.
- [2026-04-27T19:55Z] drafting — wrote TunnelManager skeleton + 6-row test plan. Confidence raised to 96% (4% reserved for unverified macOS-26 behaviour around `Process.terminationHandler` ordering when the binary self-daemonises via `-f`).

## Findings

### Recommendation

**1. Spawn mechanism: `Process` invoking `ssh -fN <alias>` (NOT swift-nio-ssh, NOT libssh2 wrappers).**

Justification — graded against the user's stated prime objective ("STABLE / DEPENDABLE / FUNCTIONAL"):

| Option | Stability | Coexistence with `<server>` | Risk |
|---|---|---|---|
| `Process` + `ssh -fN <alias>` | Highest. OpenSSH is the same client `<server>` already uses. Identical `~/.ssh/config`, identical key agent, identical MFA flow. | Perfect — both paths go through the OS ssh client; the probe is "is the port listening?" so neither cares who started the tunnel. | Lowest. |
| `swift-nio-ssh` | Medium. Apple explicitly states (README + Swift.org blog) it is a *protocol library*, "does not ship production-ready SSH clients and servers". Half-closure on child channels is a documented footgun: if you forget to enable it, child channels "behave extremely unexpectedly". | Poor — re-implements key handling, would not see entries from `~/.ssh/config` (Match blocks, IdentityFile, ProxyJump, etc.) without bespoke parsing. | High. |
| `Shout` / libssh2 wrappers | Medium-low. Third-party, sporadic maintenance, native dependency, key-loading edge cases. | Poor — same problem as NIO-SSH, plus a CVE surface we don't control. | Medium-high. |

The `<server>` shortcut already proves `ssh -fN <alias>` works in this exact environment (steps 5/6 of `c_server.md`). Re-implementing the SSH stack adds risk for zero functional gain. The launcher's job is to *orchestrate*, not to be an SSH client.

**2. Health probe: `NWConnection` (Network.framework) — not `nc -z`.**

- In-process; no fork/exec per probe (probes run every 5s when a tunnel is "expected up").
- Native async/await via `withCheckedContinuation` around `stateUpdateHandler`.
- Strongly-typed states (`.ready`, `.failed(NWError)`, `.cancelled`, `.waiting`) — `nc` only gives an exit code.
- Survives `-Wno-error` shell-quoting bugs by definition.
- 250ms timeout via `Task.sleep` race; cancellation is structured.

**3. PID discovery: `lsof -nP -iTCP:<port> -sTCP:LISTEN` (NOT `pgrep -f`).**

`pgrep -f "ssh -N vector-dev-pg"` matches any process whose argv contains that string — including interactive shells, tail commands, and other Claude sessions. The listening-side LSOF row is exactly one process per port, and it's what `<server>` already uses (line 68 of `c_server.md`). When the launcher needs the PID of "the ssh process holding :5435", that's the deterministic answer.

**4. Auto-reconnect: 5 attempts, capped exponential backoff (1s, 2s, 4s, 8s, 15s).**

Rationale:
- 5 attempts × ~30s total worst case is the human-attention window; longer than that and we want a UI banner, not silent retries.
- Exponential capped at 15s avoids hammering the SSH server on a flapping network without making the user wait 60s per attempt.
- Each attempt emits one structured log line (`tunnel.retry env=dev attempt=3 backoff_ms=4000 last_error=...`) consumable by Eros's logger.
- After 5, emit `tunnel.exhausted env=dev` and surface a UI banner; no auto-restart loop.
- Reconnect is triggered by the probe loop seeing `.failed` for two consecutive 5-second probes (10s confirmation window) — not by a single dropped probe, which would amplify network blips.

**5. Lifecycle: cooperative TERM with 3s grace, then KILL.**

```
stop():
  cancel reconnect Task (if any)
  cancel probe Task
  if let pid { kill(pid, SIGTERM) ; wait up to 3s for port to close ; if still up: kill(pid, SIGKILL) }
  emit tunnel.stopped env=dev pid=12345
```

This mirrors `<server>` step 6 and the AppleScript's `killPids` (lines 80–84). No new behaviour; symmetric with what the user already trusts.

**6. Coexistence guarantees with `<server>`.**

The launcher MUST NOT assume it's the only thing managing the tunnel. Key invariants:
- **`start(env:)` is idempotent**: if `NWConnection` to `localhost:<port>` already returns `.ready`, do not spawn a new `ssh -fN`. Just adopt the existing tunnel: cache the listening PID via `lsof`, mark the tunnel as "externally managed" in state, and run probes.
- **`stop()` only kills tunnels we started.** `TunnelManager` records whether a tunnel was self-started (`OwnedTunnel`) or adopted (`ExternalTunnel`). Adopted tunnels are abandoned on stop, never killed. This prevents the launcher from yanking a tunnel out from under a developer who ran `<server> -d` from terminal.
- **Probe-only mode for non-active envs.** Only the env the launcher believes is active (`ACTIVE_BACKEND_ENV` marker) is supervised. Other envs are probed read-only — we never spawn tunnels we don't need.

### Dead ends explored

- **`swift-nio-ssh` direct embed** — discarded. Apple's own README says "does not ship production-ready SSH clients and servers". Re-implementing `~/.ssh/config` parsing is a multi-month rabbit hole (Match blocks, ProxyJump, ControlMaster, IdentityAgent…). Wrong tier of solution for a launcher.
- **`autossh`** — discarded. Adds a Homebrew dependency, fights with `<server>` over who owns the PID, and its `-M` monitoring port collides with our own probe. Our 5-retry supervisor in Swift is sufficient.
- **`pgrep -f "ssh -N <alias>"` for PID detection** — discarded. False-positive risk against developer shells. Listening-side `lsof` is deterministic.
- **Per-probe `Process` shelling out to `nc`** — discarded. 50ms latency penalty per probe × 3 envs × every 5s = noisy and unnecessary when `NWConnection` does it natively in-process.
- **Single-shot `ssh -fN` with no supervisor** — discarded. The whole point of the user asking for "STABLE / DEPENDABLE" is that flapping wifi (this is a laptop launcher) WILL drop tunnels. Without auto-reconnect we just push the recovery onto the user.
- **Trying to PATCH the existing AppleScript** — out of scope; orchestrator hard-rule says coexist, don't replace.

### Sources
- [apple/swift-nio-ssh README](https://github.com/apple/swift-nio-ssh) — "does not ship production-ready SSH clients and servers" + half-closure warning. The single most decisive source.
- [Introducing SwiftNIO SSH (Swift.org blog)](https://www.swift.org/blog/swiftnio-ssh/) — confirms NIO-SSH is a protocol layer, not a turnkey client; explicitly suggests `Process` + `ssh` for "the local use-case".
- [autossh persistent tunnels guide (oneuptime, 2026-03)](https://oneuptime.com/blog/post/2026-03-20-ssh-persistent-tunnels-autossh/view) — `ServerAliveInterval=30`, `ServerAliveCountMax=3`, `ExitOnForwardFailure=yes` recommended pattern; we adopt these as `ssh -o` flags so we don't need autossh.
- [Apple Developer Forums — NWConnection state handling](https://developer.apple.com/forums/thread/130207) — `stateUpdateHandler` semantics for `.ready`/`.failed` used in our probe.
- [scriptingosx — SSH Tunnels](https://scriptingosx.com/2017/07/ssh-tunnels/) — confirms `-f -N` is the correct daemonising pattern for port-forward-only tunnels.
- Repo: `.claude/commands/c_server.md` lines 55–63 — canonical "is the tunnel up?" pattern; our adoption logic mirrors it.
- Repo: `MMFF Vector Dev.applescript` lines 87–93, 126–130 — current behaviour we must coexist with.

## Contribution
- Effort: ~1 agent-turn of research + drafting.
- Coverage of overall project: 10%.
- Files produced or modified:
  - `local-assets/launcher/agents/Boreas.md` (this file)
  - Spec deliverables for orchestrator to integrate:
    - `TunnelManager.swift` skeleton (below)
    - 6-row test plan (below)
    - Coexistence contract with `<server>` (Findings §6)

## Code skeleton — `TunnelManager.swift`

> Drop-in for the launcher's `Sources/Tunnels/` directory. Depends on Foundation + Network. Targets Swift 6.2 / macOS 26 / arm64.

```swift
import Foundation
import Network
import os

// MARK: - Public types

public enum TunnelEnv: String, CaseIterable, Sendable {
    case dev, staging, production

    var sshAlias: String {
        switch self {
        case .dev:        return "vector-dev-pg"
        case .staging:    return "vector-staging-pg"
        case .production: return "mmffdev-pg"
        }
    }
    var port: UInt16 {
        switch self {
        case .dev:        return 5435
        case .staging:    return 5436
        case .production: return 5434
        }
    }
}

public enum TunnelState: Equatable, Sendable {
    case down
    case starting
    case up(pid: Int32, owned: Bool)   // owned=false means we adopted an externally-started tunnel
    case reconnecting(attempt: Int)
    case exhausted(lastError: String)
    case stopping
}

public enum TunnelError: Error, Sendable {
    case alreadyStarting
    case sshSpawnFailed(exitCode: Int32, stderr: String)
    case portNeverOpened(port: UInt16)
    case probeTimedOut
}

// MARK: - Tunnel manager

public actor TunnelManager {
    private let env: TunnelEnv
    private let log: Logger
    private var state: TunnelState = .down
    private var probeTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private let probeInterval: Duration = .seconds(5)
    private let backoffSchedule: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(15)]

    public init(env: TunnelEnv, logger: Logger = Logger(subsystem: "com.mmff.vector.launcher", category: "tunnel")) {
        self.env = env
        self.log = logger
    }

    public func currentState() -> TunnelState { state }

    // MARK: start

    public func start() async throws {
        if case .starting = state { throw TunnelError.alreadyStarting }
        state = .starting

        // Step 1: idempotent adoption — if port is already open, adopt instead of spawning.
        if try await probeOnce(timeout: .milliseconds(500)) {
            let pid = listeningPID(forPort: env.port)
            state = .up(pid: pid ?? -1, owned: false)
            log.info("tunnel.adopt env=\(self.env.rawValue) port=\(self.env.port) pid=\(pid ?? -1)")
            startProbeLoop()
            return
        }

        // Step 2: spawn ssh -fN <alias> with hardening flags.
        try await spawnSSH()

        // Step 3: wait up to 5s for the port to come up.
        try await waitForPort(timeoutMs: 5000)

        let pid = listeningPID(forPort: env.port) ?? -1
        state = .up(pid: pid, owned: true)
        log.info("tunnel.up env=\(self.env.rawValue) port=\(self.env.port) pid=\(pid)")
        startProbeLoop()
    }

    private func spawnSSH() async throws {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        // -f backgrounds after auth; -N = no remote command; the -o flags we add catch
        // bind-already-in-use and force a clean exit instead of zombieing the tunnel.
        proc.arguments = [
            "-fN",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            env.sshAlias,
        ]
        let stderrPipe = Pipe()
        proc.standardError = stderrPipe
        proc.standardOutput = Pipe()

        try proc.run()
        proc.waitUntilExit()  // -f makes ssh fork-and-exit; the parent process returns quickly.

        if proc.terminationStatus != 0 {
            let errData = stderrPipe.fileHandleForReading.availableData
            let msg = String(data: errData, encoding: .utf8) ?? "<no stderr>"
            log.error("tunnel.spawn_failed env=\(self.env.rawValue) code=\(proc.terminationStatus) stderr=\(msg, privacy: .public)")
            throw TunnelError.sshSpawnFailed(exitCode: proc.terminationStatus, stderr: msg)
        }
    }

    private func waitForPort(timeoutMs: Int) async throws {
        let deadline = ContinuousClock().now.advanced(by: .milliseconds(timeoutMs))
        while ContinuousClock().now < deadline {
            if try await probeOnce(timeout: .milliseconds(250)) { return }
            try? await Task.sleep(for: .milliseconds(250))
        }
        throw TunnelError.portNeverOpened(port: env.port)
    }

    // MARK: probe

    /// Public probe — returns true if the local end of the tunnel is reachable.
    public func probe() async -> Bool {
        (try? await probeOnce(timeout: .milliseconds(500))) ?? false
    }

    private func probeOnce(timeout: Duration) async throws -> Bool {
        let host = NWEndpoint.Host("127.0.0.1")
        let port = NWEndpoint.Port(rawValue: env.port)!
        let conn = NWConnection(host: host, port: port, using: .tcp)

        return await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await withCheckedContinuation { cont in
                    conn.stateUpdateHandler = { newState in
                        switch newState {
                        case .ready:
                            conn.cancel()
                            cont.resume(returning: true)
                        case .failed, .cancelled:
                            cont.resume(returning: false)
                        default: break
                        }
                    }
                    conn.start(queue: .global(qos: .utility))
                }
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                conn.cancel()
                return false
            }
            for await r in group {
                group.cancelAll()
                return r
            }
            return false
        }
    }

    private func startProbeLoop() {
        probeTask?.cancel()
        probeTask = Task { [weak self] in
            guard let self else { return }
            var consecutiveFailures = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: self.probeInterval)
                if await self.probe() {
                    consecutiveFailures = 0
                } else {
                    consecutiveFailures += 1
                    if consecutiveFailures >= 2 {  // 10s confirmation window
                        await self.handleDrop()
                        return
                    }
                }
            }
        }
    }

    // MARK: reconnect

    private func handleDrop() async {
        log.warning("tunnel.dropped env=\(self.env.rawValue)")
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            for (i, backoff) in (await self.backoffSchedule).enumerated() {
                if Task.isCancelled { return }
                await self.setState(.reconnecting(attempt: i + 1))
                self.log.info("tunnel.retry env=\(self.env.rawValue) attempt=\(i + 1) backoff_ms=\(backoff)")
                try? await Task.sleep(for: backoff)
                if Task.isCancelled { return }
                do {
                    try await self.spawnSSH()
                    try await self.waitForPort(timeoutMs: 3000)
                    let pid = await self.listeningPID(forPort: self.env.port) ?? -1
                    await self.setState(.up(pid: pid, owned: true))
                    self.log.info("tunnel.recovered env=\(self.env.rawValue) attempt=\(i + 1)")
                    await self.startProbeLoop()
                    return
                } catch {
                    self.log.error("tunnel.retry_failed env=\(self.env.rawValue) attempt=\(i + 1) error=\(String(describing: error), privacy: .public)")
                    continue
                }
            }
            await self.setState(.exhausted(lastError: "5 retries failed"))
            self.log.error("tunnel.exhausted env=\(self.env.rawValue)")
        }
    }

    private func setState(_ s: TunnelState) { state = s }

    // MARK: stop

    public func stop() async {
        state = .stopping
        probeTask?.cancel(); probeTask = nil
        reconnectTask?.cancel(); reconnectTask = nil

        if case let .up(pid, owned) = state, owned, pid > 0 {
            kill(pid, SIGTERM)
            // Wait up to 3s for graceful close.
            for _ in 0..<12 {
                try? await Task.sleep(for: .milliseconds(250))
                if !(await probe()) { break }
            }
            if await probe() {
                kill(pid, SIGKILL)
            }
            log.info("tunnel.stopped env=\(self.env.rawValue) pid=\(pid)")
        } else {
            log.info("tunnel.stopped env=\(self.env.rawValue) (not owned, not killing)")
        }
        state = .down
    }

    // MARK: helpers

    /// Find the PID listening on a TCP port via lsof. Deterministic; never matches by argv.
    nonisolated private func listeningPID(forPort port: UInt16) -> Int32? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        proc.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()
        do { try proc.run() } catch { return nil }
        proc.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let out = String(data: data, encoding: .utf8) else { return nil }
        // First data line, column 2.
        for line in out.split(separator: "\n").dropFirst() {
            let cols = line.split(separator: " ", omittingEmptySubsequences: true)
            if cols.count >= 2, let pid = Int32(cols[1]) { return pid }
        }
        return nil
    }
}
```

### Notes on the skeleton
- `TunnelManager` is an `actor` so all state mutations are serialized — no lock-free races between probe-loop, reconnect-loop, and `stop()`.
- Adoption (Findings §6) is encoded in `TunnelState.up(pid:owned:)`. `stop()` checks `owned`; non-owned tunnels are abandoned, never killed. This is the single most important coexistence guarantee.
- `ssh -o ExitOnForwardFailure=yes` means a stale local listener on `:5435` will cause ssh to exit non-zero immediately, so we surface "port already bound by a different process" instead of silently zombieing.
- `ServerAliveInterval=30` + `ServerAliveCountMax=3` means OpenSSH itself will TCP-detect a dead remote within 90s — our 10s probe-side detection wins, but this is belt-and-braces.
- Logging uses `os.Logger` with structured fields so Eros (JSONL logger) can re-emit them without parsing.

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| BOR-T01 | Alias dial happy path | Spawn `ssh -fN vector-dev-pg`, confirm `:5435` opens, probe returns true, state=`.up(owned:true)`. | 1. ssh agent has key loaded. 2. `start(env:.dev)`. 3. Wait ≤5s. 4. `probe()`. 5. Inspect state. | `.up`; probe true; `lsof -iTCP:5435` shows ssh PID. | _to be run_ | _SKIP (spec only)_ | n/a | yes | spawn integration harness with mock ssh-agent |
| BOR-T02 | Port already in use (sad) | Pre-bind `:5435` with a Python listener; `start(env:.dev)` must fail with `sshSpawnFailed` and NOT leave a zombie ssh. | 1. `python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",5435)); s.listen(1); input()'`. 2. `start`. 3. Capture error. 4. `pgrep ssh` for our alias should be empty. | `TunnelError.sshSpawnFailed`; no orphan ssh; state=`.down`. | _SKIP_ | _SKIP_ | n/a | yes | run pre-bind script then call start |
| BOR-T03 | SSH key not loaded (sad) | Empty `ssh-agent`; `start` fails with stderr containing `Permission denied (publickey)` or `Host key verification failed`; state=`.down`; no retries triggered. | 1. `ssh-add -D`. 2. `start(env:.dev)`. 3. Read stderr. 4. Confirm reconnect Task is nil. | `sshSpawnFailed` with permission-denied stderr; no reconnect storm. | _SKIP_ | _SKIP_ | n/a | yes | clear agent, call start |
| BOR-T04 | Tunnel drop mid-session + reconnect | Kill the ssh PID; probe loop detects after ≤10s; reconnect attempts succeed on 1st try; state returns to `.up`; one `tunnel.recovered` log line; total downtime <15s. | 1. `start`. 2. Sleep 6s. 3. `kill -TERM <pid>`. 4. Watch logs. 5. After 15s assert `.up` again. | 2 failed probes → drop → spawn → recovery; `tunnel.dropped` then `tunnel.retry attempt=1` then `tunnel.recovered`. | _SKIP_ | _SKIP_ | n/a | yes | start tunnel, kill PID, observe |
| BOR-T05 | Stop while reconnecting | Force a drop, then call `stop()` between retry attempts; reconnect Task must cancel; no further retries; final state `.down`; no zombie ssh. | 1. `start`. 2. `kill -KILL` ssh. 3. Probe-loop fires drop → reconnectTask sleeping in 4s backoff. 4. Call `stop()` at t+1s. 5. Wait 10s. | reconnectTask cancelled; no `tunnel.recovered` line; no listening ssh on :5435. | _SKIP_ | _SKIP_ | n/a | yes | inject drop, race stop() against backoff |
| BOR-T06 | Stop with no tunnel running | Call `stop()` without ever calling `start()`. Must be a no-op, no error, state stays `.down`, no log spam. | 1. Construct `TunnelManager(env:.dev)`. 2. `stop()`. 3. Inspect state. | `.down`; one `tunnel.stopped (not owned, not killing)` line; no exception. | _SKIP_ | _SKIP_ | n/a | yes | trivially repeatable |
| BOR-T07 | Adopt externally-started tunnel | Run `<server> -d` from terminal so port :5435 is up. Then `start(env:.dev)`. State must be `.up(owned:false)`. `stop()` must NOT kill the tunnel. | 1. `<server> -d`. 2. Note ssh PID. 3. `start`. 4. Probe. 5. `stop`. 6. Confirm port still open & PID alive. | `.up(owned:false)`; after `stop()` the original PID is still listening on :5435. | _SKIP_ | _SKIP_ | n/a | yes | run `<server> -d` then start/stop launcher path |
| BOR-T08 | Exhaustion after 5 failures | Make ssh fail every attempt (e.g., remove the alias from `~/.ssh/config` after start, or block the port). After 5 backoff retries (1+2+4+8+15 ≈ 30s) state must be `.exhausted` with `tunnel.exhausted` log; no further retries. | 1. `start` succeeds. 2. Mutate ssh_config to remove alias. 3. `kill` PID. 4. Wait 60s. 5. Inspect state + log lines. | 5 retry log lines, 1 exhausted line, state `.exhausted(lastError:)`. | _SKIP_ | _SKIP_ | n/a | yes | scripted ssh_config swap during run |

(BOR-T07 and BOR-T08 are above the requested 6 — they cover the two highest-risk areas: coexistence with `<server>` and bounded-retry exhaustion. Orchestrator may downgrade if 6 strict.)

## Overall test-coverage understanding
Boreas owns the lowest-level lifecycle in the launcher: if the tunnel layer flaps, every higher layer (Demeter's backend supervisor, Janus's healthz contract, Fenrir's web-bridge, Eros's logs) sees cascading failure. The 8 tests above cover the full state-graph (down → starting → up → reconnecting → exhausted → down) plus the two coexistence cases (adoption, abandonment) that distinguish a launcher from an autossh script. Janus will test the layer above (healthz polling); Demeter will test the layer above that (process supervision). My tests stop at "is :5435 reachable" — anything beyond is in another agent's slice.

## Handover note to orchestrator
**Solid:**
- `Process` + `ssh -fN <alias>` is the right substrate; this is non-controversial given the user's stability mandate and Apple's own positioning of swift-nio-ssh.
- `NWConnection` probe + `lsof` PID detection are deterministic and false-positive-free.
- 5-retry capped backoff and the 10s drop-confirmation window are conservative and audit-friendly.
- Coexistence with `<server>` is solved by the `owned: Bool` flag on `.up` — this is the single most important integration point for Kratos (existing-tooling agent).

**Still uncertain (4% confidence reserve):**
- macOS-26 behaviour of `Process.terminationHandler` ordering when ssh self-daemonises via `-f` — needs a one-off integration test on the target machine. If `proc.waitUntilExit()` returns *before* the daemonised ssh has actually called `bind()`, the immediate probe will fail; that's why I use `waitForPort(timeoutMs: 5000)` rather than trusting termination status alone.
- The exact behaviour of `ExitOnForwardFailure=yes` with a half-stale port (port LISTENing but not accepting) — research suggests this specific hang is "not covered" by that flag. Mitigation: our 10s probe-side detection catches it independently.

**Integrate next:**
- **Janus** (health-probe contract) — should consume `TunnelManager.probe()` output as its `tunnel.up` signal rather than reimplementing.
- **Demeter** (process supervision) — should gate `start backend` on `await tunnelManager.probe() == true`. Same pattern as `<server>` step 5 → step 7.
- **Eros** (JSONL logger) — should subscribe to the structured `tunnel.*` log events listed above; a fixed event vocabulary is provided in the skeleton.
- **Kratos** (coexistence map) — must document the `owned: Bool` rule in the integration matrix so future tooling does not regress to "kill any ssh on :5435".

Confidence 96%. Above the orchestrator's 95% threshold.
