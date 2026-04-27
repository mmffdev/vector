// Orchestrator.swift — wires the three managers and the env selector.
import Foundation

actor Orchestrator {
    let tunnel = TunnelManager()
    let backend = BackendManager()
    let frontend = FrontendManager()
    private var _env: EnvSelector?
    var env: EnvSelector {
        if let e = _env { return e }
        let e = EnvSelector(orchestrator: self)
        _env = e
        return e
    }

    func startAll() async {
        // Resolve current env from CLAUDE.md marker
        let currentRaw = MarkerLock.readActiveEnv() ?? "dev"
        let current = BackendEnv(rawValue: currentRaw) ?? .dev
        await tunnel.setEnv(current)
        await backend.setEnv(current)
        // Start in dependency order: tunnel → backend → frontend (frontend independent)
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
