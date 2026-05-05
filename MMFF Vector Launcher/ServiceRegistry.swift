// ServiceRegistry.swift — singleton actor holding one Supervisor per ServiceID.
//
// This is the entire "control plane" of the launcher. The dashboard polls
// `snapshots()` for state, the bridge HTTP surface dispatches commands to
// `enable(_:)` / `disable(_:)` / `restart(_:)`, and at app boot `bootstrap()`
// brings up every service whose ServiceID.enabledByDefault is true.
//
// There is intentionally NO env switching, NO cross-service coupling, and NO
// shared mutable state across services. Each Supervisor owns its own pgid,
// pid, watcher, and lifecycle. Stopping the backend cannot affect a tunnel.
// Toggling a tunnel cannot restart anything else. This is the architectural
// fix for the entanglement bugs in the old launcher.
import Foundation

actor ServiceRegistry {
    static let shared = ServiceRegistry()

    private var supervisors: [ServiceID: Supervisor] = [:]
    private var bootstrapped = false

    private init() {}

    /// Build all six supervisors with their fixed specs and enable the
    /// always-on subset (per ServiceID.enabledByDefault). Idempotent — safe
    /// to call again (subsequent calls are no-ops).
    func bootstrap() async {
        if bootstrapped { return }
        bootstrapped = true

        for id in ServiceID.allCases {
            let spec = Self.makeSpec(for: id)
            let sup = Supervisor(spec: spec, enabled: id.enabledByDefault)
            supervisors[id] = sup
        }

        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .app, action: "registry-bootstrap", result: "ok",
            extra: ["services": "\(ServiceID.allCases.count)"]
        ))

        // Bring up always-on services concurrently. Each is independent — one
        // failing must not block the others.
        await withTaskGroup(of: Void.self) { group in
            for id in ServiceID.allCases where id.enabledByDefault {
                guard let sup = supervisors[id] else { continue }
                group.addTask { await sup.enable() }
            }
        }
    }

    // MARK: - command surface

    func enable(_ id: ServiceID) async {
        guard let sup = supervisors[id] else { return }
        await sup.enable()
    }

    func disable(_ id: ServiceID) async {
        guard let sup = supervisors[id] else { return }
        await sup.disable()
    }

    func restart(_ id: ServiceID) async {
        guard let sup = supervisors[id] else { return }
        await sup.restart()
    }

    // MARK: - read-side

    func snapshot(_ id: ServiceID) async -> ServiceSnapshot? {
        guard let sup = supervisors[id] else { return nil }
        return await sup.snapshot
    }

    /// All snapshots in `ServiceID.allCases` order. The UI polls this.
    func snapshots() async -> [ServiceSnapshot] {
        var out: [ServiceSnapshot] = []
        out.reserveCapacity(ServiceID.allCases.count)
        for id in ServiceID.allCases {
            if let sup = supervisors[id] {
                out.append(await sup.snapshot)
            }
        }
        return out
    }

    // MARK: - spec factory
    //
    // One static factory per ServiceID. Specs are immutable after construction
    // — no env field, no mutable state. The launcher's entire service
    // configuration is right here, in one place, declarative.

    private static func makeSpec(for id: ServiceID) -> ServiceSpec {
        switch id {
        case .tunnelDev:     return tunnelSpec(id: .tunnelDev,     port: 5435, sshAlias: "vector-dev-pg")
        case .tunnelStaging: return tunnelSpec(id: .tunnelStaging, port: 5436, sshAlias: "vector-staging-pg")
        case .tunnelProd:    return tunnelSpec(id: .tunnelProd,    port: 5434, sshAlias: "mmffdev-pg")
        case .backend:       return backendSpec()
        case .frontend:      return frontendSpec()
        case .docs:          return docsSpec()
        }
    }

    private static func tunnelSpec(id: ServiceID, port: UInt16, sshAlias: String) -> ServiceSpec {
        let cmd = "ssh -fN -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o BatchMode=yes \(sshAlias)"
        return ServiceSpec(
            id: id,
            port: port,
            cwd: Paths.repoRoot,
            command: cmd,
            env: [:],
            logTag: .tunnel,
            adoptIf: ServiceSpec.adoptIfSSH(port),
            readiness: ServiceSpec.tcpProbe(port, timeout: 1.0),
            readinessBudgetSeconds: 8.0,
            retry: .tunnel
        )
    }

    /// Backend spec — HARD-PINNED to dev. There is no staging/prod backend
    /// service in the launcher; the project rule says only the dev backend
    /// is run locally. See CLAUDE.md "BACKEND ENV IS PINNED TO `dev`".
    private static func backendSpec() -> ServiceSpec {
        let port: UInt16 = 5100
        let backendDir = "'" + Paths.repoRoot.appendingPathComponent("backend").path
            .replacingOccurrences(of: "'", with: "'\\''") + "'"
        let goBin = "'" + (NSHomeDirectory() + "/go/bin")
            .replacingOccurrences(of: "'", with: "'\\''") + "'"
        let cmd = "cd \(backendDir) && export PATH=\(goBin):/opt/homebrew/bin:/usr/local/bin:$PATH && make dev"
        let healthURL = URL(string: "http://127.0.0.1:\(port)/healthz")!
        return ServiceSpec(
            id: .backend,
            port: port,
            cwd: Paths.repoRoot,
            command: cmd,
            env: ["BACKEND_ENV": "dev"],
            logTag: .backend,
            adoptIf: ServiceSpec.adoptIfListening(port),
            readiness: ServiceSpec.healthzProbe(healthURL, timeout: 1.5),
            readinessBudgetSeconds: 60.0,
            retry: .backend
        )
    }

    private static func frontendSpec() -> ServiceSpec {
        let port: UInt16 = 5101
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        return ServiceSpec(
            id: .frontend,
            port: port,
            cwd: Paths.repoRoot,
            command: "npm run dev -- -p \(port)",
            env: [:],
            logTag: .frontend,
            adoptIf: ServiceSpec.adoptIfListening(port),
            readiness: ServiceSpec.htmlProbe(url, timeout: 2.0),
            readinessBudgetSeconds: 120.0,
            retry: .frontend
        )
    }

    private static func docsSpec() -> ServiceSpec {
        let port: UInt16 = 3000
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        // BROWSER=none stops Docusaurus from auto-opening Safari on every spawn.
        return ServiceSpec(
            id: .docs,
            port: port,
            cwd: Paths.repoRoot.appendingPathComponent("api-reference", isDirectory: true),
            command: "npm start",
            env: ["BROWSER": "none"],
            logTag: .docs,
            adoptIf: ServiceSpec.adoptIfListening(port),
            readiness: ServiceSpec.htmlProbe(url, timeout: 2.0),
            readinessBudgetSeconds: 120.0,
            retry: .frontend
        )
    }
}
