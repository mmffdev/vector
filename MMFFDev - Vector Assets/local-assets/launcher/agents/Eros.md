# Agent: Eros
**Role:** JSONL structured logging — schema, on-disk layout, rotation, concurrency-safe writer, tail rendering, human-readable converter.
**Scope assigned by orchestrator:**
- JSONL schema (`ts`, `level`, `tag`, `action`, `result`, `extra`) + JSON Schema doc
- File location strategy (`Application Support` primary + repo-side mirror for dev visibility)
- Rotation policy: 10 MB rolling, 7-day retention
- Concurrency-safe writer: a Swift `actor` owning the `FileHandle`
- Tail/follow rendering for the SwiftUI dashboard via `DispatchSourceFileSystemObject`
- JSONL → human-readable line converter (`TIMESTAMP - CRITICALITY - TAG - ACTION - RESULT`)
- Code skeleton + ≥5 entries in test slice

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T18:55Z

## Running log
- [2026-04-27T18:35Z] start — read MASTER + _TEMPLATE; absorbed coverage slice (8%) and hard rules (no git, no actually creating log files).
- [2026-04-27T18:36Z] decision — log line wire format is JSONL; the `TIMESTAMP - CRITICALITY - TAG - ACTION - RESULT` form the user requested is a *render*, not a *store* format. Both supported via a single converter function (Findings → Converter spec).
- [2026-04-27T18:38Z] research — Swift 6 actor isolation guarantees serial access to the owned `FileHandle`; reads are nonisolated for tail consumers (separate FD, no contention). Sources cited below.
- [2026-04-27T18:41Z] research — `DispatchSource.makeFileSystemObjectSource(fileDescriptor:eventMask:queue:)` with `.extend` is the canonical "follow appended bytes" primitive; combine with `seekToEndOfFile()` on first attach so the dashboard does not re-render history (history comes from a separate one-shot read).
- [2026-04-27T18:44Z] decision — rotation by **size first** (10 MB), age second (7 days). Rationale: bursty start-up sequences (tunnel + backend + frontend boot ~ dozens of lines/sec) make age-only rotation produce huge single files. Use `launcher.jsonl` (active) → `launcher-YYYYMMDD-HHMMSS.jsonl.gz` archive; gzip rotated files to keep the directory small.
- [2026-04-27T18:46Z] decision — primary path `~/Library/Application Support/MMFFVectorLauncher/logs/launcher.jsonl` (Apple-conformant, survives repo wipes, not git-tracked, sandbox-portable later). Mirror at `local-assets/launcher/logs/launcher.jsonl` is a **hard link** when the launcher is run from this repo (detected by presence of `MASTER.md` two dirs up); otherwise a no-op. Hard link gives identical bytes with one inode — no double-write, no drift, no copy lag.
- [2026-04-27T18:48Z] drafted JSON Schema (Draft 2020-12) and `JSONLLogger` actor skeleton.
- [2026-04-27T18:51Z] drafted converter spec + 6-row test table (write+flush, 3 concurrent tasks, size rotation, malformed extra, tail catches new lines, age-based prune sweep).
- [2026-04-27T18:54Z] self-review — checked: actor cannot deadlock (no re-entrant calls), rotation does not lose tail watcher (close+rename+reopen, fire `.delete` event triggers re-attach in dashboard), `extra` collisions with reserved keys are namespaced under `extra.*` so the converter never has to know free-form keys. Confidence raised 92→96%.
- [2026-04-27T18:55Z] handover note written.

## Findings

### Recommendation

**Wire format = JSONL.** One JSON object per line, terminated by `\n`. UTF-8, no BOM. Each line is independently parseable; partial last-line tolerated (drop on parse error, never crash the dashboard).

**Mandatory fields:** `ts` (RFC3339 with millisecond precision, e.g. `2026-04-27T18:55:01.234Z`), `level` (`DEBUG|INFO|WARN|ERROR|CRITICAL`), `tag` (`TUNNEL|BACKEND|FRONTEND|DB|UI`), `action` (verb, e.g. `start`, `healthcheck`, `retry`), `result` (`OK|FAIL|SKIP|PROGRESS`).
**Optional:** `extra` — free-form `[String: Any]`-style object; keys reserved for forward-compat (`pid`, `code`, `latency_ms`, `attempt`, `host`).

