// ProcessSupervisor.swift — shared spawn / PGID-kill helpers (Demeter).
//
// Hard rule from Demeter's research: pkill -P is too weak. `go run` and
// `npm run dev` both fork grandchildren that survive parent SIGTERM. We use
// PGID-based kill: kill(-pgid, SIGTERM) → wait 3s → kill(-pgid, SIGKILL).
import Foundation
#if canImport(Darwin)
import Darwin
#endif

enum SpawnError: Error {
    case launchFailed(String)
}

struct SpawnResult: Sendable {
    let pid: Int32
    let pgid: Int32
}

enum ProcessSupervisor {
    /// Spawn `/bin/bash -lc <cmd>` with cwd, env, and a fresh process group so
    /// we can later signal the whole tree with kill(-pgid, ...).
    @discardableResult
    static func spawn(bashLogin cmd: String, cwd: URL, env: [String: String] = [:],
                      logTag: LogTag) async throws -> SpawnResult {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-lc", cmd]
        p.currentDirectoryURL = cwd
        var merged = ProcessInfo.processInfo.environment
        for (k, v) in env { merged[k] = v }
        p.environment = merged

        // setpgid in the child via a small wrapper. Foundation.Process does not
        // expose posix_spawnattr, but it inherits process-group behaviour from
        // the parent. We then promote the child to its own group via
        // setpgid(child, child) right after launch — this is racy if the child
        // exits instantly but is the standard pattern on macOS.
        try p.run()
        let pid = p.processIdentifier
        if setpgid(pid, pid) != 0 {
            // Child may have already called execve; fall back to its own pgid.
        }
        let pgid = getpgid(pid)
        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: logTag, action: "spawn", result: "ok",
            extra: ["pid": "\(pid)", "pgid": "\(pgid)", "cmd": cmd]
        ))
        return SpawnResult(pid: pid, pgid: pgid == -1 ? pid : pgid)
    }

    /// PGID-based kill: SIGTERM the whole group, wait up to 3s, then SIGKILL.
    static func killGroup(pgid: Int32, logTag: LogTag) async {
        if pgid <= 1 { return }
        kill(-pgid, SIGTERM)
        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: logTag, action: "kill",
            result: "term-sent", extra: ["pgid": "\(pgid)"]
        ))
        // Wait up to 3 seconds in 100ms increments
        for _ in 0..<30 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if !groupAlive(pgid: pgid) {
                await JSONLLogger.shared.log(LogEntry(
                    level: .info, tag: logTag, action: "kill",
                    result: "term-ok", extra: ["pgid": "\(pgid)"]
                ))
                return
            }
        }
        kill(-pgid, SIGKILL)
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: logTag, action: "kill",
            result: "kill-sent", extra: ["pgid": "\(pgid)"]
        ))
    }

    /// Sweep a port: any PID still listening gets SIGKILL. Final-stage cleanup
    /// after PGID kill, in case adopted/external processes hold the port.
    static func sweepPort(_ port: UInt16, logTag: LogTag) async {
        let pids = listeningPIDs(on: port)
        for pid in pids {
            kill(pid, SIGKILL)
            await JSONLLogger.shared.log(LogEntry(
                level: .warn, tag: logTag, action: "sweep-port",
                result: "kill-sent", extra: ["port": "\(port)", "pid": "\(pid)"]
            ))
        }
    }

    static func groupAlive(pgid: Int32) -> Bool {
        // kill(-pgid, 0) returns 0 if any process exists in the group, -1 with ESRCH otherwise
        return kill(-pgid, 0) == 0
    }

    /// Scan `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` for listening PIDs.
    static func listeningPIDs(on port: UInt16) -> [Int32] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        p.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do {
            try p.run()
            p.waitUntilExit()
        } catch {
            return []
        }
        let data = (try? pipe.fileHandleForReading.readToEnd()) ?? Data()
        let s = String(data: data, encoding: .utf8) ?? ""
        return s.split(whereSeparator: \.isNewline).compactMap { Int32($0) }
    }

    /// Classify a PID via `ps -o command= -p <pid>` for adoption.
    static func describePID(_ pid: Int32) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/ps")
        p.arguments = ["-o", "command=", "-p", "\(pid)"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do {
            try p.run()
            p.waitUntilExit()
        } catch { return "" }
        let data = (try? pipe.fileHandleForReading.readToEnd()) ?? Data()
        return (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
