// DocsManager.swift — Docusaurus api-reference dev-server supervisor.
//
// Spawn: /bin/bash -lc 'npm start' from <repo>/api-reference/.
// Probe: TCP :3000 first, then htmlReady; 60s/60s budget like FrontendManager.
// Adopt: if :3000 already answers, claim the existing PID.
// Logging: stdout + stderr captured via Pipe and tee'd as JSONL to
//          /tmp/mmff-docs.log (one JSON record per line). Launcher-level
//          lifecycle events still go to the shared JSONLLogger with .docs tag.
import Foundation
#if canImport(Darwin)
import Darwin
#endif

actor DocsManager {
    private(set) var state: ServiceState = .down
    private var pgid: Int32 = -1
    private let port: UInt16 = 3000
    private let policy = RetryPolicy.frontend
    private var watcherTask: Task<Void, Never>?
    private var stdoutTask: Task<Void, Never>?
    private var stderrTask: Task<Void, Never>?
    private var process: Process?
    private let stdoutLogPath = "/tmp/mmff-docs.log"

    func start() async {
        if case .up = state { return }
        state = .starting

        // Adopt running docusaurus if port answers HTML
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        if (await HealthProbe.httpOk(url: url, timeout: 1.0)).ok {
            let pid = ProcessSupervisor.listeningPIDs(on: port).first ?? -1
            state = .up(pid: pid, owned: false)
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .docs, action: "adopt", result: "ok",
                extra: ["pid": "\(pid)"]
            ))
            startWatcher()
            return
        }

        let cwd = Paths.repoRoot.appendingPathComponent("api-reference", isDirectory: true)

        for attempt in 0..<policy.maxAttempts {
            do {
                let r = try await spawnWithPipedLogs(cwd: cwd)
                self.pgid = r.pgid

                // Phase 1 — wait for port (60s)
                let portDeadline = Date().addingTimeInterval(60)
                var portOk = false
                while Date() < portDeadline {
                    let p = await HealthProbe.portListen(host: "127.0.0.1", port: port, timeout: 1.0)
                    if p.ok { portOk = true; break }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
                if !portOk {
                    await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: .docs)
                    cancelPipeReaders()
                    continue
                }

                // Phase 2 — wait for text/html (another 60s)
                let htmlDeadline = Date().addingTimeInterval(60)
                while Date() < htmlDeadline {
                    let p = await HealthProbe.httpOk(url: url, timeout: 2.0)
                    if p.ok {
                        state = .up(pid: r.pid, owned: true)
                        await JSONLLogger.shared.log(LogEntry(
                            level: .info, tag: .docs, action: "start",
                            result: "ok", extra: ["pid": "\(r.pid)"]
                        ))
                        startWatcher()
                        return
                    }
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
                await ProcessSupervisor.killGroup(pgid: r.pgid, logTag: .docs)
                cancelPipeReaders()
            } catch {
                await JSONLLogger.shared.log(LogEntry(
                    level: .warn, tag: .docs, action: "spawn",
                    result: "err", extra: ["err": "\(error)"]
                ))
            }
            try? await Task.sleep(nanoseconds: policy.nanoseconds(forAttempt: attempt))
        }
        state = .failed(reason: "docs start exceeded retry budget")
    }

    func stop() async {
        watcherTask?.cancel()
        watcherTask = nil
        switch state {
        case .up(_, let owned):
            if owned, pgid > 1 {
                await ProcessSupervisor.killGroup(pgid: pgid, logTag: .docs)
            }
            await ProcessSupervisor.sweepPort(port, logTag: .docs)
            cancelPipeReaders()
            state = .down
            pgid = -1
            process = nil
        default:
            state = .down
        }
    }

    func restart() async {
        await stop()
        await start()
    }

    // MARK: - private

    /// Custom spawn that captures stdout + stderr through Pipes and writes
    /// every line as a JSON record to /tmp/mmff-docs.log. Mirrors
    /// ProcessSupervisor.spawn for pgid bookkeeping.
    private func spawnWithPipedLogs(cwd: URL) async throws -> SpawnResult {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-lc", "npm start"]
        p.currentDirectoryURL = cwd
        p.environment = ProcessInfo.processInfo.environment

        let outPipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe

        try p.run()
        self.process = p

        let pid = p.processIdentifier
        _ = setpgid(pid, pid)
        let resolvedPgid = getpgid(pid)
        let pgid = resolvedPgid == -1 ? pid : resolvedPgid

        await JSONLLogger.shared.log(LogEntry(
            level: .info, tag: .docs, action: "spawn", result: "ok",
            extra: ["pid": "\(pid)", "pgid": "\(pgid)", "cmd": "npm start", "cwd": cwd.path]
        ))

        // Truncate the previous log so each run starts fresh.
        FileManager.default.createFile(atPath: stdoutLogPath, contents: nil,
                                       attributes: [.posixPermissions: 0o644])

        startPipeReader(pipe: outPipe, stream: "stdout")
        startPipeReader(pipe: errPipe, stream: "stderr")

        return SpawnResult(pid: pid, pgid: pgid)
    }

    private func startPipeReader(pipe: Pipe, stream: String) {
        let logPath = stdoutLogPath
        let task = Task.detached(priority: .utility) {
            let handle = pipe.fileHandleForReading
            var buffer = Data()
            let encoder: JSONEncoder = {
                let e = JSONEncoder()
                e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                return e
            }()
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

            while !Task.isCancelled {
                let chunk = handle.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                while let nl = buffer.firstIndex(of: 0x0A) {
                    let lineData = buffer.subdata(in: 0..<nl)
                    buffer.removeSubrange(0...nl)
                    let line = String(data: lineData, encoding: .utf8) ?? ""
                    if line.isEmpty { continue }
                    let record: [String: String] = [
                        "ts": iso.string(from: Date()),
                        "stream": stream,
                        "line": line
                    ]
                    if let json = try? encoder.encode(record) {
                        var bytes = json
                        bytes.append(0x0A)
                        if let fh = FileHandle(forWritingAtPath: logPath) {
                            do {
                                try fh.seekToEnd()
                                try fh.write(contentsOf: bytes)
                                try fh.close()
                            } catch { /* best-effort log; drop on error */ }
                        }
                    }
                }
            }
        }
        if stream == "stdout" { stdoutTask = task } else { stderrTask = task }
    }

    private func cancelPipeReaders() {
        stdoutTask?.cancel()
        stderrTask?.cancel()
        stdoutTask = nil
        stderrTask = nil
    }

    private func startWatcher() {
        watcherTask?.cancel()
        watcherTask = Task { [port] in
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            var consecutive = 0
            while !Task.isCancelled {
                let r = await HealthProbe.portListen(host: "127.0.0.1", port: port, timeout: 2.0)
                if r.ok { consecutive = 0 } else { consecutive += 1 }
                if consecutive >= 2 {
                    await self.handleCrash()
                    return
                }
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private func handleCrash() async {
        state = .restarting
        await JSONLLogger.shared.log(LogEntry(
            level: .warn, tag: .docs, action: "crash", result: "detected"
        ))
        // Docs is not env-scoped, but the active env's lock applies if the
        // user has explicitly asked us to leave docs alone.
        let activeEnv = BackendEnv(rawValue: MarkerLock.readActiveEnv() ?? "") ?? .production
        if await LockRegistry.shared.isLocked(env: activeEnv, kind: .docs) {
            await JSONLLogger.shared.log(LogEntry(
                level: .info, tag: .docs, action: "auto-restart",
                result: "skipped-locked"
            ))
            state = .down
            return
        }
        await restart()
    }
}