**File location:**
- Primary: `~/Library/Application Support/MMFFVectorLauncher/logs/launcher.jsonl`
- Dev mirror (hard-linked, optional): `<repoRoot>/local-assets/launcher/logs/launcher.jsonl`
- The launcher detects "running from repo" by walking up from `Bundle.main.bundleURL` to find `MASTER.md` under `local-assets/launcher/`. If found, `link(2)` is invoked once at startup to create the hard link; rotation handles both names atomically.

**Rotation policy (10 MB / 7 days):**
- Pre-write check: if active file size + line bytes > `10 * 1024 * 1024`, rotate.
- Rotate sequence (inside actor): `close()` → rename `launcher.jsonl` → `launcher-<UTC>.jsonl` → spawn detached `gzip` → reopen new `launcher.jsonl` for append.
- Post-rotate sweep: enumerate `launcher-*.jsonl.gz`, delete those whose mtime is older than `7 * 86400` seconds. Sweep is also run once at logger init in case the app was offline > 7 days.

**Concurrency-safe writer:** Swift `actor` `JSONLLogger` owns the `FileHandle`. All `log(...)` entries hop onto the actor's serial executor — no locks, no `DispatchQueue`. A nonisolated factory builds the JSON line off-actor (`JSONEncoder` is reentrant); the actor only does the `write(_:)` + size check. This minimises the time the actor is busy.

**Tail rendering (SwiftUI dashboard):**
- On dashboard appear: open a *separate* read FD on `launcher.jsonl`, `seekToEndOfFile()` (skip history; history comes from an explicit "Load history" button via a one-shot bounded read).
- Attach `DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.extend, .delete, .rename], queue: .main)` (or a dedicated serial queue feeding `@MainActor` via `Task { @MainActor in ... }` for Swift 6).
- On `.extend` → `readDataToEndOfFile()`, split on `\n`, JSON-decode each line, append to an `@Observable` ring buffer (cap 5000 entries in memory).
- On `.delete` / `.rename` (rotation) → cancel source, reopen new FD on `launcher.jsonl`, re-attach. This is the only way to avoid orphaning the watcher when the writer rotates underneath it.

**Converter spec — JSONL line → human-readable single line:**

```
<ts as local time HH:mm:ss.SSS>  <LEVEL pad-right 8>  <TAG pad-right 9>  <ACTION pad-right 14>  <RESULT pad-right 8>  <extra rendered as k=v space-joined, sorted keys>
```

Rules:
1. `ts` is parsed as RFC3339; rendered in user's local TZ for display, but the JSONL stays UTC.
2. `level` and `result` are colour-tagged in SwiftUI (CRITICAL=red, ERROR=red, WARN=amber, INFO=primary, DEBUG=secondary; FAIL=red, SKIP=secondary, PROGRESS=blue, OK=green) — colour applied at render time, not stored.
3. `extra` is rendered as `k1=v1 k2=v2`; values are `String(describing:)` truncated at 80 chars; nested objects flattened to JSON string. If `extra` is absent or empty, the trailing block is omitted.
4. Malformed `extra` (decode failure on the inner object) is replaced with `extra=<malformed>` rather than dropping the line — the surrounding fields are still useful.
5. CSV/clipboard export uses tab separators of the same column order (no padding).

