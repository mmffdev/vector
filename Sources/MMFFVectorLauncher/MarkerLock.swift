// MarkerLock.swift — Kratos's POSIX flock + atomic rename for the
// ACTIVE_BACKEND_ENV marker block in .claude/CLAUDE.md.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

enum MarkerError: Error {
    case lockTimeout
    case markerBlockMissing
    case writeFailed(String)
}

enum MarkerLock {
    /// Acquire flock on env.lock, run body, release. 5s timeout.
    static func withLock<T: Sendable>(_ body: () throws -> T) throws -> T {
        let lockPath = Paths.envLockFile.path
        // Ensure file exists
        if !FileManager.default.fileExists(atPath: lockPath) {
            FileManager.default.createFile(atPath: lockPath, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        let fd = open(lockPath, O_RDWR | O_CREAT, 0o600)
        if fd < 0 { throw MarkerError.writeFailed("open env.lock failed: errno=\(errno)") }
        defer { close(fd) }

        let deadline = Date(timeIntervalSinceNow: 5)
        while true {
            let r = flock(fd, LOCK_EX | LOCK_NB)
            if r == 0 { break }
            if Date() >= deadline { throw MarkerError.lockTimeout }
            usleep(50_000) // 50ms
        }
        defer { _ = flock(fd, LOCK_UN) }
        return try body()
    }

    /// Read current ACTIVE_BACKEND_ENV from .claude/CLAUDE.md.
    static func readActiveEnv() -> String? {
        guard let content = try? String(contentsOf: Paths.claudeMdPath, encoding: .utf8) else { return nil }
        return parseEnv(from: content)
    }

    /// Write a new ACTIVE_BACKEND_ENV marker line, preserving the rest of
    /// CLAUDE.md verbatim. Atomic: writes to a temp file then renames.
    static func writeActiveEnv(_ env: String, dbHost: String, envFile: String) throws {
        try withLock {
            try writeUnsafe(env: env, dbHost: dbHost, envFile: envFile)
        }
    }

    private static func writeUnsafe(env: String, dbHost: String, envFile: String) throws {
        guard let original = try? String(contentsOf: Paths.claudeMdPath, encoding: .utf8) else {
            throw MarkerError.writeFailed("read CLAUDE.md failed")
        }
        guard let r = original.range(of: "<!-- ACTIVE_BACKEND_ENV:start -->"),
              let r2 = original.range(of: ":end -->") else {
            throw MarkerError.markerBlockMissing
        }

        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        let stamp = f.string(from: Date())

        let newBlock = """
        <!-- ACTIVE_BACKEND_ENV:start -->
        > **ACTIVE BACKEND ENV: `\(env)`** — set \(stamp) by MMFF Vector Launcher — DB target via tunnel `localhost:\(dbHost)` — env file: `\(envFile)`
        <!-- ACTIVE_BACKEND_ENV:end -->
        """

        // Replace the entire block: from the start marker through the end marker
        let endIndex = original.index(r2.upperBound, offsetBy: 0)
        var rebuilt = original
        rebuilt.replaceSubrange(r.lowerBound..<endIndex, with: newBlock)

        // Atomic rename via mkstemp + rename(2)
        let dir = Paths.claudeMdPath.deletingLastPathComponent()
        let template = dir.appendingPathComponent(".CLAUDE.md.XXXXXX").path
        var tmpl = Array(template.utf8).map { Int8($0) }
        tmpl.append(0)
        let fd = mkstemp(&tmpl)
        if fd < 0 { throw MarkerError.writeFailed("mkstemp failed: errno=\(errno)") }
        // tmpl is a null-terminated C string array of Int8; drop the trailing
        // NUL and decode as UTF-8 (replacement for deprecated init(cString:)).
        let tmplBytes = tmpl.dropLast().map { UInt8(bitPattern: $0) }
        let tmpPath = String(decoding: tmplBytes, as: UTF8.self)
        defer { close(fd) }

        let data = Array(rebuilt.utf8)
        let written = data.withUnsafeBufferPointer { write(fd, $0.baseAddress, data.count) }
        if written != data.count {
            unlink(tmpPath)
            throw MarkerError.writeFailed("short write")
        }
        // mkstemp creates with 0600; relax to match original perms
        chmod(tmpPath, 0o644)
        if rename(tmpPath, Paths.claudeMdPath.path) != 0 {
            unlink(tmpPath)
            throw MarkerError.writeFailed("rename failed: errno=\(errno)")
        }
    }

    private static func parseEnv(from content: String) -> String? {
        guard let r = content.range(of: "ACTIVE BACKEND ENV: `") else { return nil }
        let after = content[r.upperBound...]
        guard let close = after.firstIndex(of: "`") else { return nil }
        return String(after[..<close])
    }
}
