// BackendManager.swift — Demeter's Go backend supervisor.
//
// Spawn: `make dev` inside backend/. `make dev` invokes `air -c .air.toml`
// which compiles + runs the server AND watches the source tree — when a
// .go file changes, air rebuilds and restarts the server in <2s with no
// launcher round-trip. The launcher's job shrinks to: spawn once, observe
// /healthz, surface state. Code changes do NOT require a launcher click.
// Probe: /healthz JSON status:"ok"; readiness budget 60s (covers air's
// first cold compile ~5–15s; warm rebuilds are sub-second).
// Stop: PGID kill (SIGTERM → 3s → SIGKILL) + lsof sweep on :5100. The
// PGID kill takes down both `air` and its child Go binary in one go.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor BackendManager {
    private(set) var state: ServiceState = .down
    private(set) var env: BackendEnv
    private var pgid: Int32 = -1
    private let port: UInt16 = 5100

    init(env: BackendEnv = .production) { self.env = env }
    private let policy = RetryPolicy.backend
    private var watcherTask: Task<Void, Never>?

    func setEnv(_ e: BackendEnv) { self.env = e }

    func start(allowAdopt: Bool = true) async {
        if case .up      = state { return }
        if case .starting = state { return }
        state = .starting

        // Adopt running backend if /healthz answers — but only on cold start.
        // restart() passes allowAdopt:false so it never re-adopts the very PID
        // it was supposed to replace (which would silently keep the stale
        // binary running and make Restart Backend a no-op).
        let healthURL = URL(string: "http://127.0.0.1:\(port)/healthz")!
        if allowAdopt {
            let probe = await HealthProbe.httpHealthz(url: healthURL, expectCommitMatch: false, timeout: 1.0)
            if probe.ok {
                let pid = ProcessSupervisor.listeningPIDs(on: port).first ?? -1
                state = .up(pid: pid, owned: false)
                await JSONLLogger.shared.log(LogEntry(
                    level: .info, tag: .backend, action: "adopt",
                    result: "ok", extra: ["pid": "\(pid)", "env": env.rawValue]
                ))
                startWatcher()
                return
            }
        }

        // Spawn `make dev` (which runs air). The launcher only spawns; air
        // owns rebuild-on-edit forever after. PATH augmented with /Users/rick/go/bin
        // so `make install-air` (target dependency in Makefile) finds the binary
        // on a clean machine, and so make itself can find air on first run.
        let backendDir = shellEscape(Paths.repoRoot.appendingPathComponent("backend").path)
        let goBin = shellEscape(NSHomeDirectory() + "/go/bin")
        let cmd = "cd \(backendDir) && export PATH=\(goBin):/opt/homebrew/bin:/usr/local/bin:$PATH && make dev"
        let envVars = ["BACKEND_ENV": env.rawValue]

        for attempt in 0..<policy.maxAttempts {
            do {
                let r = try await ProcessSupervisor.spawn(
                    bashLogin: cmd, cwd: Paths.repoRoot, env: envVars, logTag: .backend)
                self.pgid = r.pgid

                // 60s grace — covers air's first compile (~5–15s) + server boot.
                // Subsequent warm rebuilds happen in-process inside air and never
                // hit this budget, because the launcher spawns once and stays out.
                let deadline = Date().addingTimeInterval(60)
                while Date() < deadline {
                    let p = await HealthProbe.httpHealthz(url: healthURL, expectCommitMatch: false, timeout: 1.5)
                    if p.ok {
                        state = .up(pid: r.pid, owned: true)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .info, tag: .backend, action: "start",
                            result: "ok", extra: ["pid": "\(r.pid)", "env": env.rawValue]
                        ))
                        startWatcher()
                        return
                    }
                    if let f = p.failure, f.isTerminal {
                        state = .failed(reason: f.rawValue)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .error, tag: .backend, action: "start",
                            result: "terminal", extra: ["failure": f.rawValue, "detail": p.detail ?? ""]
                        ))
                        return
                    }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
                // Probe budget exhausted; kill spawn and retry
                await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: .backend)
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .backend, action: "spawn",
                    result: "err", extra: ["err": "\(error)"]
                ))
            }
            try? await Task.sleep(nanoseconds: policy.nanoseconds(forAttempt: attempt))
        }

        state = .failed(reason: "backend start exceeded retry budget")
        await JSONLLogger.shared.log(LogEntry(
            level: .error, tag: .backend, action: "start", result: "fail"
        ))
    }

    func stop() async {
        watcherTask?.cancel()
        watcherTask = nil
        switch state {
        case .up(_, let owned):
            if owned, pgid > 1 {
                await ProcessSupervisor.killGroup(pgid: pgid, logTag: .backend)
            }
            await ProcessSupervisor.sweepPort(port, logTag: .backend)
            state = .down
            pgid = -1
        default:
            // Even when state is .down, sweep the port — an adopted process
            // we never owned may still be listening. Without this, restart()
            // can re-adopt the very PID it was supposed to replace.
            await ProcessSupervisor.sweepPort(port, logTag: .backend)
            state = .down
        }
        // Wait for the kernel to release :5100 before returning. Up to 5s in
        // 100ms increments. If we don't wait, start()'s spawn races the
        // listener and may bind-fail (or worse, re-adopt the dying process).
        for _ in 0..<50 {
            if ProcessSupervisor.listeningPIDs(on: port).isEmpty { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    func restart() async {
        await stop()
        // allowAdopt:false guarantees a fresh compile-and-spawn; without
        // this, a slow-dying old process could answer /healthz during the
        // start probe and get re-adopted, defeating the restart.
        await start(allowAdopt: false)
    }

    // Observer mode: air owns rebuild-on-edit and is the primary supervisor.
    // The launcher just watches /healthz and only intervenes if air itself
    // appears dead — i.e. the backend stays unreachable for 6 consecutive
    // probes (~30s). A normal compile-and-restart cycle inside air takes
    // <2s and never trips this; only a crash air can't recover from does.
    private func startWatcher() {
        watcherTask?.cancel()
        watcherTask = Task { [port] in
            let url = URL(string: "http://127.0.0.1:\(port)/healthz")!
            var consecutive = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                let r = await HealthProbe.httpHealthz(url: url, expectCommitMatch: false, timeout: 2.0)
                if r.ok { consecutive = 0; continue }
                consecutive += 1
                if consecutive >= 6 {
                    await self.handleCrash()
                    return
                }
            }
        }
    }

    private func handleCrash() async {
        state = .restarting
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: .backend, action: "crash", result: "detected"
        ))
        if await LockRegistry.shared.isLocked(env: env, kind: .backend) {
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .backend, action: "auto-restart",
                result: "skipped-locked", extra: ["env": env.rawValue]
            ))
            state = .down
            return
        }
        await restart()
    }

    private nonisolated func shellEscape(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
