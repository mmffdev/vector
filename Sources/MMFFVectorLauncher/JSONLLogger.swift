// JSONLLogger.swift — Eros's structured logger.
// One actor serialises writes to launcher.jsonl + a hard-linked mirror in repo.
// Schema: { ts, level, tag, action, result, extra? } — required: ts/level/tag/action/result.
import Foundation

enum LogLevel: String, Codable, Sendable { case debug, info, warn, error }
enum LogTag: String, Codable, Sendable {
    case app, tunnel, backend, frontend, env, bridge, probe, test
}

struct LogEntry: Codable, Sendable {
    let ts: String
    let level: LogLevel
    let tag: LogTag
    let action: String
    let result: String
    let extra: [String: String]?

    init(level: LogLevel, tag: LogTag, action: String, result: String, extra: [String: String]? = nil) {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.ts = f.string(from: Date())
        self.level = level
        self.tag = tag
        self.action = action
        self.result = result
        self.extra = extra
    }
}

actor JSONLLogger {
    static let shared = JSONLLogger()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()
    private var handle: FileHandle?
    private let maxBytes: UInt64 = 10 * 1024 * 1024

    // AsyncStream for live tail
    private var tailContinuations: [UUID: AsyncStream<LogEntry>.Continuation] = [:]

    func log(_ entry: LogEntry) async {
        do {
            try await ensureFile()
            let json = try encoder.encode(entry)
            var bytes = json
            bytes.append(0x0A) // newline
            try await writeAndMaybeRotate(bytes)
            for c in tailContinuations.values { c.yield(entry) }
        } catch {
            // Logger must never crash the app. Drop the entry silently after a
            // single stderr breadcrumb so the developer can spot the issue.
            FileHandle.standardError.write("JSONLLogger: \(error)\n".data(using: .utf8) ?? Data())
        }
    }

    nonisolated func logSync(_ entry: LogEntry) {
        Task.detached(priority: .utility) {
            await JSONLLogger.shared.log(entry)
        }
    }

    func tail() -> AsyncStream<LogEntry> {
        AsyncStream { continuation in
            let id = UUID()
            self.tailContinuations[id] = continuation
            continuation.onTermination = { @Sendable _ in
                Task { await self.removeTailListener(id) }
            }
        }
    }

    private func removeTailListener(_ id: UUID) {
        tailContinuations.removeValue(forKey: id)
    }

    private func ensureFile() async throws {
        if handle != nil { return }
        let path = Paths.logFile.path
        let fm = FileManager.default
        if !fm.fileExists(atPath: path) {
            fm.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600])
            try? syncMirror()
        }
        handle = try FileHandle(forWritingTo: Paths.logFile)
        try handle?.seekToEnd()
    }

    private func writeAndMaybeRotate(_ bytes: Data) async throws {
        guard let h = handle else { return }
        try h.write(contentsOf: bytes)
        let size = (try? h.offset()) ?? 0
        if size >= maxBytes {
            try await rotate()
        }
    }

    private func rotate() async throws {
        try handle?.close()
        handle = nil
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        let ts = f.string(from: Date())
        let archived = Paths.logsDir.appendingPathComponent("launcher.\(ts).jsonl")
        try? FileManager.default.moveItem(at: Paths.logFile, to: archived)
        // gzip via Process (zlib is awkward in pure Swift; we already use Process elsewhere)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
        p.arguments = ["-q", archived.path]
        try? p.run()
        p.waitUntilExit()
        // Reaper: 7-day retention
        if let entries = try? FileManager.default.contentsOfDirectory(at: Paths.logsDir,
            includingPropertiesForKeys: [.contentModificationDateKey]) {
            let cutoff = Date(timeIntervalSinceNow: -7 * 24 * 3600)
            for e in entries where e.lastPathComponent.hasPrefix("launcher.") && e.lastPathComponent != "launcher.jsonl" {
                if let m = (try? e.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, m < cutoff {
                    try? FileManager.default.removeItem(at: e)
                }
            }
        }
        try await ensureFile()
    }

    /// Best-effort hard-link mirror into the repo so devs can `tail -f`.
    private func syncMirror() throws {
        let primary = Paths.logFile
        let mirror = Paths.repoLogMirror
        if FileManager.default.fileExists(atPath: mirror.path) {
            try FileManager.default.removeItem(at: mirror)
        }
        // Use FileManager.linkItem for a hard link (stays in sync without copy)
        try FileManager.default.linkItem(at: primary, to: mirror)
    }
}
