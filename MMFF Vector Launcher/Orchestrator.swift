// Orchestrator.swift — wires the three managers and the env selector.
import Foundation

actor Orchestrator {
    let tunnel: TunnelManager
    let backend: BackendManager
    let frontend = FrontendManager()
    let docs = DocsManager()
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
        // Tunnel and docs have no inter-dependency, so kick them off in
        // parallel; backend depends on tunnel, frontend depends on backend.
        async let tunnelStart: Void = tunnel.start()
        async let docsStart: Void = docs.start()
        _ = await (tunnelStart, docsStart)
        await backend.start()
        await frontend.start()
    }

    func stopAll() async {
        // Stop in reverse order; docs has no dependents so we can stop it
        // alongside frontend.
        async let frontendStop: Void = frontend.stop()
        async let docsStop: Void = docs.stop()
        _ = await (frontendStop, docsStop)
        await backend.stop()
        await tunnel.stop()
    }

    func restartAll() async {
        await stopAll()
        await startAll()
    }
}
