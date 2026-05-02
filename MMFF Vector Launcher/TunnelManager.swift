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
    private(set) var env: BackendEnv
    private let policy = RetryPolicy.tunnel
    private var watcherTask: Task<Void, Never>?

    init(env: BackendEnv = .production) { self.env = env }
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
            // Fix C: primary liveness = kill -0 on the SSH pid (process alive).
            // Secondary = TCP connect on tunnel port, checked every 60s with 5s
            // timeout. Only declare drop when primary fails OR secondary fails
            // twice in a row. This prevents false-drops from transient TCP stalls.
            var tcpConsecutiveFail = 0
            var lastTCPCheck = Date.distantPast
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000) // wake every 15s

                // Primary: is the SSH process still alive?
                let pid: Int32
                switch await self.currentPID() {
                case let p where p > 1:
                    pid = p
                default:
                    // No valid PID tracked — fall through to TCP-only check
                    pid = -1
                }
                if pid > 1 && kill(pid, 0) != 0 {
                    // kill -0 failed → process is definitely gone
                    await self.handleDrop()
                    return
                }

                // Secondary: TCP probe every 60s
                let now = Date()
                guard now.timeIntervalSince(lastTCPCheck) >= 60 else { continue }
                lastTCPCheck = now
                let r = await HealthProbe.portListen(
                    host: "127.0.0.1", port: env.tunnelPort, timeout: 5.0)
                if r.ok {
                    tcpConsecutiveFail = 0
                } else {
                    tcpConsecutiveFail += 1
                    if tcpConsecutiveFail >= 2 {
                        await self.handleDrop()
                        return
                    }
                }
            }
        }
    }

    /// Extract the PID from the current state without leaving actor isolation.
    private func currentPID() async -> Int32 {
        if case .up(let pid, _) = state { return pid }
        return -1
    }

    private func handleDrop() async {
        state = .dropped
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: .tunnel, action: "drop", result: "detected"
        ))
        if await LockRegistry.shared.isLocked(env: env, kind: .tunnel) {
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .tunnel, action: "auto-restart",
                result: "skipped-locked", extra: ["env": env.rawValue]
            ))
            return
        }
        await restart()
    }
}
