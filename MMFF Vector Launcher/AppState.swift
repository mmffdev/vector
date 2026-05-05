// AppState.swift — observable façade the SwiftUI dashboard binds to.
//
// Drives entirely from ServiceRegistry. No env field, no per-(env, kind)
// locks, no cross-service action methods. The UI thread polls the registry
// once a second and republishes snapshots; user actions fan out to
// supervisor.enable() / disable() / restart() asynchronously and the next
// poll picks up the new state.
import Combine
import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var snapshots: [ServiceSnapshot] = []
    @Published var logTail: [LogEntry] = []
    @Published var bridgePort: UInt16 = 7787
    @Published var bridgeRunning: Bool = false
    /// Set true after the user clears the startup port-conflict screen.
    /// Bootstrap only fires once this flips to true so we don't fight a
    /// foreign listener while the user is still deciding what to kill.
    @Published var portCheckPassed: Bool = false

    private var pollTask: Task<Void, Never>?
    private var tailTask: Task<Void, Never>?
    private var bridge: BridgeServer?

    init() {
        // Polling + tail can run before bootstrap — they're harmless when
        // the registry is empty. Bootstrap waits for the user to clear the
        // port-check screen so we don't compete with foreign listeners.
        Task { [weak self] in
            self?.startPolling()
            self?.startTail()
        }
    }

    /// Called by App.swift once the user has cleared the port-check view.
    /// Idempotent — safe to call repeatedly.
    func bootstrapServices() {
        Task { await ServiceRegistry.shared.bootstrap() }
    }

    // MARK: - lookup helpers (UI binds against these)

    func snapshot(_ id: ServiceID) -> ServiceSnapshot? {
        snapshots.first { $0.id == id.rawValue }
    }

    func isUp(_ id: ServiceID) -> Bool {
        guard let s = snapshot(id) else { return false }
        return s.state.hasPrefix("up")
    }

    func isEnabled(_ id: ServiceID) -> Bool {
        snapshot(id)?.enabled ?? id.enabledByDefault
    }

    func label(_ id: ServiceID) -> String {
        snapshot(id)?.state ?? "—"
    }

    func pid(_ id: ServiceID) -> Int32? {
        snapshot(id)?.pid
    }

    // MARK: - command surface

    func enable(_ id: ServiceID) {
        Task { await ServiceRegistry.shared.enable(id) }
    }

    func disable(_ id: ServiceID) {
        Task { await ServiceRegistry.shared.disable(id) }
    }

    func restart(_ id: ServiceID) {
        Task { await ServiceRegistry.shared.restart(id) }
    }

    func toggle(_ id: ServiceID) {
        if isEnabled(id) {
            disable(id)
        } else {
            enable(id)
        }
    }

    // MARK: - bridge HTTP toggle

    func toggleBridge() {
        Task {
            if let b = bridge {
                await b.stop()
                bridge = nil
                bridgeRunning = false
            } else {
                let b = BridgeServer(port: bridgePort)
                do {
                    try await b.start()
                    bridge = b
                    bridgeRunning = true
                } catch {
                    await JSONLLogger.shared.log(LogEntry(
                        level: .error, tag: .bridge, action: "start",
                        result: "err", extra: ["err": "\(error)"]
                    ))
                }
            }
        }
    }

    // MARK: - polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                let snap = await ServiceRegistry.shared.snapshots()
                await MainActor.run { self?.snapshots = snap }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func startTail() {
        tailTask?.cancel()
        tailTask = Task { [weak self] in
            let stream = await JSONLLogger.shared.tail()
            for await entry in stream {
                await MainActor.run {
                    guard let self else { return }
                    self.logTail.append(entry)
                    if self.logTail.count > 500 {
                        self.logTail.removeFirst(self.logTail.count - 500)
                    }
                }
            }
        }
    }
}
