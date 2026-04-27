// EnvSelector.swift — Kratos's env-switch flow.
//
// 1) acquire flock(env.lock) for 5s
// 2) stop backend  (PGID kill)
// 3) stop tunnel   (only if owned)
// 4) atomic-rewrite ACTIVE_BACKEND_ENV marker in .claude/CLAUDE.md
// 5) start tunnel for new env (or adopt running)
// 6) probe tunnel ready
// 7) start backend with BACKEND_ENV=<new>
// 8) probe backend /healthz
// 9) release flock
import Foundation

actor EnvSelector {
    private weak var orchestrator: Orchestrator?
    init(orchestrator: Orchestrator) { self.orchestrator = orchestrator }

    func switchTo(_ target: BackendEnv) async {
        guard let o = orchestrator else { return }
        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .env, action: "switch", result: "begin",
            extra: ["target": target.rawValue]
        ))

        // The flock guards the marker write only. We hold it briefly inside step 4.
        // Service start/stop is inherently coordinated by the manager actors.

        // 2) stop backend
        await o.backend.stop()
        // 3) stop tunnel (no-op if owned=false)
        await o.tunnel.stop()

        // 4) marker rewrite under flock
        do {
            try MarkerLock.writeActiveEnv(target.rawValue,
                                          dbHost: "\(target.tunnelPort)",
                                          envFile: target.envFile)
        } catch {
            await JSONLLogger.shared.log(LogEntry(
                level: .error, tag: .env, action: "marker-write",
                result: "err", extra: ["err": "\(error)"]
            ))
            return
        }

        // 5..6) bring tunnel up
        await o.tunnel.setEnv(target)
        await o.tunnel.start()

        // 7..8) bring backend up
        await o.backend.setEnv(target)
        await o.backend.start()

        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .env, action: "switch", result: "ok",
            extra: ["target": target.rawValue]
        ))
    }
}
