// HealthProbe.swift — Janus's three probe primitives + failure classification.
import Foundation
import Network

enum ProbeFailure: String, Sendable {
    case timeout = "TIMEOUT"
    case refused = "REFUSED"
    case badShape = "BAD_SHAPE"
    case stale = "STALE"
    case networkDown = "NETWORK_DOWN"

    var isTerminal: Bool {
        switch self {
        case .badShape, .stale: return true
        default: return false
        }
    }
}

struct ProbeResult: Sendable {
    let ok: Bool
    let failure: ProbeFailure?
    let detail: String?
    static let success = ProbeResult(ok: true, failure: nil, detail: nil)
}

enum HealthProbe {
    /// TCP-connect probe via NWConnection. Used for tunnel readiness and the
    /// initial port-bound check on the frontend (Next dev returns 404 on / for
    /// the first few seconds; we only check the port is listening here).
    static func portListen(host: String, port: UInt16, timeout: TimeInterval) async -> ProbeResult {
        let nwHost = NWEndpoint.Host(host)
        let nwPort = NWEndpoint.Port(rawValue: port)!
        let conn = NWConnection(host: nwHost, port: nwPort, using: .tcp)

        return await withCheckedContinuation { (cont: CheckedContinuation<ProbeResult, Never>) in
            let q = DispatchQueue(label: "probe.tcp.\(host).\(port)")
            // Single-fire dispatch to ensure the continuation resumes exactly once.
            let resumed = ManagedAtomic(false)
            let finish: @Sendable (ProbeResult) -> Void = { r in
                if resumed.compareExchange(expected: false, desired: true) {
                    conn.cancel()
                    cont.resume(returning: r)
                }
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(.success)
                case .failed(let err):
                    let nwErr = err as NWError
                    if case .posix(let code) = nwErr, code == .ECONNREFUSED {
                        finish(ProbeResult(ok: false, failure: .refused, detail: nwErr.debugDescription))
                    } else {
                        finish(ProbeResult(ok: false, failure: .networkDown, detail: nwErr.debugDescription))
                    }
                case .cancelled:
                    finish(ProbeResult(ok: false, failure: .timeout, detail: "cancelled"))
                default: break
                }
            }
            conn.start(queue: q)
            q.asyncAfter(deadline: .now() + timeout) {
                finish(ProbeResult(ok: false, failure: .timeout, detail: "after \(timeout)s"))
            }
        }
    }

    /// HTTP /healthz probe — checks JSON body has expected shape and (for
    /// stale-binary detection) compares the optional `commit` field to the
    /// repo's `.git/HEAD`. We read .git/HEAD directly — never run `git`.
    static func httpHealthz(url: URL, expectCommitMatch: Bool, timeout: TimeInterval) async -> ProbeResult {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return ProbeResult(ok: false, failure: .badShape, detail: "non-200")
            }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return ProbeResult(ok: false, failure: .badShape, detail: "non-json")
            }
            guard let status = json["status"] as? String, status == "ok" else {
                return ProbeResult(ok: false, failure: .badShape, detail: "status!=ok")
            }
            if expectCommitMatch, let serverCommit = json["commit"] as? String, !serverCommit.isEmpty {
                if let head = readGitHead(), head != serverCommit {
                    return ProbeResult(ok: false, failure: .stale, detail: "commit \(serverCommit) != HEAD \(head)")
                }
            }
            return .success
        } catch let urlErr as URLError {
            switch urlErr.code {
            case .timedOut: return ProbeResult(ok: false, failure: .timeout, detail: urlErr.localizedDescription)
            case .cannotConnectToHost, .networkConnectionLost: return ProbeResult(ok: false, failure: .refused, detail: urlErr.localizedDescription)
            default: return ProbeResult(ok: false, failure: .networkDown, detail: urlErr.localizedDescription)
            }
        } catch {
            return ProbeResult(ok: false, failure: .networkDown, detail: "\(error)")
        }
    }

    /// HTML readiness probe — 200 + Content-Type: text/html.
    static func htmlReady(url: URL, timeout: TimeInterval) async -> ProbeResult {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (_, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                return ProbeResult(ok: false, failure: .badShape, detail: "non-http")
            }
            // Next dev returns 404 on / when no page matches but content-type is still text/html
            let ct = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if ct.contains("text/html") { return .success }
            return ProbeResult(ok: false, failure: .badShape, detail: "ct=\(ct)")
        } catch {
            return ProbeResult(ok: false, failure: .timeout, detail: "\(error)")
        }
    }

    /// Reads the SHA at .git/HEAD (resolving a `ref:` indirection one level)
    /// without running any git command.
    static func readGitHead() -> String? {
        guard let raw = try? String(contentsOf: Paths.gitHeadFile, encoding: .utf8) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("ref:") {
            let ref = trimmed.dropFirst(4).trimmingCharacters(in: .whitespaces)
            let refPath = Paths.repoRoot.appendingPathComponent(".git/\(ref)")
            return try? String(contentsOf: refPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return trimmed
    }
}

/// Tiny atomic flag wrapping a single bool — avoids pulling Atomics dep.
final class ManagedAtomic: @unchecked Sendable {
    private var value: Bool
    private let lock = NSLock()
    init(_ v: Bool) { self.value = v }
    func compareExchange(expected: Bool, desired: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if value == expected { value = desired; return true }
        return false
    }
}
