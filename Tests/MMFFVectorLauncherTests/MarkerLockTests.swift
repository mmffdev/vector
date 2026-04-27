// MarkerLockTests.swift — KRA-T01: read-only round trip through the live marker.
// We never mutate .claude/CLAUDE.md from a unit test — only verify the parser
// recognises the marker block that ships with the repo.
import XCTest
@testable import MMFFVectorLauncher

final class MarkerLockTests: XCTestCase {

    func testReadActiveEnvParsesLiveMarker() {
        // .claude/CLAUDE.md ships with an ACTIVE_BACKEND_ENV block. The parser
        // must recover the value between the first pair of backticks after
        // "ACTIVE BACKEND ENV: `".
        guard let env = MarkerLock.readActiveEnv() else {
            XCTFail("readActiveEnv returned nil — expected to parse live .claude/CLAUDE.md marker")
            return
        }
        XCTAssertTrue(["dev", "staging", "production"].contains(env),
                      "active env must be one of the canonical values; got \(env)")
    }

    func testWithLockExecutesBodyAndReleases() throws {
        // Sanity: the lock should be acquireable and the body run exactly once.
        var ran = 0
        try MarkerLock.withLock { ran += 1 }
        XCTAssertEqual(ran, 1)
        // A second call after release must succeed.
        try MarkerLock.withLock { ran += 1 }
        XCTAssertEqual(ran, 2)
    }
}
