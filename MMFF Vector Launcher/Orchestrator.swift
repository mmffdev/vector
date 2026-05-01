// Orchestrator.swift — wires the three managers and the env selector.
import Foundation

actor Orchestrator {
    let tunnel: TunnelManager
    let backend: BackendManager
    let frontend = FrontendManager()
    private var _env: EnvSelector?
    var env: EnvSelector {
        if let e = _env { return e }
        let e = EnvSelector(orchestrator: self)
        _env = e
        return e
    }

    init() {
        // Read env from CLAUDE.md marker at construction so every code path
        // (startAll, individual start, watcher restart) uses the right alias.
        let bootEnv = BackendEnv(rawValue: MarkerLock.readActiveEnv() ?? "") ?? .production
        tunnel  = TunnelManager(env: bootEnv)
        backend = BackendManager(env: bootEnv)
    }

    func startAll() async {
        // Re-read marker in case it changed since boot (env switch via UI)
        let currentRaw = MarkerLock.readActiveEnv() ?? ""
        let current = BackendEnv(rawValue: currentRaw) ?? .production
        await tunnel.setEnv(current)
        await backend.setEnv(current)
        // Start in dependency order: tunnel → backend → frontend
        await tunnel.start()
        await backend.start()
        await frontend.start()
    }

    func stopAll() async {
        // Stop in reverse order
        await frontend.stop()
        await backend.stop()
        await tunnel.stop()
    }

    func restartAll() async {
        await stopAll()
        await startAll()
    }
}