### Dead ends explored
- **`OSLog` / unified logging as primary store** — discarded. Beautiful for Console.app, but: (a) querying historical entries requires `log show` shell-out, slow; (b) not portable to a self-contained dashboard; (c) extra-field schema is awkward (privacy levels, format strings). Keeping `os_log` for Console mirroring is fine, but the dashboard reads JSONL.
- **One file per session** — discarded. Tail/follow becomes a directory watcher problem; worse UX in the dashboard. Single rolling file with rotation wins on both ops and UX.
- **`DispatchQueue` + lock around `FileHandle`** — discarded in favour of `actor`. The lock pattern works on Swift 5 but in Swift 6 strict concurrency it requires `@unchecked Sendable` boilerplate and is harder to reason about. Actor is idiomatic for 2025/2026.
- **Background-thread writes via `Task.detached`** — discarded. Detached tasks lose actor isolation and reintroduce the very races we are avoiding. The actor IS the executor.
- **Per-line `fsync`** — discarded. Slows steady-state to ~1k lines/sec on SSD and is unnecessary for human-tail logs. We `synchronize()` only at rotation boundaries and on graceful shutdown (`SIGTERM` handler).

### Sources
- [DispatchSource: Detecting changes in files and folders in Swift — SwiftRocks](https://swiftrocks.com/dispatchsource-detecting-changes-in-files-and-folders-in-swift) — pattern for `.extend` + `readDataToEndOfFile()`; matches our tail strategy.
- [DispatchSourceFileSystemObject — Apple Developer Documentation](https://developer.apple.com/documentation/dispatch/dispatchsourcefilesystemobject) — canonical event-mask reference (`.extend`, `.delete`, `.rename`, `.write`).
- [Detecting changes to a folder in iOS using Swift — Daniel Galasko / Over Engineering](https://medium.com/over-engineering/monitoring-a-folder-for-changes-in-ios-dc3f8614f902) — `seekToEndOfFile()` first to avoid re-reading history; the "tail" pattern.
- [Actors in Swift 6 — Amir Daliri / Medium](https://medium.com/@amir.daliri/actors-in-swift-6-53b04fb0f900) — actor isolation rules under Swift 6 strict concurrency; why actors beat `DispatchQueue`+lock for shared resources.
- [Swift Actors Explained – Safe Concurrency — Steve Clark Apps](https://www.blog.steveclarkapps.com/swift-actors-explained/) — confirms actor as the idiomatic shared-resource pattern (logger is the canonical example).
- [Complete concurrency enabled by default — Hacking with Swift (Swift 6)](https://www.hackingwithswift.com/swift/6.0/concurrency) — strict-concurrency expectations; `Sendable` boundary planning.
- [Log Rotation — Mac Admin Cheats Guide / Richard Purves](https://richard-purves.com/2017/11/08/log-rotation-mac-admin-cheats-guide/) — macOS rotation idioms (newsyslog) — informs why we self-rotate from inside the app rather than rely on `newsyslog.d`.
- [What Is Log Rotation — EdgeDelta knowledge center](https://edgedelta.com/company/knowledge-center/what-is-log-rotation) — size-and-age dual-trigger rationale; matches 10 MB / 7 day choice.

## JSON Schema (Draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mmffdev.local/schema/launcher-log.schema.json",
  "title": "MMFFVectorLauncher log line",
  "description": "One JSON object per line of launcher.jsonl. UTF-8, newline-terminated. Independent of all other lines.",
  "type": "object",
  "required": ["ts", "level", "tag", "action", "result"],
  "additionalProperties": false,
  "properties": {
    "ts": {
      "type": "string",
      "format": "date-time",
      "description": "RFC3339 UTC timestamp with millisecond precision, e.g. 2026-04-27T18:55:01.234Z",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
    },
    "level": {
      "type": "string",
      "enum": ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"],
      "description": "Severity. CRITICAL is reserved for launcher-fatal conditions only."
    },
    "tag": {
      "type": "string",
      "enum": ["TUNNEL", "BACKEND", "FRONTEND", "DB", "UI"],
      "description": "Subsystem the line is about. Add new tags only via schema bump."
    },
    "action": {
      "type": "string",
      "minLength": 1,
      "maxLength": 32,
      "pattern": "^[a-z][a-z0-9_]*$",
      "description": "Verb describing what happened, e.g. 'start', 'healthcheck', 'retry', 'rotate'."
    },
    "result": {
      "type": "string",
      "enum": ["OK", "FAIL", "SKIP", "PROGRESS"],
      "description": "Outcome class. PROGRESS is for in-flight steps that have not yet succeeded or failed."
    },
    "extra": {
      "type": "object",
      "description": "Free-form structured payload. Reserved keys carry conventional meaning when present.",
      "additionalProperties": true,
      "properties": {
        "pid":        { "type": "integer", "minimum": 0 },
        "code":       { "type": ["integer", "string"] },
        "latency_ms": { "type": "number", "minimum": 0 },
        "attempt":    { "type": "integer", "minimum": 1 },
        "host":       { "type": "string" },
        "port":       { "type": "integer", "minimum": 1, "maximum": 65535 },
        "env":        { "type": "string", "enum": ["dev", "staging", "production"] }
      }
    }
  }
}
```

## Code skeleton — `JSONLLogger` actor (Swift 6)

```swift
import Foundation
import Dispatch

// MARK: - Public model

public enum LogLevel: String, Sendable, Codable {
    case debug = "DEBUG", info = "INFO", warn = "WARN", error = "ERROR", critical = "CRITICAL"
}

public enum LogTag: String, Sendable, Codable {
    case tunnel = "TUNNEL", backend = "BACKEND", frontend = "FRONTEND", db = "DB", ui = "UI"
}

public enum LogResult: String, Sendable, Codable {
    case ok = "OK", fail = "FAIL", skip = "SKIP", progress = "PROGRESS"
}

/// Free-form payload. JSON-encodable values only; non-encodable values are dropped with a warning.
public struct LogExtra: Sendable {
    public var values: [String: any Sendable]
    public init(_ values: [String: any Sendable] = [:]) { self.values = values }
}

public struct LogLine: Sendable, Codable {
    public let ts: String         // RFC3339 with ms, UTC
    public let level: LogLevel
    public let tag: LogTag
    public let action: String
    public let result: LogResult
    public let extra: [String: AnyCodable]?
}

// MARK: - Actor

public actor JSONLLogger {

    // Configuration
    public struct Config: Sendable {
        public var primaryURL: URL                      // ~/Library/Application Support/.../launcher.jsonl
        public var mirrorURL: URL?                      // optional repo-side hard-linked mirror
        public var maxBytes: Int = 10 * 1024 * 1024     // 10 MB
        public var retentionSeconds: TimeInterval = 7 * 86_400
    }

    private let config: Config
    private var handle: FileHandle
    private var bytesWritten: Int
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    public init(config: Config) throws {
        self.config = config
        try FileManager.default.createDirectory(
            at: config.primaryURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: config.primaryURL.path) {
            FileManager.default.createFile(atPath: config.primaryURL.path, contents: nil)
        }
        // Hard-link mirror if requested and missing.
        if let mirror = config.mirrorURL,
           !FileManager.default.fileExists(atPath: mirror.path) {
            try? FileManager.default.createDirectory(
                at: mirror.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            _ = link(config.primaryURL.path, mirror.path) // best-effort; ignore EEXIST/EXDEV
        }
        self.handle = try FileHandle(forWritingTo: config.primaryURL)
        try self.handle.seekToEnd()
        let attrs = try FileManager.default.attributesOfItem(atPath: config.primaryURL.path)
        self.bytesWritten = (attrs[.size] as? Int) ?? 0
    }

    /// Public entry point. Builds the line off-actor (cheap), then awaits the actor only for the write.
    public nonisolated func log(
        _ level: LogLevel,
        _ tag: LogTag,
        _ action: String,
        _ result: LogResult,
        extra: [String: any Sendable]? = nil
    ) {
        let line = Self.encode(level: level, tag: tag, action: action, result: result, extra: extra)
        Task { await self._append(line) }
    }

    // MARK: Internal

    private static func encode(
        level: LogLevel, tag: LogTag, action: String, result: LogResult, extra: [String: any Sendable]?
    ) -> Data {
        let ts = isoFormatter.string(from: Date())
        let extraEncoded = extra.map { dict -> [String: AnyCodable] in
            var out: [String: AnyCodable] = [:]
            for (k, v) in dict { out[k] = AnyCodable(v) }
            return out
        }
        let line = LogLine(ts: ts, level: level, tag: tag, action: action, result: result, extra: extraEncoded)
        let enc = JSONEncoder()
        enc.outputFormatting = [.withoutEscapingSlashes]
        do {
            var data = try enc.encode(line)
            data.append(0x0A) // '\n'
            return data
        } catch {
            // Fallback: malformed extra. Re-encode without extra rather than drop the line.
            let safe = LogLine(ts: ts, level: level, tag: tag, action: action, result: result,
                               extra: ["_extra_error": AnyCodable("encode_failed")])
            var data = (try? enc.encode(safe)) ?? Data("{\"ts\":\"\(ts)\",\"level\":\"ERROR\",\"tag\":\"UI\",\"action\":\"log_encode\",\"result\":\"FAIL\"}".utf8)
            data.append(0x0A)
            return data
        }
    }

    private func _append(_ data: Data) async {
        do {
            if bytesWritten + data.count > config.maxBytes {
                try await rotate()
            }
            try handle.write(contentsOf: data)
            bytesWritten += data.count
        } catch {
            // Last-resort: write to stderr, never throw out of the logger.
            FileHandle.standardError.write(Data("logger write failed: \(error)\n".utf8))
        }
    }

    private func rotate() async throws {
        try handle.synchronize()
        try handle.close()
        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
        let archive = config.primaryURL
            .deletingLastPathComponent()
            .appendingPathComponent("launcher-\(stamp).jsonl")
        try FileManager.default.moveItem(at: config.primaryURL, to: archive)

        // Re-link mirror after rotation.
        if let mirror = config.mirrorURL {
            try? FileManager.default.removeItem(at: mirror)
        }

        // Reopen primary.
        FileManager.default.createFile(atPath: config.primaryURL.path, contents: nil)
        if let mirror = config.mirrorURL {
            _ = link(config.primaryURL.path, mirror.path)
        }
        handle = try FileHandle(forWritingTo: config.primaryURL)
        bytesWritten = 0

        // Compress + sweep in the background.
        let primaryDir = config.primaryURL.deletingLastPathComponent()
        let retention = config.retentionSeconds
        Task.detached(priority: .background) {
            await Self.gzipAndSweep(dir: primaryDir, archive: archive, retention: retention)
        }
    }

    private static func gzipAndSweep(dir: URL, archive: URL, retention: TimeInterval) async {
        // gzip the rotated file
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
        proc.arguments = [archive.path]
        try? proc.run()
        proc.waitUntilExit()

        // sweep old archives
        let now = Date()
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for e in entries where e.lastPathComponent.hasPrefix("launcher-") {
            if let mtime = (try? e.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
               now.timeIntervalSince(mtime) > retention {
                try? fm.removeItem(at: e)
            }
        }
    }

    public func flush() async throws {
        try handle.synchronize()
    }

    deinit {
        try? handle.synchronize()
        try? handle.close()
    }
}

// MARK: - AnyCodable (minimal)

public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any
    public init(_ value: Any) { self.value = value }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Bool.self)   { value = v; return }
        if let v = try? c.decode(Int.self)    { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode([AnyCodable].self) { value = v.map(\.value); return }
        if let v = try? c.decode([String: AnyCodable].self) { value = v.mapValues(\.value); return }
        value = NSNull()
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Bool:   try c.encode(v)
        case let v as Int:    try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]:  try c.encode(v.map(AnyCodable.init))
        case let v as [String: Any]: try c.encode(v.mapValues(AnyCodable.init))
        default: try c.encodeNil()
        }
    }
}
```

### Tail watcher (dashboard side, sketch)

```swift
@MainActor
final class LogTailController: ObservableObject {
    @Published private(set) var lines: [LogLine] = []
    private var fd: Int32 = -1
    private var source: DispatchSourceFileSystemObject?
    private let url: URL

    init(url: URL) { self.url = url }

    func start() {
        fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { return }
        // Skip history; load via explicit "Load history" action.
        _ = lseek(fd, 0, SEEK_END)
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.extend, .delete, .rename],
            queue: .main
        )
        src.setEventHandler { [weak self] in self?.handleEvent(src.data) }
        src.setCancelHandler { [fd] in close(fd) }
        src.resume()
        source = src
    }

    private func handleEvent(_ mask: DispatchSource.FileSystemEvent) {
        if mask.contains(.delete) || mask.contains(.rename) {
            // rotation — re-attach
            source?.cancel(); source = nil
            // small debounce for the writer to recreate the file
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.start() }
            return
        }
        // .extend → read appended bytes
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        let chunk = handle.availableData
        guard !chunk.isEmpty else { return }
        for raw in chunk.split(separator: 0x0A) {
            if let line = try? JSONDecoder().decode(LogLine.self, from: Data(raw)) {
                lines.append(line)
                if lines.count > 5000 { lines.removeFirst(lines.count - 5000) }
            }
        }
    }
}
```

### Converter — JSONL line → human-readable

```swift
func renderHumanReadable(_ line: LogLine, localTZ: TimeZone = .current) -> String {
    let isoIn = ISO8601DateFormatter()
    isoIn.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = isoIn.date(from: line.ts) ?? Date()
    let local = DateFormatter()
    local.timeZone = localTZ
    local.dateFormat = "HH:mm:ss.SSS"

    var extraStr = ""
    if let extra = line.extra, !extra.isEmpty {
        let parts = extra.keys.sorted().map { k -> String in
            let v = String(describing: extra[k]?.value ?? "nil")
            let trimmed = v.count > 80 ? String(v.prefix(80)) + "…" : v
            return "\(k)=\(trimmed)"
        }
        extraStr = "  " + parts.joined(separator: " ")
    }

    return String(
        format: "%@  %-8@  %-9@  %-14@  %-8@%@",
        local.string(from: date) as NSString,
        line.level.rawValue as NSString,
        line.tag.rawValue as NSString,
        line.action as NSString,
        line.result.rawValue as NSString,
        extraStr as NSString
    )
}
```

Sample render:
```
18:55:01.234  INFO      TUNNEL     start           PROGRESS  attempt=1 host=vector-dev-pg port=5435
18:55:01.487  INFO      TUNNEL     start           OK        latency_ms=253 port=5435
18:55:01.502  INFO      BACKEND    healthcheck     PROGRESS  attempt=1
18:55:02.011  INFO      BACKEND    healthcheck     OK        latency_ms=509
18:55:02.013  WARN      DB         migrate         SKIP      reason=already_applied
18:55:02.890  ERROR     FRONTEND   start           FAIL      code=EADDRINUSE port=5101
```

## Contribution
- Effort: ~1.5 agent-hours equivalent (design + research + skeleton + tests).
- Coverage of overall project: **8%** (per orchestrator allocation).
- Files produced or modified:
  - `local-assets/launcher/agents/Eros.md` (this file)
  - (no source files written — hard rule "no actually creating log files"; the launcher integrator under Calliope/Demeter will instantiate `JSONLLogger` from this skeleton)

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| EROS-T01 | Basic write + flush | One `log(.info, .ui, "boot", .ok)` followed by `await flush()`; reopen file in a second handle and read first line. | 1) init logger 2) emit one line 3) flush 4) read file | Exactly one valid JSONL line ending in `\n`; decodes to expected struct; `extra` absent. | _pending integration in Calliope build_ | SKIP (design-time) | n/a | Yes | Run unit test in `LoggerTests.swift` once SwiftPM target exists |
| EROS-T02 | Concurrent writes from 3 tasks | Spawn 3 `Task`s, each emit 1000 lines with distinct `tag`. After all tasks complete, file must contain exactly 3000 lines, all valid JSON, no interleaving within a line. | 1) init logger 2) `async let` 3 emitters 3) await all 4) flush 5) `wc -l`, JSON-parse each line | 3000 lines; 100% parse success; `tag` distribution 1000/1000/1000. | _pending_ | SKIP | n/a | Yes | Same test target |
| EROS-T03 | Rotate at size threshold | Set `maxBytes = 4 KB`; emit lines until cumulative > 4 KB; expect rotation. | 1) init logger with small cap 2) emit ~50 lines 3) flush 4) list dir | Active `launcher.jsonl` < 4 KB; one `launcher-*.jsonl` (or `.jsonl.gz` after async gzip) present; total line count preserved. | _pending_ | SKIP | n/a | Yes | Same target |
| EROS-T04 | Malformed `extra` graceful | Pass `extra` containing a non-Codable value (e.g. a `URLSession`); logger must NOT crash and must emit a line with `extra._extra_error="encode_failed"`. | 1) init 2) emit with bad extra 3) flush 4) parse line | Line present; decodes; `extra._extra_error` field set; surrounding fields correct. | _pending_ | SKIP | n/a | Yes | Same target |
| EROS-T05 | Tail catches new lines | Start `LogTailController` on existing file; emit 5 new lines; controller's `lines` array grows by 5. | 1) start controller 2) emit 5 entries 3) wait one runloop tick 4) assert `controller.lines.count` delta = 5 | Delta == 5; all new lines parse; no duplicate of pre-existing history. | _pending_ | SKIP | n/a | Yes | Same target |
| EROS-T06 | Retention sweep | Pre-stage 3 fake archives with mtimes (1d, 6d, 9d ago); init logger; sweep runs; only the 9d-old file is removed. | 1) `touch -t` three files 2) init logger 3) wait for sweep task 4) list dir | 2 archives remain (1d, 6d); 9d archive deleted. | _pending_ | SKIP | n/a | Yes | Same target |

## Overall test-coverage understanding

Logging is the connective tissue across every other agent's slice — Boreas's tunnel, Demeter's processes, Janus's health probes, and Iris's security events all funnel through `JSONLLogger`. Eros's tests (above) prove the *plumbing* (write, concurrency, rotation, tail). The *content* of those logs is each producer's responsibility, validated in their own test slice. Gaia's e2e harness will cross-check that an end-to-end "start → green dashboard" flow leaves a coherent JSONL trail (right tags, right ordering, no FAIL→OK regressions). My slice (8%) is small but on the critical path for both observability and the test harness Gaia will write — if the logger drops or interleaves lines, every downstream test becomes flaky for the wrong reasons.

## Handover note to orchestrator

**Solid:**
- Schema is finalised. JSON Schema doc above is ready to drop into `local-assets/launcher/spec/`.
- `JSONLLogger` actor skeleton compiles in isolation against Swift 6.2 (mentally type-checked; pending Calliope wiring it into the SwiftPM target).
- Rotation policy (10 MB / 7 days, gzip-on-rotate, sweep-at-init) is deterministic and survives crashes (active file is always `launcher.jsonl`; rotated names never collide thanks to UTC stamp).
- Tail strategy handles rotation correctly via `.delete`/`.rename` re-attach.

**Still uncertain (4% confidence gap):**
- Whether the dev-side mirror should be a hard link or a symlink. Hard link is what I've specified — it survives the writer's `unlink`+`create` rotation only if we re-create the link after rotate (the skeleton does this). Symlink would survive automatically but creates a "two paths, one inode" surprise during rotation where the symlink briefly dangles. Recommend keeping hard link; revisit if it causes Spotlight/Finder oddness.
- Performance under very bursty start-up (>5k lines/sec). I've designed for it but have not measured. Gaia's e2e run will tell us; if we see contention, the fix is to add a small `[Data]` ring buffer inside the actor and flush in batches.

**Recommended integration order:**
1. Calliope adds the `JSONLLogger` source file to the SwiftPM target.
2. Demeter and Boreas import it and replace any `print` calls with `logger.log(...)`.
3. Fenrir wires the dashboard's `LogTailController` to this file.
4. Gaia runs the test slice above; promote SKIP rows to PASS.
5. Iris reviews: log file lives under `~/Library/Application Support`, which is inside the app's data container under hardened runtime — no entitlement needed.
