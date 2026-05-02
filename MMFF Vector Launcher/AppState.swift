// AppState.swift — observable façade the SwiftUI dashboard binds to.
// Polls the actor-isolated managers on a 1-second timer and republishes
// snapshots on the main actor. Locks are persisted via LockRegistry
// (UserDefaults-backed) and survive app relaunch.
import Combine
import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    let orchestrator = Orchestrator()

    @Published var currentEnv: BackendEnv = .production
    @Published var tunnelLabel: String = "down"
    @Published var backendLabel: String = "down"
    @Published var frontendLabel: String = "down"
    @Published var tunnelPid: Int32? = nil
    @Published var backendPid: Int32? = nil
    @Published var frontendPid: Int32? = nil
    @Published var logTail: [LogEntry] = []
    @Published var bridgePort: UInt16 = 7787
    @Published var bridgeRunning: Bool = false
    @Published var portCheckPassed: Bool = false
    // Per-env DB-tunnel listening state, polled independently of the active
    // tunnel manager so all three cards reflect ground truth in parallel.
    @Published var dbStateDev: Bool = false
    @Published var dbStateStaging: Bool = false
    @Published var dbStateProduction: Bool = false
    @Published var dbPidDev: Int32? = nil
    @Published var dbPidStaging: Int32? = nil
    @Published var dbPidProduction: Int32? = nil

    // Lock state mirror — published so SwiftUI can bind. Source of truth is
    // LockRegistry (persisted). We hydrate at init and mirror writes through.
    @Published var locks: [String: Bool] = [:]

    // Fixed ports per service (tunnel port comes from currentEnv).
    let backendPort: UInt16 = 5100
    let frontendPort: UInt16 = 5101

    private var pollTask: Task<Void, Never>?
    private var tailTask: Task<Void, Never>?
    private var dbProbeTask: Task<Void, Never>?
    private var bridge: BridgeServer?

    init() {
        if let raw = MarkerLock.readActiveEnv(), let e = BackendEnv(rawValue: raw) {
            currentEnv = e
        }
        startPolling()
        startTail()
        startDBProbe()
        hydrateLocks()
    }

    // MARK: locks

    private func hydrateLocks() {
        Task { [weak self] in
            var snapshot: [String: Bool] = [:]
            for env in BackendEnv.allCases {
                for kind in ServiceKind.allCases {
                    let k = LockRegistry.key(env: env, kind: kind)
                    snapshot[k] = await LockRegistry.shared.isLocked(env: env, kind: kind)
                }
                let dk = LockRegistry.dbKey(env: env)
                snapshot[dk] = await LockRegistry.shared.isDBLocked(env: env)
            }
            await MainActor.run { self?.locks = snapshot }
        }
    }

    func isLocked(_ env: BackendEnv, _ kind: ServiceKind) -> Bool {
        locks[LockRegistry.key(env: env, kind: kind)] ?? false
    }
    func isDBLocked(_ env: BackendEnv) -> Bool {
        locks[LockRegistry.dbKey(env: env)] ?? false
    }
    func setLock(_ env: BackendEnv, _ kind: ServiceKind, _ locked: Bool) {
        let k = LockRegistry.key(env: env, kind: kind)
        locks[k] = locked
        Task { await LockRegistry.shared.setLocked(env: env, kind: kind, locked) }
    }
    func setDBLock(_ env: BackendEnv, _ locked: Bool) {
        let k = LockRegistry.dbKey(env: env)
        locks[k] = locked
        Task { await LockRegistry.shared.setDBLocked(env: env, locked) }
    }

    // MARK: per-env DB tunnel actions
    //
    // DB cards operate on env-specific tunnels via direct ssh + port-kill.
    // CRITICAL: stopDB on the env that matches the active TunnelManager must
    // also stop the active manager — otherwise its drop-watcher will respawn
    // the ssh process within ~15s and the user can't keep the tunnel down.

    func startDB(_ env: BackendEnv) {
        if isDBLocked(env) { return }
        Task.detached { [weak self] in
            let port = env.tunnelPort
            if (await HealthProbe.portListen(host: "127.0.0.1", port: port, timeout: 0.5)).ok {
                return
            }
            // If this env is the active one, route through the manager so the
            // owned/adopted bookkeeping stays consistent.
            let activeEnv = await self?.currentEnv ?? .production
            if env == activeEnv, let self {
                await self.orchestrator.tunnel.start()
                return
            }
            let cmd = "ssh -fN -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o BatchMode=yes \(env.sshAlias)"
            do {
                _ = try await ProcessSupervisor.spawn(
                    bashLogin: cmd, cwd: Paths.repoRoot, env: [:], logTag: .tunnel)
                await JSONLLogger.shared.log(LogEntry(
                    level: .info, tag: .tunnel, action: "db-start",
                    result: "spawned", extra: ["env": env.rawValue, "port": "\(port)"]
                ))
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .tunnel, action: "db-start",
                    result: "err", extra: ["env": env.rawValue, "err": "\(error)"]
                ))
            }
        }
    }

    func stopDB(_ env: BackendEnv) {
        if isDBLocked(env) { return }
        Task.detached { [weak self] in
            let port = env.tunnelPort
            // If this env is the active one, stop the manager FIRST so its
            // watcher cancels — otherwise it will respawn the killed ssh.
            let activeEnv = await self?.currentEnv ?? .production
            if env == activeEnv, let self {
                await self.orchestrator.tunnel.stop()
            }
            for pid in ProcessSupervisor.listeningPIDs(on: port) {
                kill(pid, SIGTERM)
                try? await Task.sleep(nanoseconds: 800_000_000)
                kill(pid, SIGKILL)
            }
            await ProcessSupervisor.sweepPort(port, logTag: .tunnel)
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .tunnel, action: "db-stop",
                result: "ok", extra: ["env": env.rawValue, "port": "\(port)"]
            ))
        }
    }

    func restartDB(_ env: BackendEnv) {
        if isDBLocked(env) { return }
        Task.detached { [weak self] in
            guard let self else { return }
            await MainActor.run { self.stopDB(env) }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { self.startDB(env) }
        }
    }

    // MARK: per-env service actions (for the env-row cards)
    //
    // Backend / Frontend share single ports — only the active env can run
    // them. Acting on a non-active env's card switches env first.

    func startService(_ env: BackendEnv, _ kind: ServiceKind) {
        if isLocked(env, kind) { return }
        Task {
            if env != currentEnv {
                await orchestrator.env.switchTo(env)
                await MainActor.run { self.currentEnv = env }
            }
            switch kind {
            case .tunnel: await orchestrator.tunnel.start()
            case .backend: await orchestrator.backend.start()
            case .frontend: await orchestrator.frontend.start()
            }
        }
    }
    func stopService(_ env: BackendEnv, _ kind: ServiceKind) {
        if isLocked(env, kind) { return }
        Task {
            // Only meaningful if env matches active for backend/frontend.
            if env != currentEnv && (kind == .backend || kind == .frontend) {
                return
            }
            if kind == .tunnel { await orchestrator.tunnel.setEnv(env) }
            switch kind {
            case .tunnel: await orchestrator.tunnel.stop()
            case .backend: await orchestrator.backend.stop()
            case .frontend: await orchestrator.frontend.stop()
            }
        }
    }
    func restartService(_ env: BackendEnv, _ kind: ServiceKind) {
        if isLocked(env, kind) { return }
        Task {
            if env != currentEnv {
                await orchestrator.env.switchTo(env)
                await MainActor.run { self.currentEnv = env }
            }
            switch kind {
            case .tunnel: await orchestrator.tunnel.restart()
            case .backend: await orchestrator.backend.restart()
            case .frontend: await orchestrator.frontend.restart()
            }
        }
    }

    // Section row "all" controls.
    func startAllForEnv(_ env: BackendEnv) {
        Task {
            if env != currentEnv {
                await orchestrator.env.switchTo(env)
                await MainActor.run { self.currentEnv = env }
            }
            await orchestrator.startAll()
            // Also bring up DB tunnel via card path so adoption is logged.
            await MainActor.run { self.startDB(env) }
        }
    }
    func stopAllForEnv(_ env: BackendEnv) {
        Task {
            await MainActor.run { self.stopDB(env) }
            if env == currentEnv {
                await orchestrator.stopAll()
            }
        }
    }
    func restartAllForEnv(_ env: BackendEnv) {
        Task {
            await MainActor.run { self.stopAllForEnv(env) }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { self.startAllForEnv(env) }
        }
    }

    // Legacy global "all" (kept for compatibility with adopt-on-entry .task)
    func startAll() {
        Task { await orchestrator.startAll() }
    }
    func stopAll() {
        Task { await orchestrator.stopAll() }
    }
    func restartAll() {
        Task { await orchestrator.restartAll() }
    }
    func switchEnv(_ target: BackendEnv) {
        Task { await orchestrator.env.switchTo(target) }
    }

    func toggleBridge() {
        Task {
            if let b = bridge {
                await b.stop()
                bridge = nil
                await MainActor.run { self.bridgeRunning = false }
            } else {
                let b = BridgeServer(port: bridgePort, orchestrator: orchestrator)
                do {
                    try await b.start()
                    bridge = b
                    await MainActor.run { self.bridgeRunning = true }
                } catch {
                    await JSONLLogger.shared.log(LogEntry(
                        level: .error, tag: .bridge, action: "start",
                        result: "err", extra: ["err": "\(error)"]
                    ))
                }
            }
        }
    }

    // MARK: polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let tunnelState = await self.orchestrator.tunnel.state
                let backendState = await self.orchestrator.backend.state
                let frontendState = await self.orchestrator.frontend.state
                await MainActor.run {
                    self.tunnelLabel = tunnelState.label
                    self.backendLabel = backendState.label
                    self.frontendLabel = frontendState.label
                    self.tunnelPid = Self.pid(from: tunnelState)
                    self.backendPid = Self.pid(from: backendState)
                    self.frontendPid = Self.pid(from: frontendState)
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private static func pid(from state: ServiceState) -> Int32? {
        if case .up(let pid, _) = state, pid > 1 { return pid }
        return nil
    }

    private func startDBProbe() {
        dbProbeTask?.cancel()
        dbProbeTask = Task { [weak self] in
            while !Task.isCancelled {
                let envs: [BackendEnv] = [.dev, .staging, .production]
                var results: [BackendEnv: (Bool, Int32?)] = [:]
                for env in envs {
                    let r = await HealthProbe.portListen(
                        host: "127.0.0.1", port: env.tunnelPort, timeout: 0.5)
                    let pid = r.ok
                        ? ProcessSupervisor.listeningPIDs(on: env.tunnelPort).first
                        : nil
                    results[env] = (r.ok, pid)
                }
                guard let self else { return }
                await MainActor.run {
                    self.dbStateDev = results[.dev]?.0 ?? false
                    self.dbStateStaging = results[.staging]?.0 ?? false
                    self.dbStateProduction = results[.production]?.0 ?? false
                    self.dbPidDev = results[.dev]?.1 ?? nil
                    self.dbPidStaging = results[.staging]?.1 ?? nil
                    self.dbPidProduction = results[.production]?.1 ?? nil
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func startTail() {
        tailTask?.cancel()
        tailTask = Task { [weak self] in
            let stream = await JSONLLogger.shared.tail()
            for await entry in stream {
                guard let self else { return }
                await MainActor.run {
                    self.logTail.append(entry)
                    if self.logTail.count > 500 { self.logTail.removeFirst(self.logTail.count - 500) }
                }
            }
        }
    }
}
