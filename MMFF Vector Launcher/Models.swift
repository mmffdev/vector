// Models.swift — shared types for the launcher.
//
// Rewrite (2026-05-05): the old launcher coupled every service to a
// BackendEnv (dev/staging/production) which created a knot of cross-service
// behaviour: switching env restarted the backend, restarting the backend
// killed the tunnel, the tunnel watcher would respawn after a user stop, etc.
//
// This file's only types are now:
//   • ServiceID — the seven independent things the launcher supervises.
//   • ServiceState — the lifecycle state machine those seven share.
//
// Each ServiceID is a leaf identity. There is no env coupling and no shared
// mutable env field. A "tunnel.dev" supervisor knows about port 5435 and
// the alias `vector-dev-pg`; that's it. The dashboard composes them.
import Foundation

enum ServiceID: String, CaseIterable, Codable, Sendable {
    /// Dev SSH tunnel — port 5435, alias `vector-dev-pg`. Always-on.
    case tunnelDev = "tunnel.dev"
    /// Staging SSH tunnel — port 5436, alias `vector-staging-pg`. Off by default; user toggle.
    case tunnelStaging = "tunnel.staging"
    /// Production SSH tunnel — port 5434, alias `mmffdev-pg`. Off by default; user toggle.
    case tunnelProd = "tunnel.prod"
    /// Go backend — port 5100, hard-pinned to dev. Always-on.
    case backend = "backend"
    /// Next.js frontend — port 5101. Always-on.
    case frontend = "frontend"
    /// Docusaurus docs — port 3000. Always-on. No browser auto-open.
    case docs = "docs"

    var displayName: String {
        switch self {
        case .tunnelDev:     return "Tunnel (dev)"
        case .tunnelStaging: return "Tunnel (staging)"
        case .tunnelProd:    return "Tunnel (prod)"
        case .backend:       return "Backend"
        case .frontend:      return "Frontend"
        case .docs:          return "Docs"
        }
    }

    /// Whether the user expects this service to come up automatically when
    /// the launcher boots. Tunnels for staging/prod are off by default per
    /// user requirement: "the only things that MUST be live on prod is the
    /// tunnel" — and that tunnel is opt-in.
    var enabledByDefault: Bool {
        switch self {
        case .tunnelStaging, .tunnelProd: return false
        default:                          return true
        }
    }

    /// Whether the dashboard renders this as a permanent always-on card or
    /// as an opt-in toggle.
    var isAlwaysOnService: Bool {
        switch self {
        case .tunnelStaging, .tunnelProd: return false
        default:                          return true
        }
    }
}

enum ServiceState: Equatable, Sendable {
    case off          // user-disabled
    case down         // enabled but not yet up (or after a confirmed-dead PID)
    case starting(attempt: Int, of: Int)
    case up(pid: Int32, owned: Bool)
    case failed(reason: String)

    var isUp: Bool {
        if case .up = self { return true } else { return false }
    }
    var label: String {
        switch self {
        case .off:                    return "off"
        case .down:                   return "down"
        case .starting(let a, let t): return t > 1 ? "starting \(a)/\(t)" : "starting"
        case .up(_, let owned):       return owned ? "up" : "up (adopted)"
        case .failed(let r):          return "failed: \(r)"
        }
    }
    var pid: Int32? {
        if case .up(let p, _) = self, p > 1 { return p }
        return nil
    }
}

/// Snapshot exported via the bridge HTTP surface.
struct ServiceSnapshot: Codable, Sendable {
    let id: String
    let state: String
    let pid: Int32?
    let owned: Bool?
    let port: UInt16
    let enabled: Bool
}
