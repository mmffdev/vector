// BackendManager.swift — Demeter's Go backend supervisor.
//
// Spawn: /bin/bash -lc 'BACKEND_ENV=<env> go run ./cmd/server' inside backend/.
// Probe: /healthz JSON status:"ok"; readiness budget 30s.
// Stop: PGID kill (SIGTERM → 3s → SIGKILL) + lsof sweep on :5100.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor BackendManager {
    private(set) var state: ServiceState = .down
    private(set) var env: BackendEnv = .dev
    private var pgid: Int32 = -1
    private let port: UInt16 = 5100
    private let policy = RetryPolicy.backend
    private var watcherTask: Task<Void, Never>?

    func setEnv(_ e: BackendEnv) { self.env = e }

    func start() async {
        if case .up = state { return }
        state = .starting

        // Adopt running backend if /healthz answers
        let healthURL = URL(string: "http://127.0.0.1:\(port)/healthz")!
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

        let cmd = "cd \(shellEscape(Paths.repoRoot.appendingPathComponent("backend").path)) && go run ./cmd/server"
        let envVars = ["BACKEND_ENV": env.rawValue]

        for attempt in 0..<policy.maxAttempts {
            do {
                let r = try await ProcessSupervisor.spawn(
                    bashLogin: cmd, cwd: Paths.repoRoot, env: envVars, logTag: .backend)
                self.pgid = r.pgid

                // Probe up to 30s
                let deadline = Date().addingTimeInterval(30)
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
            state = .down
        }
    }

    func restart() async {
        await stop()
        await start()
    }

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
                if consecutive >= 3 {
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
        await restart()
    }

    private nonisolated func shellEscape(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
