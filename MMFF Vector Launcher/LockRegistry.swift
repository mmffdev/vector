// LockRegistry.swift — per-(env, kind) locks shared across the app.
//
// Honored by:
//   - DashboardView: Start/Stop/Restart buttons disabled when locked.
//   - TunnelManager / BackendManager / FrontendManager watchers: skip auto-
//     restart on drop/crash when locked.
//
// Persisted to UserDefaults under "lock.<env>.<kind>" so locks survive relaunch.
import Foundation

actor LockRegistry {
    static let shared = LockRegistry()

    private var locks: Set<String> = []

    private init() {
        // Load persisted locks
        let defaults = UserDefaults.standard
        for env in BackendEnv.allCases {
            for kind in ServiceKind.allCases {
                let key = Self.key(env: env, kind: kind)
                if defaults.bool(forKey: "lock.\(key)") { locks.insert(key) }
            }
            // DB lock (separate from tunnel — DB cards are independent)
            let dbKey = Self.dbKey(env: env)
            if defaults.bool(forKey: "lock.\(dbKey)") { locks.insert(dbKey) }
        }
    }

    static func key(env: BackendEnv, kind: ServiceKind) -> String {
        "\(env.rawValue).\(kind.rawValue)"
    }
    static func dbKey(env: BackendEnv) -> String {
        "\(env.rawValue).db"
    }

    func isLocked(env: BackendEnv, kind: ServiceKind) -> Bool {
        locks.contains(Self.key(env: env, kind: kind))
    }
    func isDBLocked(env: BackendEnv) -> Bool {
        locks.contains(Self.dbKey(env: env))
    }

    func setLocked(env: BackendEnv, kind: ServiceKind, _ locked: Bool) {
        let k = Self.key(env: env, kind: kind)
        if locked { locks.insert(k) } else { locks.remove(k) }
        UserDefaults.standard.set(locked, forKey: "lock.\(k)")
    }
    func setDBLocked(env: BackendEnv, _ locked: Bool) {
        let k = Self.dbKey(env: env)
        if locked { locks.insert(k) } else { locks.remove(k) }
        UserDefaults.standard.set(locked, forKey: "lock.\(k)")
    }
}
