// FrontendManager.swift — Demeter's Next.js dev-server supervisor.
//
// Spawn: /bin/bash -lc 'npm run dev -- -p 5101' from repo root.
// Probe: TCP :5101 first (Next dev returns 404 on / until first compile),
//        then text/html readiness; 60s budget.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor FrontendManager {
    private(set) var state: ServiceState = .down
    private var pgid: Int32 = -1
    private let port: UInt16 = 5101
    private let policy = RetryPolicy.frontend
    private var watcherTask: Task<Void, Never>?

    func start() async {
        if case .up = state { return }
        state = .starting

        // Adopt running frontend if port answers HTML
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        if (await HealthProbe.htmlReady(url: url, timeout: 1.0)).ok {
            let pid = ProcessSupervisor.listeningPIDs(on: port).first ?? -1
            state = .up(pid: pid, owned: false)
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .frontend, action: "adopt", result: "ok",
                extra: ["pid": "\(pid)"]
            ))
            startWatcher()
            return
        }

        let cmd = "npm run dev -- -p \(port)"

        for attempt in 0..<policy.maxAttempts {
            do {
                let r = try await ProcessSupervisor.spawn(
                    bashLogin: cmd, cwd: Paths.repoRoot, env: [:], logTag: .frontend)
                self.pgid = r.pgid

                // Phase 1 — wait for port (60s)
                let portDeadline = Date().addingTimeInterval(60)
                var portOk = false
                while Date() < portDeadline {
                    let p = await HealthProbe.portListen(host: "127.0.0.1", port: port, timeout: 1.0)
                    if p.ok { portOk = true; break }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
                if !portOk {
                    await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: .frontend)
                    continue
                }

                // Phase 2 — wait for text/html (another 60s)
                let htmlDeadline = Date().addingTimeInterval(60)
                while Date() < htmlDeadline {
                    let p = await HealthProbe.htmlReady(url: url, timeout: 2.0)
                    if p.ok {
                        state = .up(pid: r.pid, owned: true)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .info, tag: .frontend, action: "start",
                            result: "ok", extra: ["pid": "\(r.pid)"]
                        ))
                        startWatcher()
                        return
                    }
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
                await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: .frontend)
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .frontend, action: "spawn",
                    result: "err", extra: ["err": "\(error)"]
                ))
            }
            try? await Task.sleep(nanoseconds: policy.nanoseconds(forAttempt: attempt))
        }
        state = .failed(reason: "frontend start exceeded retry budget")
    }

    func stop() async {
        watcherTask?.cancel()
        watcherTask = nil
        switch state {
        case .up(_, let owned):
            if owned, pgid > 1 {
                await ProcessSupervisor.killGroup(pgid: pgid, logTag: .frontend)
            }
            await ProcessSupervisor.sweepPort(port, logTag: .frontend)
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
            let url = URL(string: "http://127.0.0.1:\(port)/")!
            var consecutive = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                let r = await HealthProbe.htmlReady(url: url, timeout: 2.0)
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
            level: .warn, tag: .frontend, action: "crash", result: "detected"
        ))
        await restart()
    }
}
