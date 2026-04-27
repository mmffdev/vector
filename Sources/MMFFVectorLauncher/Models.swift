// Models.swift — shared types: BackendEnv, ServiceState, ServiceKind.
import Foundation

enum BackendEnv: String, CaseIterable, Codable, Sendable {
    case dev, staging, production

    var sshAlias: String {
        switch self {
        case .dev: return "vector-dev-pg"
        case .staging: return "vector-staging-pg"
        case .production: return "mmffdev-pg"
        }
    }
    var tunnelPort: UInt16 {
        switch self {
        case .dev: return 5435
        case .staging: return 5436
        case .production: return 5434
        }
    }
    var envFile: String {
        switch self {
        case .dev: return "backend/.env.dev"
        case .staging: return "backend/.env.staging"
        case .production: return "backend/.env.production"
        }
    }
    var displayName: String {
        switch self {
        case .dev: return "Dev"
        case .staging: return "Staging"
        case .production: return "Production"
        }
    }
}

enum ServiceKind: String, Codable, Sendable, CaseIterable {
    case tunnel, backend, frontend
}

enum ServiceState: Equatable, Sendable {
    case down
    case starting
    case up(pid: Int32, owned: Bool)
    case dropped
    case restarting
    case failed(reason: String)

    var isUp: Bool {
        if case .up = self { return true } else { return false }
    }
    var label: String {
        switch self {
        case .down: return "down"
        case .starting: return "starting"
        case .up(_, let owned): return owned ? "up" : "up (adopted)"
        case .dropped: return "dropped"
        case .restarting: return "restarting"
        case .failed(let r): return "failed: \(r)"
        }
    }
}

struct ServiceSnapshot: Codable, Sendable {
    let kind: ServiceKind
    let state: String
    let pid: Int32?
    let owned: Bool?
    let lastChange: String
    let env: String?
}
