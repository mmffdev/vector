// AppState.swift — observable façade the SwiftUI dashboard binds to.
// Polls the actor-isolated managers on a 1-second timer and republishes
// snapshots on the main actor.
import Combine
import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    let orchestrator = Orchestrator()

    @Published var currentEnv: BackendEnv = .dev
    @Published var tunnelLabel: String = "down"
    @Published var backendLabel: String = "down"
    @Published var frontendLabel: String = "down"
    @Published var logTail: [LogEntry] = []
    @Published var bridgePort: UInt16 = 7787
    @Published var bridgeRunning: Bool = false

    private var pollTask: Task<Void, Never>?
    private var tailTask: Task<Void, Never>?
    private var bridge: BridgeServer?

    init() {
        // Resolve current env from marker file at boot
        if let raw = MarkerLock.readActiveEnv(), let e = BackendEnv(rawValue: raw) {
            currentEnv = e
        }
        startPolling()
        startTail()
    }

    // MARK: actions

    func startAll() {
        Task { await orchestrator.startAll() }
    }
    func stopAll() {
        Task { await orchestrator.stopAll() }
    }
    func restartAll() {
        Task { await orchestrator.restartAll() }
    }
    func startService(_ kind: ServiceKind) {
        Task {
            switch kind {
            case .tunnel: await orchestrator.tunnel.start()
            case .backend: await orchestrator.backend.start()
            case .frontend: await orchestrator.frontend.start()
            }
        }
    }
    func stopService(_ kind: ServiceKind) {
        Task {
            switch kind {
            case .tunnel: await orchestrator.tunnel.stop()
            case .backend: await orchestrator.backend.stop()
            case .frontend: await orchestrator.frontend.stop()
            }
        }
    }
    func restartService(_ kind: ServiceKind) {
        Task {
            switch kind {
            case .tunnel: await orchestrator.tunnel.restart()
            case .backend: await orchestrator.backend.restart()
            case .frontend: await orchestrator.frontend.restart()
            }
        }
    }
    func switchEnv(_ target: BackendEnv) {
        Task {
            await orchestrator.env.switchTo(target)
            await MainActor.run { self.currentEnv = target }
        }
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
                let tunnelLabel = await self.orchestrator.tunnel.state.label
                let backendLabel = await self.orchestrator.backend.state.label
                let frontendLabel = await self.orchestrator.frontend.state.label
                await MainActor.run {
                    self.tunnelLabel = tunnelLabel
                    self.backendLabel = backendLabel
                    self.frontendLabel = frontendLabel
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
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
