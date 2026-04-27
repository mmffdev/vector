// JSONLLoggerTests.swift — ERO-T01/T02: schema validity + required fields.
import XCTest
@testable import MMFFVectorLauncher

final class JSONLLoggerTests: XCTestCase {

    func testEntryEncodesCanonicalFields() throws {
        let e = LogEntry(level: .info, tag: .tunnel, action: "spawn", result: "ok",
                         extra: ["env": "dev", "pid": "123"])
        let encoded = try JSONEncoder().encode(e)
        let decoded = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        XCTAssertNotNil(decoded?["ts"])
        XCTAssertEqual(decoded?["level"] as? String, "info")
        XCTAssertEqual(decoded?["tag"] as? String, "tunnel")
        XCTAssertEqual(decoded?["action"] as? String, "spawn")
        XCTAssertEqual(decoded?["result"] as? String, "ok")
        let extra = decoded?["extra"] as? [String: String]
        XCTAssertEqual(extra?["env"], "dev")
        XCTAssertEqual(extra?["pid"], "123")
    }

    func testTimestampIsISO8601WithFractionalSeconds() throws {
        let e = LogEntry(level: .debug, tag: .app, action: "boot", result: "ok")
        // Expect: 2026-04-27T18:30:00.123Z
        let r = try NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#)
        let range = NSRange(e.ts.startIndex..., in: e.ts)
        XCTAssertNotNil(r.firstMatch(in: e.ts, range: range))
    }

    func testRequiredFieldsPresentInAllLevels() throws {
        for level in [LogLevel.debug, .info, .warn, .error] {
            let e = LogEntry(level: level, tag: .bridge, action: "x", result: "ok")
            let encoded = try JSONEncoder().encode(e)
            let decoded = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
            for key in ["ts", "level", "tag", "action", "result"] {
                XCTAssertNotNil(decoded?[key], "missing \(key) at level \(level)")
            }
        }
    }
}
