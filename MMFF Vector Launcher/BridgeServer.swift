// BridgeServer.swift — Fenrir's localhost HTTP bridge.
//
// NWListener on 127.0.0.1:7787, loopback-only, bearer-token auth, host-header
// check, idempotency-key cache. Endpoints map directly onto ServiceRegistry:
//   GET  /v1/state                           — snapshots for all services
//   GET  /v1/health                          — boolean up-flags per service
//   POST /v1/services/{id}/{enable|disable|restart}
//        where {id} ∈ ServiceID.allCases.rawValue
//                    (tunnel.dev, tunnel.staging, tunnel.prod,
//                     backend, frontend, docs)
//   GET  /v1/logs?limit=                     — JSONL tail
//   POST /v1/auth/rotate                     — rotate bearer token
//
// There is intentionally NO env-switch endpoint: the backend is hard-pinned
// to dev (see CLAUDE.md "BACKEND ENV IS PINNED TO `dev`"). Tunnels for
// staging/prod are first-class services that the user toggles by id.
import Foundation
import Network

enum BridgeError: Error {
    case bindFailed(String)
}

actor BridgeServer {
    private let port: UInt16
    private var listener: NWListener?
    private var token: String

    private struct IdempotencyEntry { let timestamp: Date; let body: Data }
    private var idempotency: [String: IdempotencyEntry] = [:]

    init(port: UInt16) {
        self.port = port
        self.token = Self.loadOrCreateToken()
    }

    func start() async throws {
        let params = NWParameters.tcp
        params.acceptLocalOnly = true
        params.requiredInterfaceType = .loopback
        let nwPort = NWEndpoint.Port(rawValue: port)!
        let listener: NWListener
        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            throw BridgeError.bindFailed("\(error)")
        }
        self.listener = listener

        listener.newConnectionHandler = { [weak self] conn in
            guard let self else { return }
            Task { await self.accept(conn) }
        }
        listener.start(queue: DispatchQueue(label: "bridge.listener"))

        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .bridge, action: "start", result: "ok",
            extra: ["port": "\(port)"]
        ))
    }

    func stop() async {
        listener?.cancel()
        listener = nil
        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .bridge, action: "stop", result: "ok"
        ))
    }

    private func accept(_ conn: NWConnection) async {
        conn.start(queue: DispatchQueue(label: "bridge.conn"))
        receive(on: conn, accumulated: Data())
    }

    private nonisolated func receive(on conn: NWConnection, accumulated: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
            if let error {
                conn.cancel()
                Task { await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .bridge, action: "recv",
                    result: "err", extra: ["err": "\(error)"]
                )) }
                return
            }
            var buf = accumulated
            if let d = data { buf.append(d) }

            if let req = HTTPRequest.parse(buf) {
                Task { await self.handleRequest(req, on: conn) }
            } else if isComplete {
                conn.cancel()
            } else {
                self.receive(on: conn, accumulated: buf)
            }
        }
    }

    private func handleRequest(_ req: HTTPRequest, on conn: NWConnection) async {
        // Host header check
        let host = req.headers["host"] ?? ""
        if !host.hasPrefix("127.0.0.1") && !host.hasPrefix("localhost") {
            send(conn, status: 403, json: ["error": "bad-host"])
            return
        }

        // Bearer auth — loopback is not enough on shared dev boxes.
        let auth = req.headers["authorization"] ?? ""
        let presented = auth.hasPrefix("Bearer ") ? String(auth.dropFirst(7)) : ""
        if !constantTimeEquals(presented, token) {
            send(conn, status: 401, json: ["error": "unauthorized"])
            return
        }

        // Idempotency-key replay protection (60s LRU)
        if req.method == "POST" {
            let now = Date()
            for (k, v) in idempotency where now.timeIntervalSince(v.timestamp) > 60 {
                idempotency.removeValue(forKey: k)
            }
            if let key = req.headers["idempotency-key"], let cached = idempotency[key] {
                send(conn, status: 200, body: cached.body)
                return
            }
        }

        let resp = await dispatch(req)
        if req.method == "POST", let key = req.headers["idempotency-key"] {
            idempotency[key] = IdempotencyEntry(timestamp: Date(), body: resp)
        }
        send(conn, status: 200, body: resp)
    }

    private func dispatch(_ req: HTTPRequest) async -> Data {
        // /v1/state and /v1/health are simple GETs.
        switch (req.method, req.path) {
        case ("GET", "/v1/state"):  return await jsonState()
        case ("GET", "/v1/health"): return await jsonHealth()
        case ("POST", "/v1/auth/rotate"):
            self.token = Self.generateToken()
            try? Self.persistToken(self.token)
            return ok()
        case ("GET", let p) where p.hasPrefix("/v1/logs"):
            return tailLogs(limit: 100)
        default:
            break
        }

        // /v1/services/{id}/{enable|disable|restart} — keyed by ServiceID.
        if req.method == "POST", let (id, verb) = parseServiceRoute(req.path) {
            switch verb {
            case "enable":  await ServiceRegistry.shared.enable(id);  return ok(extra: ["id": id.rawValue])
            case "disable": await ServiceRegistry.shared.disable(id); return ok(extra: ["id": id.rawValue])
            case "restart": await ServiceRegistry.shared.restart(id); return ok(extra: ["id": id.rawValue])
            default:        return err("bad-verb")
            }
        }

        return err("not-found")
    }

    /// Parse `/v1/services/{id}/{verb}` into (ServiceID, verb). The id segment
    /// may contain dots (e.g. `tunnel.dev`), so we anchor on the prefix and
    /// then split off the trailing verb.
    private func parseServiceRoute(_ path: String) -> (ServiceID, String)? {
        let prefix = "/v1/services/"
        guard path.hasPrefix(prefix) else { return nil }
        let rest = String(path.dropFirst(prefix.count))
        guard let slash = rest.lastIndex(of: "/") else { return nil }
        let idStr = String(rest[..<slash])
        let verb = String(rest[rest.index(after: slash)...])
        guard let id = ServiceID(rawValue: idStr) else { return nil }
        return (id, verb)
    }

    // MARK: helpers

    private func ok(extra: [String: String] = [:]) -> Data {
        var d: [String: Any] = ["ok": true]
        for (k, v) in extra { d[k] = v }
        return (try? JSONSerialization.data(withJSONObject: d)) ?? Data()
    }
    private func err(_ msg: String) -> Data {
        let d: [String: Any] = ["ok": false, "error": msg]
        return (try? JSONSerialization.data(withJSONObject: d)) ?? Data()
    }

    private func jsonState() async -> Data {
        let snaps = await ServiceRegistry.shared.snapshots()
        var services: [[String: Any]] = []
        for s in snaps {
            var entry: [String: Any] = [
                "id": s.id,
                "state": s.state,
                "port": Int(s.port),
                "enabled": s.enabled
            ]
            if let pid = s.pid { entry["pid"] = Int(pid) }
            if let owned = s.owned { entry["owned"] = owned }
            services.append(entry)
        }
        let payload: [String: Any] = ["services": services]
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    }

    private func jsonHealth() async -> Data {
        let snaps = await ServiceRegistry.shared.snapshots()
        var out: [String: Any] = [:]
        for s in snaps {
            out[s.id] = s.state.hasPrefix("up")
        }
        return (try? JSONSerialization.data(withJSONObject: out)) ?? Data()
    }

    private func tailLogs(limit: Int) -> Data {
        guard let h = try? FileHandle(forReadingFrom: Paths.logFile) else { return "[]".data(using: .utf8)! }
        defer { try? h.close() }
        let data = (try? h.readToEnd()) ?? Data()
        let lines = (String(data: data, encoding: .utf8) ?? "")
            .split(whereSeparator: \.isNewline)
            .suffix(limit)
            .joined(separator: ",")
        return "[\(lines)]".data(using: .utf8) ?? Data()
    }

    private func send(_ conn: NWConnection, status: Int, json: [String: String]) {
        let body = (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
        send(conn, status: status, body: body)
    }
    private func send(_ conn: NWConnection, status: Int, body: Data) {
        let head = "HTTP/1.1 \(status) \(reason(status))\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var resp = Data(head.utf8); resp.append(body)
        conn.send(content: resp, completion: .contentProcessed { _ in conn.cancel() })
    }
    private func reason(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        default: return "Bad Request"
        }
    }

    private func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let aB = Array(a.utf8), bB = Array(b.utf8)
        if aB.count != bB.count { return false }
        var diff: UInt8 = 0
        for i in 0..<aB.count { diff |= aB[i] ^ bB[i] }
        return diff == 0
    }

    // MARK: token persistence

    static func loadOrCreateToken() -> String {
        if let existing = try? String(contentsOf: Paths.bridgeTokenFile, encoding: .utf8) {
            return existing.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let t = generateToken()
        try? persistToken(t)
        return t
    }
    static func generateToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        for i in 0..<bytes.count { bytes[i] = UInt8.random(in: 0...255) }
        return Data(bytes).base64EncodedString()
    }
    static func persistToken(_ t: String) throws {
        let data = t.data(using: .utf8) ?? Data()
        FileManager.default.createFile(atPath: Paths.bridgeTokenFile.path,
                                       contents: data,
                                       attributes: [.posixPermissions: 0o600])
    }
}

/// Minimal HTTP/1.1 request parser — just enough for the bridge surface.
struct HTTPRequest: Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    static func parse(_ buf: Data) -> HTTPRequest? {
        let sep: [UInt8] = [0x0D, 0x0A, 0x0D, 0x0A]
        guard let r = buf.firstRange(of: sep) else { return nil }
        let head = buf.subdata(in: buf.startIndex..<r.lowerBound)
        let body = buf.subdata(in: r.upperBound..<buf.endIndex)
        guard let headStr = String(data: head, encoding: .utf8) else { return nil }
        let lines = headStr.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard !lines.isEmpty else { return nil }
        let parts = lines[0].split(separator: " ").map(String.init)
        guard parts.count >= 2 else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            if let i = line.firstIndex(of: ":") {
                let k = line[..<i].lowercased().trimmingCharacters(in: .whitespaces)
                let v = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
                headers[k] = v
            }
        }
        if let cl = headers["content-length"], let n = Int(cl), body.count < n {
            return nil
        }
        return HTTPRequest(method: parts[0], path: parts[1], headers: headers, body: body)
    }
}
