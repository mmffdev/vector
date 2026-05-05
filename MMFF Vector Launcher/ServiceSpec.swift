// ServiceSpec.swift — declarative per-service configuration.
//
// The Supervisor actor reads this struct and runs the universal lifecycle
// against it. Adding a new service = adding one ServiceSpec entry; you do
// NOT write a new manager class. This is what kills the BackendManager /
// TunnelManager / FrontendManager / DocsManager copy-paste explosion the
// old launcher had.
import Foundation

/// How the supervisor spawns a service.
struct ServiceSpec: Sendable {
    /// Stable identity used in logs, UI, locks, and the bridge surface.
    let id: ServiceID
    /// TCP port the service listens on.
    let port: UInt16
    /// Working directory for the spawn.
    let cwd: URL
    /// Bash command line, run via `/bin/bash -lc`.
    let command: String
    /// Extra env vars merged on top of the parent process env.
    let env: [String: String]
    /// JSONL log tag.
    let logTag: LogTag
    /// Adoption probe — return true if a process already listening on `port`
    /// is one we should claim instead of spawning a fresh one.
    let adoptIf: @Sendable (UInt16) async -> Bool
    /// Readiness probe — return true once the service is healthy.
    let readiness: @Sendable () async -> Bool
    /// Number of seconds to allow during startup before declaring spawn failed.
    let readinessBudgetSeconds: TimeInterval
    /// How aggressively to retry on confirmed-dead PID.
    let retry: RetryPolicy
}

extension ServiceSpec {
    /// Helper — TCP-connect probe on a fixed port.
    static func tcpProbe(_ port: UInt16, timeout: TimeInterval = 1.0) -> @Sendable () async -> Bool {
        return { @Sendable in
            (await HealthProbe.portListen(host: "127.0.0.1", port: port, timeout: timeout)).ok
        }
    }
    /// Helper — HTTP /healthz JSON shape probe.
    static func healthzProbe(_ url: URL, timeout: TimeInterval = 2.0) -> @Sendable () async -> Bool {
        return { @Sendable in
            (await HealthProbe.httpHealthz(url: url, expectCommitMatch: false, timeout: timeout)).ok
        }
    }
    /// Helper — HTTP 200 + text/html probe.
    static func htmlProbe(_ url: URL, timeout: TimeInterval = 2.0) -> @Sendable () async -> Bool {
        return { @Sendable in
            (await HealthProbe.htmlReady(url: url, timeout: timeout)).ok
        }
    }
    /// Helper — adopt if any ssh process is listening (used by tunnel specs).
    static func adoptIfSSH(_ port: UInt16) -> @Sendable (UInt16) async -> Bool {
        return { @Sendable _ in
            guard let pid = ProcessSupervisor.listeningPIDs(on: port).first else { return false }
            return ProcessSupervisor.describePID(pid).contains("ssh")
        }
    }
    /// Helper — adopt if any process is listening (used by backend/frontend/docs).
    static func adoptIfListening(_ port: UInt16) -> @Sendable (UInt16) async -> Bool {
        return { @Sendable _ in
            !ProcessSupervisor.listeningPIDs(on: port).isEmpty
        }
    }
}
