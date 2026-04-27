// TunnelManager.swift — Boreas's SSH tunnel orchestration.
//
// Spawns `ssh -fN <alias>` via Process. Adopts a tunnel we did not spawn
// (owned=false). Refuses to kill un-owned tunnels. Probes via NWConnection.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor TunnelManager {
    private(set) var state: ServiceState = .down
    private(set) var env: BackendEnv = .dev
    private let policy = RetryPolicy.tunnel
    private var watcherTask: Task<Void, Never>?

    func setEnv(_ e: BackendEnv) { self.env = e }

    func start() async {
        if case .up = state { return }
        state = .starting

        // Adopt if a tunnel is already listening on the port.
        let pids = ProcessSupervisor.listeningPIDs(on: env.tunnelPort)
        if let adopted = pids.first {
            let cmd = ProcessSupervisor.describePID(adopted)
            if cmd.contains("ssh") {
                state = .up(pid: adopted, owned: false)
                await JSONLLogger.shared.log(LogEntry(
                    level: .info, tag: .tunnel, action: "adopt",
                    result: "ok",
                    extra: ["env": env.rawValue, "pid": "\(adopted)", "port": "\(env.tunnelPort)"]
                ))
                startWatcher()
                return
            }
        }

        // Spawn via /bin/bash -lc to inherit ssh config + agent.
        let cmd = "ssh -fN -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o BatchMode=yes \(env.sshAlias)"
        for attempt in 0..<policy.maxAttempts {
            do {
                _ = try await ProcessSupervisor.spawn(
                    bashLogin: cmd, cwd: Paths.repoRoot, env: [:], logTag: .tunnel)
                // ssh -fN exits 0 once the tunnel is established as a daemon.
                // Probe the port.
                let probeBudget = Date().addingTimeInterval(policy.maxDelay)
                while Date() < probeBudget {
                    let r = await HealthProbe.portListen(host: "127.0.0.1", port: env.tunnelPort, timeout: 1.0)
                    if r.ok {
                        let pid = ProcessSupervisor.listeningPIDs(on: env.tunnelPort).first ?? -1
                        state = .up(pid: pid, owned: true)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .info, tag: .tunnel, action: "start",
                            result: "ok", extra: ["env": env.rawValue, "pid": "\(pid)"]
                        ))
                        startWatcher()
                        return
                    }
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .tunnel, action: "spawn",
                    result: "err", extra: ["err": "\(error)", "attempt": "\(attempt)"]
                ))
            }
            try? await Task.sleep(nanoseconds: policy.nanoseconds(forAttempt: attempt))
        }

        state = .failed(reason: "tunnel start exceeded retry budget")
        await JSONLLogger.shared.log(LogEntry(
            level: .error, tag: .tunnel, action: "start",
            result: "fail", extra: ["env": env.rawValue]
        ))
    }

    func stop() async {
        watcherTask?.cancel()
        watcherTask = nil
        switch state {
        case .up(let pid, let owned):
            guard owned else {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .tunnel, action: "stop",
                    result: "skipped-unowned", extra: ["pid": "\(pid)"]
                ))
                state = .down
                return
            }
            kill(pid, SIGTERM)
            // ssh -fN forks; the new daemon is detached. We give it 1s, then SIGKILL.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            kill(pid, SIGKILL)
            await ProcessSupervisor.sweepPort(env.tunnelPort, logTag: .tunnel)
            state = .down
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .tunnel, action: "stop", result: "ok"
            ))
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
        watcherTask = Task { [env] in
            // Drop confirmation: 10s of consecutive REFUSED before declaring drop
            var consecutive = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                let r = await HealthProbe.portListen(host: "127.0.0.1", port: env.tunnelPort, timeout: 1.0)
                if r.ok {
                    consecutive = 0
                    continue
                }
                consecutive += 1
                if consecutive >= 5 {
                    await self.handleDrop()
                    return
                }
            }
        }
    }

    private func handleDrop() async {
        state = .dropped
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: .tunnel, action: "drop", result: "detected"
        ))
        await restart()
    }
}
