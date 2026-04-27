// Paths.swift — canonical filesystem locations.
import Foundation

enum Paths {
    static let bundleId = "com.mmffdev.vector.launcher"
    static let bundleIdSwift = "dev.mmff.vector.launcher"

    static var repoRoot: URL {
        // The repo root is wherever the launcher is invoked from. For dev runs
        // (`swift run`), this is the package root. For .app launches, fall back
        // to a known repo path stored in defaults, then the user's working dir.
        let env = ProcessInfo.processInfo.environment
        if let r = env["MMFF_REPO_ROOT"], !r.isEmpty {
            return URL(fileURLWithPath: r, isDirectory: true)
        }
        // Walk up from cwd looking for a marker file.
        var dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        for _ in 0..<8 {
            let claudeMd = dir.appendingPathComponent(".claude/CLAUDE.md")
            if FileManager.default.fileExists(atPath: claudeMd.path) {
                return dir
            }
            dir = dir.deletingLastPathComponent()
        }
        // Hard-coded fallback for this user's machine. Acceptable because this
        // launcher is dev-only and tied to this repo.
        return URL(fileURLWithPath:
            "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM",
            isDirectory: true)
    }

    static var appSupport: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("MMFFVectorLauncher", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var logsDir: URL {
        let dir = appSupport.appendingPathComponent("logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var logFile: URL {
        logsDir.appendingPathComponent("launcher.jsonl")
    }

    static var repoLogMirrorDir: URL {
        let dir = repoRoot.appendingPathComponent("local-assets/launcher/logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var repoLogMirror: URL {
        repoLogMirrorDir.appendingPathComponent("launcher.jsonl")
    }

    static var bridgeTokenFile: URL {
        appSupport.appendingPathComponent("bridge.token")
    }

    static var envLockFile: URL {
        appSupport.appendingPathComponent("env.lock")
    }

    static var claudeMdPath: URL {
        repoRoot.appendingPathComponent(".claude/CLAUDE.md")
    }

    static var gitHeadFile: URL {
        repoRoot.appendingPathComponent(".git/HEAD")
    }
}
