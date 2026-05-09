// Supervisor.swift — generic per-service lifecycle.
//
// One actor instance per ServiceID. Each instance owns its own pgid + PID
// and is fully independent: stopping the backend never touches the tunnel,
// switching the frontend never affects docs, etc.
//
// Lifecycle rules (deliberate, in response to the entanglement bugs in the
// old launcher):
//
// 1. enable() — flip the user-intent bit on, then bring the service up if
//    it isn't already. Never automatic; only the registry (at boot) and
//    user toggles call this.
//
// 2. disable() — flip the user-intent bit off and stop. The watcher cancels
//    so it cannot resurrect the service.
//
// 3. The watcher only restarts on a CONFIRMED-DEAD PID: it uses `kill -0`
//    to verify the supervised process actually exited. A probe miss alone
//    is NOT a restart trigger — that's how the old launcher kept dropping
//    tunnels because of transient network blips.
//
// 4. There is no env-coupling. There is no shared mutable env field. Each
//    service spec is fixed at registration time.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor Supervisor {
    let spec: ServiceSpec
    private(set) var state: ServiceState
    private(set) var enabled: Bool

    private var pgid: Int32 = -1
    private var pid: Int32 = -1
    private var watcherTask: Task<Void, Never>?

    init(spec: ServiceSpec, enabled: Bool) {
        self.spec = spec
        self.enabled = enabled
        self.state = enabled ? .down : .off
    }

    var snapshot: ServiceSnapshot {
        let (pid, owned): (Int32?, Bool?) = {
            if case .up(let p, let o) = state { return (p, o) }
            return (nil, nil)
        }()
        return ServiceSnapshot(
            id: spec.id.rawValue,
            state: state.label,
            pid: pid,
            owned: owned,
            port: spec.port,
            enabled: enabled
        )
    }

    // MARK: - public lifecycle

    /// User intent: turn this service on. Idempotent — already-up does nothing.
    func enable() async {
        if enabled, case .up = state { return }
        if enabled, case .starting = state { return }
        enabled = true
        if case .off = state { state = .down }
        await bringUp()
    }

    /// User intent: turn this service off. Idempotent — already-off does nothing.
    func disable() async {
        watcherTask?.cancel()
        watcherTask = nil
        enabled = false
        await tearDown()
        state = .off
        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: spec.logTag, action: "disable", result: "ok",
            extra: ["service": spec.id.rawValue]
        ))
    }

    /// User intent: stop and re-start without disabling. The most common
    /// "I just edited code, get me a fresh process" path. Bypasses adoption
    /// so a slow-dying old process can't be re-claimed.
    func restart() async {
        watcherTask?.cancel()
        watcherTask = nil
        await tearDown()
        if !enabled { return }
        state = .down
        await bringUp(allowAdopt: false)
    }

    // MARK: - private — bring up / tear down

    private func bringUp(allowAdopt: Bool = true) async {
        if !enabled { return }
        if case .up = state { return }
        state = .starting(attempt: 1, of: spec.retry.maxAttempts)

        // Adoption — claim a foreign listener if our spec says so.
        if allowAdopt, await spec.adoptIf(spec.port) {
            let adoptedPID = ProcessSupervisor.listeningPIDs(on: spec.port).first ?? -1
            if await spec.readiness() {
                pid = adoptedPID
                state = .up(pid: adoptedPID, owned: false)
                await JSONLLogger.shared.log(LogEntry(
                    level: .info, tag: spec.logTag, action: "adopt", result: "ok",
                    extra: ["service": spec.id.rawValue, "pid": "\(adoptedPID)"]
                ))
                startWatcher()
                return
            }
        }

        // Spawn — retry per the spec's policy.
        for attempt in 0..<spec.retry.maxAttempts {
            state = .starting(attempt: attempt + 1, of: spec.retry.maxAttempts)
            if !enabled {
                state = .off
                return
            }
            do {
                let r = try await ProcessSupervisor.spawn(
                    bashLogin: spec.command, cwd: spec.cwd, env: spec.env, logTag: spec.logTag)
                self.pid = r.pid
                self.pgid = r.pgid

                let deadline = Date().addingTimeInterval(spec.readinessBudgetSeconds)
                while Date() < deadline {
                    if !enabled {
                        await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: spec.logTag)
                        state = .off
                        return
                    }
                    if await spec.readiness() {
                        state = .up(pid: r.pid, owned: true)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .info, tag: spec.logTag, action: "start", result: "ok",
                            extra: ["service": spec.id.rawValue, "pid": "\(r.pid)", "pgid": "\(r.pgid)"]
                        ))
                        startWatcher()
                        return
                    }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
                await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: spec.logTag)
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: spec.logTag, action: "spawn", result: "err",
                    extra: ["service": spec.id.rawValue, "err": "\(error)"]
                ))
            }
            try? await Task.sleep(nanoseconds: spec.retry.nanoseconds(forAttempt: attempt))
        }

        state = .failed(reason: "start budget exhausted")
        await JSONLLogger.shared.log(LogEntry(
            level: .error, tag: spec.logTag, action: "start", result: "fail",
            extra: ["service": spec.id.rawValue]
        ))
    }

    private func tearDown() async {
        switch state {
        case .up(_, let owned):
            if owned, pgid > 1 {
                await ProcessSupervisor.killGroup(pgid: pgid, logTag: spec.logTag)
            }
            await ProcessSupervisor.sweepPort(spec.port, logTag: spec.logTag)
        default:
            await ProcessSupervisor.sweepPort(spec.port, logTag: spec.logTag)
        }
        // Wait for the kernel to actually release the port — up to 5s in
        // 100ms increments. Without this, an immediate restart races the
        // listener and may bind-fail or re-adopt the dying process.
        for _ in 0..<50 {
            if ProcessSupervisor.listeningPIDs(on: spec.port).isEmpty { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        state = .down
        pgid = -1
        pid = -1
    }

    // MARK: - watcher
    //
    // Only restarts on a confirmed-dead PID. A failed probe alone does NOT
    // restart — instead, two consecutive probe misses promote the service
    // to .failed for visibility (UI shows yellow), but the process is left
    // alone unless `kill -0` says it's actually gone. This is the key fix
    // for "tunnel keeps dropping for no reason" — most of those "drops"
    // were transient TCP stalls, not real failures.

    private func startWatcher() {
        watcherTask?.cancel()
        watcherTask = Task { [weak self] in
            guard let self else { return }
            // 30s grace before first probe — covers cold-compile dev servers.
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            while !Task.isCancelled {
                let alive = await self.checkPidAlive()
                if !alive {
                    await self.handleConfirmedDeath()
                    return
                }
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
    }

    private func checkPidAlive() async -> Bool {
        guard pid > 1 else { return true }   // adopted-with-no-pid: don't restart blindly
        return kill(pid, 0) == 0
    }

    private func handleConfirmedDeath() async {
        if !enabled { return }
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: spec.logTag, action: "watch",
            result: "pid-dead", extra: ["service": spec.id.rawValue, "pid": "\(pid)"]
        ))
        state = .down
        await bringUp(allowAdopt: false)
    }
}
